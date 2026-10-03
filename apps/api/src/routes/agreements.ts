/**
 * Electronic agreements: the MSA and the CPA / CPL campaign agreements,
 * generated, signed electronically and delivered.
 *
 * ── Two surfaces ─────────────────────────────────────────────────────────────
 *
 *   /api/v1/platform/agreements/...         NetEnroll platform admins only.
 *                                           Every route is
 *                                           `authenticate + requirePlatformAdmin`
 *                                           and every write is audited.
 *   /api/v1/public/agreements/...           The signer and the client, with no
 *                                           account. An envelope is reached
 *                                           only by the holder of its token,
 *                                           and nothing but a summary is shown
 *                                           before an emailed code is verified.
 *
 * ── What the evidence has to prove ───────────────────────────────────────────
 *
 * Under ESIGN (15 U.S.C. §7001) and Florida's UETA (Fla. Stat. §668.50), for
 * every envelope: INTENT (an explicit "Sign Agreements" with the intent
 * statement recorded verbatim), CONSENT (the disclosure accepted, version and
 * text hash recorded), ATTRIBUTION (a link to one address, a one-time code to
 * that address, IP and user agent on every event), ASSOCIATION (the signature
 * bound to the SHA-256 of the exact as-sent text, which the database will not
 * let change) and RETENTION (the executed PDF stored once, hashed, sealed, with
 * a hash-chained append-only event log). See docs/AGREEMENTS.md.
 */

import type {
  AgreementEnvelope,
  AgreementStatus,
  AgreementSuite,
  PrismaClient,
} from '@prisma/client';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { clientIp, clientUserAgent } from '../lib/client-ip.js';
import { logger } from '../lib/logger.js';
import { PLATFORM_ADMIN_REQUIRED, requirePlatformAdmin } from '../lib/platform-context.js';
import { getPrismaClient } from '../lib/prisma.js';
import { getActingUserId } from '../lib/tenant-context.js';
import { authenticate } from '../middleware/auth.js';
import { preloadAgreementAssets } from '../services/agreements/assets.js';
import {
  adminEnvelopeUrl,
  completeEnvelope,
  downloadPageUrl,
  executedFileName,
} from '../services/agreements/complete.js';
import {
  acceptanceStatement,
  ESIGN_DISCLOSURE_V1,
  disclosureVersionFor,
  intentStatement,
  issuerDisclosureHtml,
  issuerDisclosureSha256,
  issuerDisclosureText,
  type DisclosureIssuer,
} from '../services/agreements/documents.js';
import {
  sendChangesRequestedAlert,
  sendCompletionFailedAlert,
  sendOtpEmail,
} from '../services/agreements/emails.js';
import {
  AgreementError,
  expireStaleEnvelopes,
  notifyLifecycle,
} from '../services/agreements/envelopes.js';
import { appendEvent, recordEvent } from '../services/agreements/events.js';
import { maskEmail, sha256Hex } from '../services/agreements/format.js';
import { issuerOfEnvelope, type IssuerPresentation } from '../services/agreements/issuer.js';
import {
  agencyLabel,
  isIndividual,
  needsPartyDetails,
  partyPrefill,
  signableHtml,
  signableSha256,
  submitPartyDetails,
} from '../services/agreements/party.js';
import {
  loadAgreementSettings,
  noticeEmailOf,
  SETTINGS_ID,
} from '../services/agreements/settings.js';
import { missingSuiteSetting, platformSuiteContext } from '../services/agreements/suites.js';
import { INDIVIDUAL_SIGNER_TITLE, type FrozenTerms } from '../services/agreements/terms.js';
import {
  digestsEqual,
  hashOtp,
  hashToken,
  mintToken,
  newOtpCode,
} from '../services/agreements/tokens.js';
import { auditLog } from '../services/audit.js';
import { installAgreementSync } from '../services/sales/agreement-sync.js';
import { getAgreementsStorageService } from '../services/storage.js';

import { registerAgreementSurface, serveExecutedPdf, titlesOf } from './agreement-surface.js';

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_MAX_PER_HOUR = 5;
export const SESSION_TTL_MS = 60 * 60 * 1000;
export const MAX_SIGNATURE_PNG_BYTES = 200 * 1024;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const INACTIVE: AgreementStatus[] = ['VOIDED', 'EXPIRED', 'CHANGES_REQUESTED'];
const OPEN: AgreementStatus[] = ['SENT', 'VIEWED'];

function sendAgreementError(reply: FastifyReply, error: unknown): FastifyReply | null {
  if (error instanceof AgreementError) {
    return reply
      .code(error.statusCode)
      .send({ error: { code: error.code, message: error.message } });
  }
  return null;
}

function validation(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(422).send({ error: { code: 'VALIDATION_ERROR', message } });
}

function notFound(reply: FastifyReply, message = 'Agreement not found'): FastifyReply {
  return reply.code(404).send({ error: { code: 'NOT_FOUND', message } });
}

/** The signer's name as typed, normalised: case and extra spaces ignored. */
export function normaliseName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** A drawn signature: PNG magic, IHDR dimensions within 1200×400, ≤ 200 KB. */
export function parseSignaturePng(input: string): Buffer | string {
  const b64 = input.startsWith('data:image/png;base64,')
    ? input.slice('data:image/png;base64,'.length)
    : input;
  if (!/^[A-Za-z0-9+/=\s]+$/.test(b64)) return 'The drawn signature is not a valid PNG.';
  const png = Buffer.from(b64, 'base64');
  if (png.length > MAX_SIGNATURE_PNG_BYTES) return 'The drawn signature is larger than 200 KB.';
  if (png.length < 33 || !png.subarray(0, 8).equals(PNG_MAGIC)) {
    return 'The drawn signature is not a valid PNG.';
  }
  if (png.subarray(12, 16).toString('ascii') !== 'IHDR') {
    return 'The drawn signature is not a valid PNG.';
  }
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width < 1 || height < 1 || width > 1200 || height > 400) {
    return 'The drawn signature must be at most 1200 × 400 pixels.';
  }
  return png;
}

// eslint-disable-next-line @typescript-eslint/require-await -- plugin signature
export async function registerAgreementRoutes(fastify: FastifyInstance): Promise<void> {
  const prisma: PrismaClient = getPrismaClient();

  /**
   * The address a public page or email names for an envelope: its issuer's.
   * NetEnroll's as configured now (as it always was), another issuer's as
   * frozen at send. Never chosen by the host the page was opened on.
   */
  async function noticeEmailForEnvelope(envelope: AgreementEnvelope | null): Promise<string> {
    if (envelope && issuerOfEnvelope(envelope).scope !== 'PLATFORM') {
      return issuerOfEnvelope(envelope).noticeEmail;
    }
    const ctx = await platformSuiteContext(prisma).catch(() => null);
    return (
      ctx?.suite.noticeEmail?.trim() ||
      noticeEmailOf(await loadAgreementSettings(prisma).catch(() => null))
    );
  }

  /** What a signer's page may show about the issuer: names and brand, nothing internal. */
  function publicIssuer(envelope: AgreementEnvelope) {
    const issuer = issuerOfEnvelope(envelope);
    return {
      scope: issuer.scope,
      displayName: issuer.displayName,
      shortName: issuer.shortName,
      legalName: issuer.legalName,
      brandTheme: issuer.brandTheme,
    };
  }

  /** NetEnroll's envelopes show ESIGN_DISCLOSURE_V1 verbatim; another issuer's, its own. */
  function disclosureIssuerOf(envelope: AgreementEnvelope): DisclosureIssuer | null {
    const issuer = issuerOfEnvelope(envelope);
    return issuer.scope === 'PLATFORM'
      ? null
      : { legalName: issuer.legalName, shortName: issuer.shortName };
  }

  /** The issuer to brand an email with: undefined (NetEnroll's, unchanged) for NetEnroll. */
  function emailIssuerOf(envelope: AgreementEnvelope): IssuerPresentation | undefined {
    const issuer = issuerOfEnvelope(envelope);
    return issuer.scope === 'PLATFORM' ? undefined : issuer;
  }

  /** Where the issuer's internal alerts go: its suite's copy addresses and the sender. */
  async function internalAlertsTo(envelope: AgreementEnvelope): Promise<string[]> {
    const suite = await prisma.agreementSuite
      .findUnique({ where: { id: envelope.agreementSuiteId } })
      .catch(() => null);
    const sender = await prisma.user
      .findUnique({ where: { id: envelope.sentByUserId }, select: { email: true } })
      .catch(() => null);
    return Array.from(
      new Set([...(suite?.internalCopyEmails ?? []), sender?.email ?? ''].filter(Boolean))
    );
  }

  // Agreement lifecycle events reach their Sales CRM prospects (best-effort).
  installAgreementSync();
  try {
    preloadAgreementAssets();
  } catch (error) {
    logger.error({ msg: 'Agreement assets could not be loaded', err: error });
  }

  /*
   * An API key belongs to an agency and is never staff. `requirePlatformAdmin`
   * would answer it 401 (it carries no user); it is a credential that
   * authenticated perfectly well and is simply not allowed, so it gets 403.
   */
  async function refuseApiKeys(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    await Promise.resolve();
    if ((request.user as { apiKeyId?: string } | undefined)?.apiKeyId) {
      void reply.code(403).send({ error: PLATFORM_ADMIN_REQUIRED });
    }
  }

  const admin = { preHandler: [authenticate, refuseApiKeys, requirePlatformAdmin] };

  async function audit(
    request: FastifyRequest,
    action: string,
    envelope: { id: string; tenantId: string | null } | null,
    changes: Record<string, unknown> = {}
  ): Promise<void> {
    await auditLog({
      tenantId: envelope?.tenantId ?? null,
      userId: getActingUserId(request) ?? undefined,
      action,
      entityType: 'AgreementEnvelope',
      entityId: envelope?.id,
      resource: request.url,
      method: request.method,
      changes,
      ipAddress: clientIp(request) ?? undefined,
      userAgent: clientUserAgent(request) ?? undefined,
      requestId: request.id,
      success: true,
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // Admin: NetEnroll's own suite (the PLATFORM sales workspace)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * NetEnroll's settings, in the shape this screen has always used. They live
   * on the platform suite now; the legacy `agreement_settings` row is written
   * too, so a rollback to the previous release reads the same values.
   */
  function legacySettingsShape(suite: AgreementSuite) {
    const ctxMissing = missingSuiteSetting({ suite, scope: 'PLATFORM' });
    return {
      id: SETTINGS_ID,
      netenrollNoticeAddress: suite.noticeAddress,
      netenrollNoticeEmail: suite.noticeEmail,
      defaultSignatoryName: suite.defaultSignatoryName ?? 'James Kelly',
      defaultSignatoryTitle: suite.defaultSignatoryTitle ?? 'Managing Partner',
      internalCopyEmails: suite.internalCopyEmails,
      updatedByUserId: suite.updatedByUserId,
      updatedAt: suite.updatedAt,
      missing: ctxMissing,
    };
  }

  fastify.get('/api/v1/platform/agreements/settings', admin, async (_request, reply) => {
    const ctx = await platformSuiteContext(prisma);
    return reply.send({ data: legacySettingsShape(ctx.suite) });
  });

  const settingsSchema = z.object({
    netenrollNoticeAddress: z.string().trim().max(300).nullable().optional(),
    netenrollNoticeEmail: z
      .union([z.string().trim().email().max(254), z.literal('')])
      .nullable()
      .optional(),
    defaultSignatoryName: z.string().trim().min(2).max(100),
    defaultSignatoryTitle: z.string().trim().min(1).max(120),
    internalCopyEmails: z.array(z.string().trim().email().max(254)).max(20),
  });

  fastify.put('/api/v1/platform/agreements/settings', admin, async (request, reply) => {
    const parsed = settingsSchema.safeParse(request.body);
    if (!parsed.success) {
      return validation(reply, parsed.error.issues[0]?.message ?? 'Invalid settings');
    }
    const ctx = await platformSuiteContext(prisma);
    const before = legacySettingsShape(ctx.suite);
    const data = {
      netenrollNoticeAddress: parsed.data.netenrollNoticeAddress?.trim() || null,
      netenrollNoticeEmail: parsed.data.netenrollNoticeEmail?.trim().toLowerCase() || null,
      defaultSignatoryName: parsed.data.defaultSignatoryName,
      defaultSignatoryTitle: parsed.data.defaultSignatoryTitle,
      internalCopyEmails: Array.from(
        new Set(parsed.data.internalCopyEmails.map(e => e.toLowerCase()))
      ),
      updatedByUserId: getActingUserId(request),
    };
    const suite = await prisma.agreementSuite.update({
      where: { id: ctx.suite.id },
      data: {
        noticeAddress: data.netenrollNoticeAddress,
        noticeEmail: data.netenrollNoticeEmail,
        defaultSignatoryName: data.defaultSignatoryName,
        defaultSignatoryTitle: data.defaultSignatoryTitle,
        internalCopyEmails: data.internalCopyEmails,
        updatedByUserId: data.updatedByUserId,
      },
    });
    await loadAgreementSettings(prisma);
    await prisma.agreementSettings.update({ where: { id: SETTINGS_ID }, data });
    await audit(request, 'agreements.settings.updated', null, {
      salesWorkspaceId: ctx.workspace.id,
      agreementSuiteId: ctx.suite.id,
      before: {
        netenrollNoticeAddress: before.netenrollNoticeAddress,
        netenrollNoticeEmail: before.netenrollNoticeEmail,
        defaultSignatoryName: before.defaultSignatoryName,
        defaultSignatoryTitle: before.defaultSignatoryTitle,
        internalCopyEmails: before.internalCopyEmails,
      },
      after: data,
    });
    return reply.send({ data: legacySettingsShape(suite) });
  });

  fastify.get<{ Querystring: { q?: string } }>(
    '/api/v1/platform/agreements/agencies',
    admin,
    async (request, reply) => {
      const ctx = await platformSuiteContext(prisma);
      const q = (request.query.q ?? '').trim();
      const profiles = await prisma.agencyProfile.findMany({
        where: q
          ? {
              OR: [
                { legalName: { contains: q, mode: 'insensitive' } },
                { tenant: { name: { contains: q, mode: 'insensitive' } } },
              ],
            }
          : {},
        include: { tenant: { select: { id: true, name: true } } },
        orderBy: { legalName: 'asc' },
        take: 50,
      });
      const tenantIds = profiles.map(p => p.tenantId);
      // Only NetEnroll's own executed MSAs: a white-label issuer's MSA with the
      // same agency is that issuer's contract, not NetEnroll's.
      const msas =
        tenantIds.length === 0
          ? []
          : await prisma.agreementEnvelope.findMany({
              where: {
                tenantId: { in: tenantIds },
                status: 'COMPLETED',
                includesMsa: true,
                salesWorkspaceId: ctx.workspace.id,
                agreementSuiteId: ctx.suite.id,
              },
              orderBy: { completedAt: 'desc' },
              select: { id: true, reference: true, tenantId: true, terms: true, completedAt: true },
            });
      const latest = new Map<string, (typeof msas)[number]>();
      for (const row of msas)
        if (row.tenantId && !latest.has(row.tenantId)) latest.set(row.tenantId, row);
      return reply.send({
        data: profiles.map(p => {
          const msa = latest.get(p.tenantId);
          return {
            id: p.tenantId,
            name: p.tenant.name,
            legalName: p.legalName,
            state: p.state,
            contactName: p.contactName,
            contactEmail: p.contactEmail,
            contactPhone: p.contactPhone,
            deliveryDays: p.deliveryDays,
            deliveryStartTime: p.deliveryStartTime,
            deliveryEndTime: p.deliveryEndTime,
            executedMsa: msa
              ? {
                  id: msa.id,
                  reference: msa.reference,
                  effectiveDate: (msa.terms as unknown as FrozenTerms).effectiveDate,
                }
              : null,
          };
        }),
      });
    }
  );

  // Preview, send, list, detail, documents, resend, void, copies, completion:
  // the shared surface, pinned to NetEnroll's suite. A white-label suite's
  // envelopes are not in this workspace and so are not found here.
  registerAgreementSurface(fastify, prisma, {
    prefix: '/api/v1/platform/agreements',
    preHandler: admin.preHandler,
    resolve: async () => ({
      ctx: await platformSuiteContext(prisma),
      level: 'MANAGER',
      auditTenantId: envelope => envelope?.tenantId ?? null,
    }),
  });

  // ════════════════════════════════════════════════════════════════════════
  // Public: the signer and the client
  // ════════════════════════════════════════════════════════════════════════

  const tokenLimit = {
    rateLimit: {
      max: 20,
      timeWindow: '1 minute',
      keyGenerator: (r: FastifyRequest) => clientIp(r) ?? 'unknown',
    },
  };
  const otpLimit = {
    rateLimit: {
      max: 5,
      timeWindow: '1 minute',
      keyGenerator: (r: FastifyRequest) => clientIp(r) ?? 'unknown',
    },
  };
  const verifyLimit = {
    rateLimit: {
      max: 10,
      timeWindow: '1 minute',
      keyGenerator: (r: FastifyRequest) => clientIp(r) ?? 'unknown',
    },
  };

  /** Public routes reach an envelope only through its token, so no workspace filter applies here. */
  async function loadEnvelope(id: string) {
    return prisma.agreementEnvelope.findUnique({
      where: { id },
      include: { documents: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  type LoadedEnvelope = NonNullable<Awaited<ReturnType<typeof loadEnvelope>>>;

  /**
   * Resolve a signing token, or answer the request.
   *
   * Unknown → 404, generic. Voided, expired or changes-requested → 410 with the
   * status and NetEnroll's notice email. Signed or completed → 200 with the
   * status and nothing else. Otherwise the envelope, for the handler.
   */
  async function resolveSign(token: string, reply: FastifyReply): Promise<LoadedEnvelope | null> {
    const found = await prisma.agreementEnvelope.findUnique({
      where: { signTokenHash: hashToken(token) },
      select: { id: true, status: true, expiresAt: true },
    });
    if (!found) {
      void notFound(reply, 'This signing link is not valid.');
      return null;
    }
    if (OPEN.includes(found.status) && found.expiresAt.getTime() <= Date.now()) {
      await expireStaleEnvelopes(prisma, found.id);
    }
    const envelope = (await loadEnvelope(found.id))!;
    if (INACTIVE.includes(envelope.status)) {
      const noticeEmail = await noticeEmailForEnvelope(envelope);
      const issuer = publicIssuer(envelope);
      void reply.code(410).send({
        error: {
          code: 'LINK_INACTIVE',
          status: envelope.status,
          message:
            envelope.status === 'EXPIRED'
              ? 'This signing link has expired.'
              : envelope.status === 'VOIDED'
                ? `These agreements were withdrawn by ${issuer.shortName}.`
                : 'Changes were requested, so this signing link no longer works.',
          noticeEmail,
          issuer,
        },
      });
      return null;
    }
    if (envelope.status === 'COMPLETED' || envelope.status === 'SIGNED') {
      void reply.send({ data: { status: envelope.status } });
      return null;
    }
    return envelope;
  }

  /** The signing session, or a 401 that sends the page back to code entry. */
  async function requireSession(
    request: FastifyRequest,
    reply: FastifyReply,
    envelope: LoadedEnvelope
  ): Promise<boolean> {
    const header = request.headers['x-signing-session'];
    const token = Array.isArray(header) ? header[0] : header;
    if (token) {
      const session = await prisma.agreementSigningSession.findUnique({
        where: { tokenHash: hashToken(token) },
      });
      if (
        session &&
        session.envelopeId === envelope.id &&
        session.expiresAt.getTime() > Date.now()
      ) {
        return true;
      }
    }
    void reply.code(401).send({
      error: {
        code: 'SESSION_REQUIRED',
        message: 'Your verification has expired. Verify your email again to continue.',
      },
    });
    return false;
  }

  function evidence(request: FastifyRequest) {
    return { ipAddress: clientIp(request), userAgent: clientUserAgent(request) };
  }

  fastify.get<{ Params: { token: string } }>(
    '/api/v1/public/agreements/sign/:token',
    { config: tokenLimit },
    async (request, reply) => {
      const envelope = await resolveSign(request.params.token, reply);
      if (!envelope) return reply;
      const now = new Date();
      await prisma.$transaction(async tx => {
        await appendEvent(tx, envelope.id, {
          type: 'LINK_OPENED',
          actorType: 'SIGNER',
          ...evidence(request),
          occurredAt: now,
          detail: { first: envelope.viewedAt === null },
        });
        if (envelope.viewedAt === null) {
          await tx.agreementEnvelope.updateMany({
            where: { id: envelope.id, viewedAt: null, status: 'SENT' },
            data: { viewedAt: now, status: 'VIEWED' },
          });
        }
      });
      if (envelope.viewedAt === null) await notifyLifecycle(prisma, envelope.id, 'VIEWED');
      return reply.send({
        data: {
          status: envelope.viewedAt === null ? 'VIEWED' : envelope.status,
          agencyLegalName: agencyLabel(envelope),
          documents: titlesOf(envelope).map(title => ({ title })),
          signerEmailMasked: maskEmail(envelope.signerEmail),
          expiresAt: envelope.expiresAt,
          // From the envelope's frozen issuer, never the host: the page draws
          // this brand whichever hostname the link was opened on.
          issuer: publicIssuer(envelope),
        },
      });
    }
  );

  fastify.post<{ Params: { token: string } }>(
    '/api/v1/public/agreements/sign/:token/otp',
    { config: otpLimit },
    async (request, reply) => {
      const envelope = await resolveSign(request.params.token, reply);
      if (!envelope) return reply;
      const recent = await prisma.agreementOtp.count({
        where: {
          envelopeId: envelope.id,
          createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) },
        },
      });
      if (recent >= OTP_MAX_PER_HOUR) {
        return reply.code(429).send({
          error: {
            code: 'TOO_MANY_CODES',
            message: 'Too many codes have been sent in the last hour. Try again later.',
          },
        });
      }
      const code = newOtpCode();
      await prisma.agreementOtp.create({
        data: {
          envelopeId: envelope.id,
          codeHash: hashOtp(envelope.id, code),
          expiresAt: new Date(Date.now() + OTP_TTL_MS),
        },
      });
      const noticeEmail = await noticeEmailForEnvelope(envelope);
      const email = await sendOtpEmail({
        to: envelope.signerEmail,
        code,
        noticeEmail,
        issuer: emailIssuerOf(envelope),
      });
      await recordEvent(
        envelope.id,
        {
          type: 'OTP_SENT',
          actorType: 'SYSTEM',
          ...evidence(request),
          // Never the code.
          detail: { to: envelope.signerEmail, sent: email.sent, reason: email.reason ?? null },
        },
        prisma
      );
      if (!email.sent) {
        return reply.code(503).send({
          error: {
            code: 'CODE_NOT_SENT',
            message: `We could not email your code right now. Try again shortly, or contact ${noticeEmail}.`,
          },
        });
      }
      return reply.send({
        data: {
          sent: true,
          to: maskEmail(envelope.signerEmail),
          expiresInSeconds: OTP_TTL_MS / 1000,
        },
      });
    }
  );

  fastify.post<{ Params: { token: string } }>(
    '/api/v1/public/agreements/sign/:token/verify',
    { config: otpLimit },
    async (request, reply) => {
      const envelope = await resolveSign(request.params.token, reply);
      if (!envelope) return reply;
      const parsed = z
        .object({
          code: z
            .string()
            .trim()
            .regex(/^\d{6}$/),
        })
        .safeParse(request.body);
      if (!parsed.success) return validation(reply, 'Enter the 6-digit code from your email.');

      const otp = await prisma.agreementOtp.findFirst({
        where: { envelopeId: envelope.id, consumedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      if (!otp || otp.expiresAt.getTime() <= Date.now()) {
        return reply.code(400).send({
          error: { code: 'CODE_EXPIRED', message: 'That code has expired. Request a new one.' },
        });
      }
      if (otp.attempts >= OTP_MAX_ATTEMPTS) {
        return reply.code(423).send({
          error: { code: 'CODE_LOCKED', message: 'Too many wrong attempts. Request a new code.' },
        });
      }

      if (!digestsEqual(hashOtp(envelope.id, parsed.data.code), otp.codeHash)) {
        const updated = await prisma.agreementOtp.update({
          where: { id: otp.id },
          data: { attempts: { increment: 1 } },
        });
        await prisma.$transaction(async tx => {
          await appendEvent(tx, envelope.id, {
            type: 'OTP_FAILED',
            actorType: 'SIGNER',
            ...evidence(request),
            detail: { attempts: updated.attempts },
          });
          if (updated.attempts >= OTP_MAX_ATTEMPTS) {
            await appendEvent(tx, envelope.id, {
              type: 'OTP_LOCKED',
              actorType: 'SYSTEM',
              ...evidence(request),
              detail: { attempts: updated.attempts },
            });
          }
        });
        if (updated.attempts >= OTP_MAX_ATTEMPTS) {
          return reply.code(423).send({
            error: { code: 'CODE_LOCKED', message: 'Too many wrong attempts. Request a new code.' },
          });
        }
        return reply.code(400).send({
          error: {
            code: 'CODE_INCORRECT',
            message: 'That code is not right.',
            attemptsRemaining: OTP_MAX_ATTEMPTS - updated.attempts,
          },
        });
      }

      const claimed = await prisma.agreementOtp.updateMany({
        where: { id: otp.id, consumedAt: null, attempts: { lt: OTP_MAX_ATTEMPTS } },
        data: { consumedAt: new Date() },
      });
      if (claimed.count === 0) {
        return reply.code(400).send({
          error: {
            code: 'CODE_EXPIRED',
            message: 'That code has already been used. Request a new one.',
          },
        });
      }
      const session = mintToken();
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
      const ev = evidence(request);
      await prisma.$transaction(async tx => {
        await tx.agreementSigningSession.create({
          data: {
            envelopeId: envelope.id,
            tokenHash: session.hash,
            expiresAt,
            ipAddress: ev.ipAddress,
            userAgent: ev.userAgent,
          },
        });
        await appendEvent(tx, envelope.id, {
          type: 'OTP_VERIFIED',
          actorType: 'SIGNER',
          actorEmail: envelope.signerEmail,
          ...ev,
          detail: { method: 'email_otp', to: envelope.signerEmail },
        });
      });
      return reply.send({ data: { sessionToken: session.token, expiresAt } });
    }
  );

  fastify.get<{ Params: { token: string } }>(
    '/api/v1/public/agreements/sign/:token/documents',
    { config: tokenLimit },
    async (request, reply) => {
      const envelope = await resolveSign(request.params.token, reply);
      if (!envelope) return reply;
      if (!(await requireSession(request, reply, envelope))) return reply;
      const terms = envelope.terms as unknown as FrozenTerms;
      const reviewed = await prisma.agreementEvent.findMany({
        where: { envelopeId: envelope.id, type: 'DOCUMENT_REVIEWED' },
        select: { detail: true },
      });
      const reviewedIds = new Set(
        reviewed.map(r => (r.detail as Record<string, unknown>).documentId as string)
      );
      const noticeEmail = terms.netenroll.noticeEmail;
      // Until the agency has entered its details there is nothing to review:
      // the documents are completed with them.
      const partyRequired = needsPartyDetails(envelope);
      const individual = isIndividual(envelope);
      return reply.send({
        data: {
          partyRequired,
          party: envelope.partyDetails ?? null,
          partyPrefill: partyRequired ? await partyPrefill(envelope, prisma) : null,
          inviteeOrganization: envelope.inviteeOrganization,
          titles: titlesOf(envelope),
          individual,
          documents: partyRequired
            ? []
            : envelope.documents.map(doc => ({
                id: doc.id,
                kind: doc.kind,
                title: doc.title,
                html: signableHtml(doc),
                acceptanceStatement: acceptanceStatement(doc.title),
                reviewed: reviewedIds.has(doc.id),
              })),
          disclosure: {
            version: disclosureVersionFor(disclosureIssuerOf(envelope)),
            html: issuerDisclosureHtml(disclosureIssuerOf(envelope), noticeEmail),
            text: issuerDisclosureText(disclosureIssuerOf(envelope), noticeEmail),
            checkboxLabel: ESIGN_DISCLOSURE_V1.checkbox,
          },
          issuer: publicIssuer(envelope),
          consented: envelope.consentedAt !== null,
          signer: {
            name: envelope.signerName,
            title: envelope.signerTitle,
            email: envelope.signerEmail,
          },
          agencyLegalName: agencyLabel(envelope),
          intentStatement: partyRequired
            ? null
            : intentStatement({
                signerName: envelope.signerName,
                titles: titlesOf(envelope),
                agencyLegalName: agencyLabel(envelope),
                individual,
              }),
          noticeEmail,
        },
      });
    }
  );

  fastify.post<{ Params: { token: string } }>(
    '/api/v1/public/agreements/sign/:token/consent',
    { config: tokenLimit },
    async (request, reply) => {
      const envelope = await resolveSign(request.params.token, reply);
      if (!envelope) return reply;
      if (!(await requireSession(request, reply, envelope))) return reply;
      const parsed = z
        .object({ accepted: z.literal(true), disclosureVersion: z.string() })
        .safeParse(request.body);
      if (!parsed.success) return validation(reply, 'Accept the disclosure to continue.');
      const disclosureIssuer = disclosureIssuerOf(envelope);
      if (parsed.data.disclosureVersion !== disclosureVersionFor(disclosureIssuer)) {
        return validation(reply, 'The disclosure has changed. Reload the page and read it again.');
      }
      const noticeEmail = (envelope.terms as unknown as FrozenTerms).netenroll.noticeEmail;
      const now = new Date();
      await prisma.$transaction(async tx => {
        await appendEvent(tx, envelope.id, {
          type: 'CONSENT_GIVEN',
          actorType: 'SIGNER',
          actorEmail: envelope.signerEmail,
          ...evidence(request),
          occurredAt: now,
          detail: {
            disclosureVersion: disclosureVersionFor(disclosureIssuer),
            disclosureSha256: issuerDisclosureSha256(disclosureIssuer, noticeEmail),
            checkboxLabel: ESIGN_DISCLOSURE_V1.checkbox,
          },
        });
        await tx.agreementEnvelope.update({
          where: { id: envelope.id },
          data: { consentedAt: now },
        });
      });
      return reply.send({ data: { consented: true } });
    }
  );

  fastify.post<{ Params: { token: string } }>(
    '/api/v1/public/agreements/sign/:token/reviewed',
    { config: tokenLimit },
    async (request, reply) => {
      const envelope = await resolveSign(request.params.token, reply);
      if (!envelope) return reply;
      if (!(await requireSession(request, reply, envelope))) return reply;
      const parsed = z.object({ documentId: z.string() }).safeParse(request.body);
      const doc = parsed.success
        ? envelope.documents.find(d => d.id === parsed.data.documentId)
        : undefined;
      if (!doc) return validation(reply, 'Unknown document.');
      if (needsPartyDetails(envelope)) {
        return validation(reply, 'Enter your details before reviewing the agreements.');
      }
      const already = await prisma.agreementEvent.findFirst({
        where: {
          envelopeId: envelope.id,
          type: 'DOCUMENT_REVIEWED',
          detail: { path: ['documentId'], equals: doc.id },
        },
        select: { id: true },
      });
      if (!already) {
        await recordEvent(
          envelope.id,
          {
            type: 'DOCUMENT_REVIEWED',
            actorType: 'SIGNER',
            actorEmail: envelope.signerEmail,
            ...evidence(request),
            detail: {
              documentId: doc.id,
              kind: doc.kind,
              reviewedSha256: signableSha256(doc),
              sentHtmlSha256: doc.sentHtmlSha256,
              presentedHtmlSha256: doc.presentedHtmlSha256 ?? null,
            },
          },
          prisma
        );
      }
      return reply.send({ data: { reviewed: true, documentId: doc.id } });
    }
  );

  /**
   * The agency enters its own details: as a business, or as an individual
   * licensed agent. Once, after consenting and before reviewing; the documents
   * are completed with them and frozen. See services/agreements/party.ts.
   */
  fastify.post<{ Params: { token: string } }>(
    '/api/v1/public/agreements/sign/:token/details',
    { config: tokenLimit },
    async (request, reply) => {
      const envelope = await resolveSign(request.params.token, reply);
      if (!envelope) return reply;
      if (!(await requireSession(request, reply, envelope))) return reply;
      if (!envelope.consentedAt) {
        return validation(reply, 'Accept the electronic records disclosure first.');
      }
      try {
        const party = await submitPartyDetails(
          envelope.id,
          request.body,
          evidence(request),
          prisma
        );
        await notifyLifecycle(prisma, envelope.id, 'DETAILS_ENTERED');
        return reply.send({ data: { saved: true, kind: party.kind } });
      } catch (error) {
        const handled = sendAgreementError(reply, error);
        if (handled) return handled;
        throw error;
      }
    }
  );

  const signSchema = z.object({
    typedName: z.string().trim().min(2).max(100),
    title: z.string().trim().min(1).max(120),
    initials: z.string().trim(),
    method: z.enum(['TYPED', 'DRAWN']),
    drawnPng: z.string().optional().nullable(),
    acceptances: z.record(z.boolean()),
    intentAccepted: z.literal(true),
  });

  fastify.post<{ Params: { token: string } }>(
    '/api/v1/public/agreements/sign/:token/sign',
    { config: tokenLimit, bodyLimit: 1024 * 1024 },
    async (request, reply) => {
      const envelope = await resolveSign(request.params.token, reply);
      if (!envelope) return reply;
      if (!(await requireSession(request, reply, envelope))) return reply;

      const parsed = signSchema.safeParse(request.body);
      if (!parsed.success) {
        const intent = parsed.error.issues.some(i => i.path[0] === 'intentAccepted');
        return validation(
          reply,
          intent
            ? 'Confirm the statement above the Sign Agreements button.'
            : parsed.error.issues[0]?.path[0] === 'typedName'
              ? 'Type your full name (2 to 100 characters).'
              : 'Some of the signing details are missing.'
        );
      }
      const body = parsed.data;
      if (!envelope.consentedAt) {
        return validation(reply, 'Accept the electronic records disclosure before signing.');
      }
      if (needsPartyDetails(envelope)) {
        return validation(reply, 'Enter your details before signing.');
      }
      const individual = isIndividual(envelope);
      // An individual licensed agent signs for themselves, in no other capacity.
      const signerTitle = individual ? INDIVIDUAL_SIGNER_TITLE : body.title;
      const reviewed = await prisma.agreementEvent.findMany({
        where: { envelopeId: envelope.id, type: 'DOCUMENT_REVIEWED' },
        select: { detail: true },
      });
      const reviewedIds = new Set(
        reviewed.map(r => (r.detail as Record<string, unknown>).documentId as string)
      );
      const unreviewed = envelope.documents.filter(d => !reviewedIds.has(d.id));
      if (unreviewed.length > 0) {
        return validation(
          reply,
          `Read each agreement to the end before signing. Not yet reviewed: ${unreviewed.map(d => d.title).join(', ')}.`
        );
      }
      const unaccepted = envelope.documents.filter(d => body.acceptances[d.id] !== true);
      if (unaccepted.length > 0) {
        return validation(
          reply,
          `Tick the box agreeing to each document. Not yet agreed: ${unaccepted.map(d => d.title).join(', ')}.`
        );
      }
      if (normaliseName(body.typedName) !== normaliseName(envelope.signerName)) {
        return validation(
          reply,
          `Type your name exactly as it appears on the agreements: ${envelope.signerName}. These agreements were issued to that named person; if that is not you, select Request changes.`
        );
      }
      if (!/^[A-Za-z]{1,4}$/.test(body.initials)) {
        return validation(reply, 'Initials must be 1 to 4 letters.');
      }

      let png: Buffer | null = null;
      if (body.method === 'DRAWN') {
        if (!body.drawnPng) return validation(reply, 'Draw your signature, or switch to Type.');
        const result = parseSignaturePng(body.drawnPng);
        if (typeof result === 'string') return validation(reply, result);
        png = result;
      }

      const terms = envelope.terms as unknown as FrozenTerms;
      const titles = titlesOf(envelope);
      const intent = intentStatement({
        signerName: envelope.signerName,
        titles,
        agencyLegalName: agencyLabel(envelope),
        individual,
      });

      let signatureImageKey: string | null = null;
      let signatureImageSha256: string | null = null;
      if (png) {
        const storage = getAgreementsStorageService();
        signatureImageKey = `agreements/${envelope.id}/signature.png`;
        signatureImageSha256 = sha256Hex(png);
        if (await storage.objectExists(signatureImageKey)) {
          // Left by an attempt whose transaction did not commit. Never replaced.
          const existing = await storage.getObjectBuffer(signatureImageKey);
          if (sha256Hex(existing) !== signatureImageSha256) {
            return reply.code(409).send({
              error: {
                code: 'SIGNATURE_CONFLICT',
                message: `Your signature could not be recorded. Contact ${terms.netenroll.noticeEmail}.`,
              },
            });
          }
        } else {
          await storage.putObjectOnce(signatureImageKey, png, 'image/png');
        }
      }

      const signedAt = new Date();
      const initials = body.initials.toUpperCase();
      const committed = await prisma.$transaction(async tx => {
        const claimed = await tx.agreementEnvelope.updateMany({
          where: { id: envelope.id, status: { in: OPEN } },
          data: {
            status: 'SIGNED',
            signedAt,
            signerTypedSignature: body.typedName.trim().replace(/\s+/g, ' '),
            signerInitials: initials,
            signatureMethod: body.method,
            signatureImageKey,
          },
        });
        if (claimed.count === 0) return false;
        await appendEvent(tx, envelope.id, {
          type: 'SIGNED',
          actorType: 'SIGNER',
          actorEmail: envelope.signerEmail,
          ...evidence(request),
          occurredAt: signedAt,
          detail: {
            typedName: body.typedName.trim().replace(/\s+/g, ' '),
            title: signerTitle,
            initials,
            method: body.method,
            signatureImageSha256,
            documentHashes: Object.fromEntries(
              envelope.documents.map(d => [d.id, signableSha256(d)])
            ),
            intentStatement: intent,
            acceptanceStatements: Object.fromEntries(
              envelope.documents.map(d => [d.id, acceptanceStatement(d.title)])
            ),
          },
        });
        return true;
      });
      if (!committed) {
        const now = await prisma.agreementEnvelope.findUniqueOrThrow({
          where: { id: envelope.id },
        });
        return reply.send({ data: { status: now.status } });
      }
      await notifyLifecycle(prisma, envelope.id, 'SIGNED');

      try {
        const result = await completeEnvelope(envelope.id, prisma);
        return reply.send({
          data: {
            status: 'COMPLETED',
            downloadToken: result.downloadToken,
            downloadUrl: result.downloadToken
              ? downloadPageUrl(result.downloadToken, issuerOfEnvelope(envelope))
              : null,
            email: envelope.signerEmail,
          },
        });
      } catch (error) {
        const message = (error as Error).message;
        logger.error({
          msg: 'Agreement completion failed after signing',
          envelopeId: envelope.id,
          err: error,
        });
        await recordEvent(
          envelope.id,
          {
            type: 'COMPLETION_FAILED',
            actorType: 'SYSTEM',
            detail: { error: message, trigger: 'signing' },
          },
          prisma
        ).catch((err: unknown) => logger.error({ msg: 'Could not record COMPLETION_FAILED', err }));
        await sendCompletionFailedAlert({
          to: await internalAlertsTo(envelope),
          reference: envelope.reference,
          agencyLegalName: agencyLabel(envelope),
          error: message,
          adminUrl: adminEnvelopeUrl(envelope.id, issuerOfEnvelope(envelope)),
          issuer: emailIssuerOf(envelope),
        });
        return reply.send({
          data: {
            status: 'SIGNED',
            message:
              'Your signature is recorded. Your executed copies will be emailed to you shortly.',
            email: envelope.signerEmail,
          },
        });
      }
    }
  );

  fastify.post<{ Params: { token: string } }>(
    '/api/v1/public/agreements/sign/:token/request-changes',
    { config: tokenLimit },
    async (request, reply) => {
      const envelope = await resolveSign(request.params.token, reply);
      if (!envelope) return reply;
      if (!(await requireSession(request, reply, envelope))) return reply;
      const parsed = z.object({ note: z.string().trim().min(1).max(2000) }).safeParse(request.body);
      if (!parsed.success)
        return validation(reply, 'Describe the changes you need (up to 2000 characters).');
      const now = new Date();
      const done = await prisma.$transaction(async tx => {
        const claimed = await tx.agreementEnvelope.updateMany({
          where: { id: envelope.id, status: { in: OPEN } },
          data: {
            status: 'CHANGES_REQUESTED',
            changesRequestedAt: now,
            changesNote: parsed.data.note,
          },
        });
        if (claimed.count === 0) return false;
        await appendEvent(tx, envelope.id, {
          type: 'CHANGES_REQUESTED',
          actorType: 'SIGNER',
          actorEmail: envelope.signerEmail,
          ...evidence(request),
          occurredAt: now,
          detail: { note: parsed.data.note },
        });
        return true;
      });
      if (!done)
        return reply.code(409).send({
          error: { code: 'STATE_CHANGED', message: 'This agreement can no longer be changed.' },
        });
      await notifyLifecycle(prisma, envelope.id, 'CHANGES_REQUESTED');
      await sendChangesRequestedAlert({
        to: await internalAlertsTo(envelope),
        reference: envelope.reference,
        agencyLegalName: agencyLabel(envelope),
        signerName: envelope.signerName,
        signerEmail: envelope.signerEmail,
        note: parsed.data.note,
        adminUrl: adminEnvelopeUrl(envelope.id, issuerOfEnvelope(envelope)),
        issuer: emailIssuerOf(envelope),
      });
      return reply.send({
        data: { status: 'CHANGES_REQUESTED', noticeEmail: await noticeEmailForEnvelope(envelope) },
      });
    }
  );

  /** Resolve a download token, or answer 410 with where to ask for a copy. */
  async function resolveDownload(
    token: string,
    reply: FastifyReply
  ): Promise<LoadedEnvelope | null> {
    const found = await prisma.agreementEnvelope.findUnique({
      where: { downloadTokenHash: hashToken(token) },
      select: { id: true, status: true, downloadTokenExpiresAt: true },
    });
    if (
      !found ||
      found.status !== 'COMPLETED' ||
      !found.downloadTokenExpiresAt ||
      found.downloadTokenExpiresAt.getTime() <= Date.now()
    ) {
      const owner = found
        ? await prisma.agreementEnvelope.findUnique({ where: { id: found.id } })
        : null;
      const noticeEmail = await noticeEmailForEnvelope(owner);
      void reply.code(410).send({
        error: {
          code: 'LINK_EXPIRED',
          message: `This link has expired. Contact ${noticeEmail} for a new copy.`,
          noticeEmail,
          ...(owner ? { issuer: publicIssuer(owner) } : {}),
        },
      });
      return null;
    }
    return (await loadEnvelope(found.id))!;
  }

  fastify.get<{ Params: { token: string } }>(
    '/api/v1/public/agreements/download/:token',
    { config: tokenLimit },
    async (request, reply) => {
      const envelope = await resolveDownload(request.params.token, reply);
      if (!envelope) return reply;
      return reply.send({
        data: {
          reference: envelope.reference,
          agencyLegalName: agencyLabel(envelope),
          completedAt: envelope.completedAt,
          sealed: envelope.sealed,
          issuer: publicIssuer(envelope),
          documents: envelope.documents.map(doc => ({
            id: doc.id,
            kind: doc.kind,
            title: doc.title,
            fileName: executedFileName(agencyLabel(envelope), doc.kind, envelope.reference),
            bytes: doc.executedPdfBytes,
            sha256: doc.executedPdfSha256,
          })),
        },
      });
    }
  );

  fastify.get<{ Params: { token: string; documentFile: string } }>(
    '/api/v1/public/agreements/download/:token/:documentFile',
    { config: tokenLimit },
    async (request, reply) => {
      const envelope = await resolveDownload(request.params.token, reply);
      if (!envelope) return reply;
      const documentId = request.params.documentFile.replace(/\.pdf$/, '');
      const doc = envelope.documents.find(d => d.id === documentId);
      if (!doc || documentId === request.params.documentFile || !doc.executedPdfKey) {
        return notFound(reply, 'Document not found');
      }
      return serveExecutedPdf(request, reply, envelope, doc, async () => {
        await recordEvent(
          envelope.id,
          {
            type: 'DOWNLOADED',
            actorType: 'SIGNER',
            ...evidence(request),
            detail: { documentId: doc.id, kind: doc.kind, sha256: doc.executedPdfSha256 },
          },
          prisma
        );
      });
    }
  );

  fastify.get<{ Querystring: { sha256?: string } }>(
    '/api/v1/public/agreements/verify',
    { config: verifyLimit },
    async (request, reply) => {
      const sha = (request.query.sha256 ?? '').trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(sha)) return validation(reply, 'Provide a 64-character SHA-256.');
      const doc = await prisma.agreementDocument.findUnique({
        where: { executedPdfSha256: sha },
        include: { envelope: true },
      });
      if (!doc || doc.envelope.status !== 'COMPLETED')
        return reply.send({ data: { match: false } });
      return reply.send({
        data: {
          match: true,
          reference: doc.envelope.reference,
          documentTitle: doc.title,
          agencyLegalName: agencyLabel(doc.envelope),
          completedAt: doc.envelope.completedAt,
          sealed: doc.envelope.sealed,
          issuer: publicIssuer(doc.envelope),
        },
      });
    }
  );
}
