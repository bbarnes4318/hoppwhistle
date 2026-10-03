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
  AgreementDocument,
  AgreementEnvelope,
  AgreementStatus,
  PrismaClient,
} from '@prisma/client';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { clientIp, clientUserAgent } from '../lib/client-ip.js';
import { decryptField } from '../lib/field-encryption.js';
import { logger } from '../lib/logger.js';
import { PLATFORM_ADMIN_REQUIRED, requirePlatformAdmin } from '../lib/platform-context.js';
import { getPrismaClient } from '../lib/prisma.js';
import { getActingUserId } from '../lib/tenant-context.js';
import { authenticate } from '../middleware/auth.js';
import { preloadAgreementAssets } from '../services/agreements/assets.js';
import {
  adminEnvelopeUrl,
  completeEnvelope,
  deliverExecutedCopies,
  downloadPageUrl,
  DOWNLOAD_TOKEN_TTL_MS,
  executedFileName,
  readVerifiedPdf,
} from '../services/agreements/complete.js';
import {
  acceptanceStatement,
  disclosureHtml,
  disclosureSha256,
  disclosureText,
  ESIGN_DISCLOSURE_V1,
  ESIGN_DISCLOSURE_VERSION,
  intentStatement,
} from '../services/agreements/documents.js';
import {
  sendChangesRequestedAlert,
  sendCompletionFailedAlert,
  sendInvitationEmail,
  sendOtpEmail,
  sendVoidedEmail,
} from '../services/agreements/emails.js';
import {
  AgreementError,
  createEnvelope,
  expireStaleEnvelopes,
  prepareEnvelope,
  previewDocuments,
  signUrlFor,
} from '../services/agreements/envelopes.js';
import { appendEvent, recordEvent, verifyEventChain } from '../services/agreements/events.js';
import { maskEmail, sha256Hex } from '../services/agreements/format.js';
import {
  agencyLabel,
  agencyOf,
  isIndividual,
  needsPartyDetails,
  partyPrefill,
  signableHtml,
  signableSha256,
  submitPartyDetails,
} from '../services/agreements/party.js';
import {
  loadAgreementSettings,
  missingSetting,
  noticeEmailOf,
  SETTINGS_ID,
} from '../services/agreements/settings.js';
import { INDIVIDUAL_SIGNER_TITLE, type FrozenTerms } from '../services/agreements/terms.js';
import {
  digestsEqual,
  hashOtp,
  hashToken,
  mintToken,
  newOtpCode,
} from '../services/agreements/tokens.js';
import { auditLog } from '../services/audit.js';
import { getAgreementsStorageService } from '../services/storage.js';

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

function titlesOf(envelope: { documents: Array<{ title: string; sortOrder: number }> }): string[] {
  return [...envelope.documents].sort((a, b) => a.sortOrder - b.sortOrder).map(d => d.title);
}

function legalNameOf(
  envelope: Pick<AgreementEnvelope, 'terms' | 'partyDetails' | 'inviteeOrganization' | 'signerName'>
): string {
  return agencyLabel(envelope);
}

// eslint-disable-next-line @typescript-eslint/require-await -- plugin signature
export async function registerAgreementRoutes(fastify: FastifyInstance): Promise<void> {
  const prisma: PrismaClient = getPrismaClient();
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

  async function actorOf(request: FastifyRequest) {
    const userId = getActingUserId(request)!;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    return {
      userId,
      email: user?.email ?? null,
      ipAddress: clientIp(request),
      userAgent: clientUserAgent(request),
    };
  }

  async function audit(
    request: FastifyRequest,
    action: string,
    envelope: { id: string; tenantId: string | null } | null,
    changes: Record<string, unknown> = {},
    success = true,
    error?: string
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
      success,
      error,
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // Admin
  // ════════════════════════════════════════════════════════════════════════

  fastify.get('/api/v1/platform/agreements/settings', admin, async (_request, reply) => {
    const settings = await loadAgreementSettings(prisma);
    return reply.send({ data: { ...settings, missing: missingSetting(settings) } });
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
    const before = await loadAgreementSettings(prisma);
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
    const settings = await prisma.agreementSettings.update({ where: { id: SETTINGS_ID }, data });
    await audit(request, 'agreements.settings.updated', null, {
      before: {
        netenrollNoticeAddress: before.netenrollNoticeAddress,
        netenrollNoticeEmail: before.netenrollNoticeEmail,
        defaultSignatoryName: before.defaultSignatoryName,
        defaultSignatoryTitle: before.defaultSignatoryTitle,
        internalCopyEmails: before.internalCopyEmails,
      },
      after: data,
    });
    return reply.send({ data: { ...settings, missing: missingSetting(settings) } });
  });

  fastify.get<{ Querystring: { q?: string } }>(
    '/api/v1/platform/agreements/agencies',
    admin,
    async (request, reply) => {
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
      const msas =
        tenantIds.length === 0
          ? []
          : await prisma.agreementEnvelope.findMany({
              where: { tenantId: { in: tenantIds }, status: 'COMPLETED', includesMsa: true },
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

  fastify.post('/api/v1/platform/agreements/preview', admin, async (request, reply) => {
    try {
      const settings = await loadAgreementSettings(prisma);
      const prepared = await prepareEnvelope(request.body, settings, prisma);
      const documents = previewDocuments(prepared);
      return reply.send({
        data: { documents: documents.map(d => ({ kind: d.kind, title: d.title, html: d.html })) },
      });
    } catch (error) {
      const handled = sendAgreementError(reply, error);
      if (handled) return handled;
      throw error;
    }
  });

  fastify.post('/api/v1/platform/agreements', admin, async (request, reply) => {
    try {
      const settings = await loadAgreementSettings(prisma);
      const prepared = await prepareEnvelope(request.body, settings, prisma);
      const actor = await actorOf(request);
      const created = await createEnvelope(prepared, actor, prisma);
      await audit(request, 'agreements.sent', created.envelope, {
        reference: created.envelope.reference,
        documents: prepared.kinds,
        signerEmail: prepared.signerEmail,
        ccEmails: prepared.ccEmails,
        emailSent: created.email.sent,
      });
      return reply.code(201).send({
        data: {
          envelope: summarise(created.envelope),
          signUrl: created.signUrl,
          emailSent: created.email.sent,
          emailReason: created.email.reason ?? null,
        },
      });
    } catch (error) {
      const handled = sendAgreementError(reply, error);
      if (handled) return handled;
      throw error;
    }
  });

  function summarise(envelope: AgreementEnvelope) {
    return {
      id: envelope.id,
      reference: envelope.reference,
      status: envelope.status,
      tenantId: envelope.tenantId,
      agencyLegalName: legalNameOf(envelope),
      includesMsa: envelope.includesMsa,
      includesCpa: envelope.includesCpa,
      includesCpl: envelope.includesCpl,
      signerName: envelope.signerName,
      signerTitle: envelope.signerTitle,
      signerEmail: envelope.signerEmail,
      ccEmails: envelope.ccEmails,
      sentAt: envelope.sentAt,
      viewedAt: envelope.viewedAt,
      signedAt: envelope.signedAt,
      completedAt: envelope.completedAt,
      expiresAt: envelope.expiresAt,
      voidedAt: envelope.voidedAt,
      changesRequestedAt: envelope.changesRequestedAt,
      sealed: envelope.sealed,
      inviteeOrganization: envelope.inviteeOrganization,
      detailsEntered: !needsPartyDetails(envelope),
      partyKind: agencyOf(envelope)?.kind ?? (needsPartyDetails(envelope) ? null : 'BUSINESS'),
    };
  }

  const STATUS_VALUES: AgreementStatus[] = [
    'SENT',
    'VIEWED',
    'SIGNED',
    'COMPLETED',
    'CHANGES_REQUESTED',
    'VOIDED',
    'EXPIRED',
  ];

  fastify.get<{ Querystring: { status?: string; q?: string; page?: string } }>(
    '/api/v1/platform/agreements',
    admin,
    async (request, reply) => {
      await expireStaleEnvelopes(prisma);
      const statuses = (request.query.status ?? '')
        .split(',')
        .map(s => s.trim().toUpperCase())
        .filter((s): s is AgreementStatus => STATUS_VALUES.includes(s as AgreementStatus));
      const q = (request.query.q ?? '').trim();
      const page = Math.max(1, Number.parseInt(request.query.page ?? '1', 10) || 1);
      const pageSize = 25;

      let idFilter: string[] | undefined;
      if (q) {
        const like = `%${q.replace(/[\\%_]/g, m => `\\${m}`)}%`;
        const rows = await prisma.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "agreement_envelopes"
          WHERE "reference" ILIKE ${like}
             OR "signerName" ILIKE ${like}
             OR "signerEmail" ILIKE ${like}
             OR ("terms"->'agency'->>'legalName') ILIKE ${like}
             OR ("partyDetails"->>'legalName') ILIKE ${like}
             OR ("partyDetails"->>'dbaName') ILIKE ${like}
             OR "inviteeOrganization" ILIKE ${like}`;
        idFilter = rows.map(r => r.id);
      }
      const where = {
        ...(statuses.length > 0 ? { status: { in: statuses } } : {}),
        ...(idFilter ? { id: { in: idFilter } } : {}),
      };
      const [total, rows] = await Promise.all([
        prisma.agreementEnvelope.count({ where }),
        prisma.agreementEnvelope.findMany({
          where,
          orderBy: { sentAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
      const activity =
        rows.length === 0
          ? []
          : await prisma.agreementEvent.groupBy({
              by: ['envelopeId'],
              where: { envelopeId: { in: rows.map(r => r.id) } },
              _max: { occurredAt: true },
            });
      const lastActivity = new Map(activity.map(a => [a.envelopeId, a._max.occurredAt]));
      return reply.send({
        data: {
          items: rows.map(row => ({
            ...summarise(row),
            lastActivityAt: lastActivity.get(row.id) ?? row.sentAt,
          })),
          total,
          page,
          pageSize,
        },
      });
    }
  );

  async function loadEnvelope(id: string) {
    if (!z.string().uuid().safeParse(id).success) return null;
    return prisma.agreementEnvelope.findUnique({
      where: { id },
      include: { documents: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  fastify.get<{ Params: { id: string } }>(
    '/api/v1/platform/agreements/:id',
    admin,
    async (request, reply) => {
      if (z.string().uuid().safeParse(request.params.id).success) {
        await expireStaleEnvelopes(prisma, request.params.id);
      }
      const envelope = await loadEnvelope(request.params.id);
      if (!envelope) return notFound(reply);
      const [events, chain, sender, existingMsa] = await Promise.all([
        prisma.agreementEvent.findMany({
          where: { envelopeId: envelope.id },
          orderBy: { seq: 'asc' },
        }),
        verifyEventChain(envelope.id, prisma),
        prisma.user.findUnique({ where: { id: envelope.sentByUserId }, select: { email: true } }),
        envelope.existingMsaEnvelopeId
          ? prisma.agreementEnvelope.findUnique({
              where: { id: envelope.existingMsaEnvelopeId },
              select: { id: true, reference: true },
            })
          : Promise.resolve(null),
      ]);
      return reply.send({
        data: {
          ...summarise(envelope),
          terms: envelope.terms,
          partyDetails: envelope.partyDetails,
          partySubmittedAt: envelope.partySubmittedAt,
          existingMsa,
          netenrollSignatoryName: envelope.netenrollSignatoryName,
          netenrollSignatoryTitle: envelope.netenrollSignatoryTitle,
          netenrollSignedAt: envelope.netenrollSignedAt,
          netenrollSignedIp: envelope.netenrollSignedIp,
          sentByEmail: sender?.email ?? null,
          voidReason: envelope.voidReason,
          changesNote: envelope.changesNote,
          signerTypedSignature: envelope.signerTypedSignature,
          signerInitials: envelope.signerInitials,
          signatureMethod: envelope.signatureMethod,
          documents: envelope.documents.map(doc => ({
            id: doc.id,
            kind: doc.kind,
            title: doc.title,
            templateVersion: doc.templateVersion,
            sentHtmlSha256: doc.sentHtmlSha256,
            presentedHtmlSha256: doc.presentedHtmlSha256,
            contentPdfSha256: doc.contentPdfSha256,
            executedPdfSha256: doc.executedPdfSha256,
            executedPdfBytes: doc.executedPdfBytes,
            pageCount: doc.pageCount,
            fileName: executedFileName(legalNameOf(envelope), doc.kind, envelope.reference),
          })),
          events: events.map(e => ({
            seq: e.seq,
            type: e.type,
            occurredAt: e.occurredAt,
            actorType: e.actorType,
            actorEmail: e.actorEmail,
            ipAddress: e.ipAddress,
            userAgent: e.userAgent,
            detail: e.detail,
            hash: e.hash,
          })),
          chainValid: chain.ok,
          chainBrokenAt: chain.ok ? null : chain.brokenSeq,
        },
      });
    }
  );

  /*
   * sent.html: the offer exactly as NetEnroll signed and sent it.
   * presented.html: the same document completed with the agency's own details,
   * the text the signer reviewed and signed (404 until they have entered them).
   */
  for (const version of ['sent', 'presented'] as const) {
    fastify.get<{ Params: { id: string; documentId: string } }>(
      `/api/v1/platform/agreements/:id/documents/:documentId/${version}.html`,
      admin,
      async (request, reply) => {
        const envelope = await loadEnvelope(request.params.id);
        const doc = envelope?.documents.find(d => d.id === request.params.documentId);
        const html = version === 'sent' ? doc?.sentHtml : doc?.presentedHtml;
        if (!envelope || !doc || !html) return notFound(reply, 'Document not found');
        await audit(request, `agreements.document.viewed_as_${version}`, envelope, {
          documentId: doc.id,
          kind: doc.kind,
        });
        return reply
          .header('Content-Type', 'text/html; charset=utf-8')
          .header(
            'Content-Security-Policy',
            "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'"
          )
          .header('X-Content-Type-Options', 'nosniff')
          .send(html);
      }
    );
  }

  fastify.get<{ Params: { id: string; documentFile: string } }>(
    '/api/v1/platform/agreements/:id/documents/:documentFile',
    admin,
    async (request, reply) => {
      const documentId = request.params.documentFile.replace(/\.pdf$/, '');
      if (documentId === request.params.documentFile) return notFound(reply, 'Document not found');
      const envelope = await loadEnvelope(request.params.id);
      const doc = envelope?.documents.find(d => d.id === documentId);
      if (!envelope || !doc) return notFound(reply, 'Document not found');
      if (envelope.status !== 'COMPLETED' || !doc.executedPdfKey) {
        return reply.code(409).send({
          error: { code: 'NOT_COMPLETED', message: 'This agreement is not executed yet.' },
        });
      }
      return streamExecutedPdf(request, reply, envelope, doc, async () => {
        await audit(request, 'agreements.document.downloaded', envelope, {
          documentId: doc.id,
          kind: doc.kind,
          sha256: doc.executedPdfSha256,
        });
      });
    }
  );

  async function streamExecutedPdf(
    request: FastifyRequest,
    reply: FastifyReply,
    envelope: AgreementEnvelope,
    doc: AgreementDocument,
    onServed: () => Promise<void>
  ): Promise<FastifyReply> {
    let bytes: Buffer;
    try {
      bytes = await readVerifiedPdf(doc);
    } catch (error) {
      const err = error as Error & { code?: string; actual?: string };
      logger.error({
        msg: 'Executed agreement PDF failed its integrity check; refusing to serve it',
        envelopeId: envelope.id,
        documentId: doc.id,
        err: error,
      });
      await auditLog({
        tenantId: envelope.tenantId,
        userId: getActingUserId(request) ?? undefined,
        action: 'agreements.document.integrity_failed',
        entityType: 'AgreementDocument',
        entityId: doc.id,
        resource: request.url,
        method: request.method,
        changes: {
          envelopeId: envelope.id,
          expectedSha256: doc.executedPdfSha256,
          actualSha256: err.actual ?? null,
        },
        ipAddress: clientIp(request) ?? undefined,
        userAgent: clientUserAgent(request) ?? undefined,
        requestId: request.id,
        success: false,
        error: err.message,
      });
      return reply.code(500).send({
        error: {
          code: 'INTEGRITY_CHECK_FAILED',
          message:
            'This file failed its integrity check and was not served. NetEnroll has been notified.',
        },
      });
    }
    await onServed();
    return reply
      .header('Content-Type', 'application/pdf')
      .header(
        'Content-Disposition',
        `attachment; filename="${executedFileName(legalNameOf(envelope), doc.kind, envelope.reference)}"`
      )
      .header('Content-Length', String(bytes.length))
      .header('Cache-Control', 'no-store')
      .header('X-Content-SHA256', doc.executedPdfSha256 ?? '')
      .send(bytes);
  }

  fastify.post<{ Params: { id: string } }>(
    '/api/v1/platform/agreements/:id/resend',
    admin,
    async (request, reply) => {
      const envelope = await loadEnvelope(request.params.id);
      if (!envelope) return notFound(reply);
      await expireStaleEnvelopes(prisma, envelope.id);
      const current = await prisma.agreementEnvelope.findUniqueOrThrow({
        where: { id: envelope.id },
      });
      if (!OPEN.includes(current.status)) {
        return reply.code(409).send({
          error: {
            code: 'NOT_RESENDABLE',
            message: `Only an agreement awaiting signature can be resent; this one is ${current.status}.`,
          },
        });
      }
      const token = decryptField(current.signTokenEnc);
      if (!token) {
        return reply.code(409).send({
          error: {
            code: 'NO_LINK',
            message: 'The signing link for this agreement cannot be rebuilt.',
          },
        });
      }
      const signUrl = signUrlFor(token);
      const settings = await loadAgreementSettings(prisma);
      const email = await sendInvitationEmail({
        to: current.signerEmail,
        signerName: current.signerName,
        agencyLegalName: legalNameOf(current),
        documentTitles: titlesOf(envelope),
        signUrl,
        expiresAt: current.expiresAt,
        noticeEmail: noticeEmailOf(settings),
        resend: true,
      });
      const actor = await actorOf(request);
      await recordEvent(
        current.id,
        {
          type: 'RESENT',
          actorType: 'NETENROLL',
          actorUserId: actor.userId,
          actorEmail: actor.email,
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
          detail: { to: current.signerEmail, sent: email.sent, reason: email.reason ?? null },
        },
        prisma
      );
      await audit(request, 'agreements.resent', current, { emailSent: email.sent });
      return reply.send({
        data: { signUrl, emailSent: email.sent, emailReason: email.reason ?? null },
      });
    }
  );

  fastify.post<{ Params: { id: string } }>(
    '/api/v1/platform/agreements/:id/void',
    admin,
    async (request, reply) => {
      const parsed = z
        .object({ reason: z.string().trim().min(1).max(500) })
        .safeParse(request.body);
      if (!parsed.success)
        return validation(reply, 'Give a reason for voiding (1–500 characters).');
      const envelope = await loadEnvelope(request.params.id);
      if (!envelope) return notFound(reply);
      if (envelope.status === 'COMPLETED') {
        return reply.code(409).send({
          error: {
            code: 'COMPLETED',
            message:
              'A completed agreement cannot be voided. It is terminated under Section 15 of the MSA, outside this system.',
          },
        });
      }
      if (envelope.status === 'VOIDED') {
        return reply
          .code(409)
          .send({ error: { code: 'ALREADY_VOIDED', message: 'Already voided.' } });
      }
      const actor = await actorOf(request);
      const voided = await prisma.$transaction(async tx => {
        const claimed = await tx.agreementEnvelope.updateMany({
          where: { id: envelope.id, status: { notIn: ['COMPLETED', 'VOIDED'] } },
          data: {
            status: 'VOIDED',
            voidedAt: new Date(),
            voidReason: parsed.data.reason,
            voidedByUserId: actor.userId,
          },
        });
        if (claimed.count === 0) return false;
        await appendEvent(tx, envelope.id, {
          type: 'VOIDED',
          actorType: 'NETENROLL',
          actorUserId: actor.userId,
          actorEmail: actor.email,
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
          detail: { reason: parsed.data.reason, previousStatus: envelope.status },
        });
        return true;
      });
      if (!voided) {
        return reply.code(409).send({
          error: { code: 'STATE_CHANGED', message: 'The agreement changed state; reload it.' },
        });
      }
      const settings = await loadAgreementSettings(prisma);
      const email = await sendVoidedEmail({
        to: envelope.signerEmail,
        reference: envelope.reference,
        documentTitles: titlesOf(envelope),
        noticeEmail: noticeEmailOf(settings),
      });
      await audit(request, 'agreements.voided', envelope, {
        reason: parsed.data.reason,
        previousStatus: envelope.status,
        signerNotified: email.sent,
      });
      return reply.send({ data: { status: 'VOIDED', signerNotified: email.sent } });
    }
  );

  fastify.post<{ Params: { id: string } }>(
    '/api/v1/platform/agreements/:id/send-copies',
    admin,
    async (request, reply) => {
      const envelope = await loadEnvelope(request.params.id);
      if (!envelope) return notFound(reply);
      if (envelope.status !== 'COMPLETED') {
        return reply.code(409).send({
          error: {
            code: 'NOT_COMPLETED',
            message: 'Copies can be sent once the agreement is completed.',
          },
        });
      }
      const download = mintToken();
      await prisma.agreementEnvelope.update({
        where: { id: envelope.id },
        data: {
          downloadTokenHash: download.hash,
          downloadTokenExpiresAt: new Date(Date.now() + DOWNLOAD_TOKEN_TTL_MS),
        },
      });
      const actor = await actorOf(request);
      try {
        const result = await deliverExecutedCopies({
          prisma,
          envelopeId: envelope.id,
          trigger: 'admin',
          downloadToken: download.token,
          senderEmail: actor.email,
          actorUserId: actor.userId,
          actorEmail: actor.email,
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
        });
        await audit(request, 'agreements.copies_sent', envelope, result);
        return reply.send({
          data: {
            emailSent: result.signerSent,
            internalSent: result.internalSent,
            downloadUrl: downloadPageUrl(download.token),
          },
        });
      } catch (error) {
        await audit(
          request,
          'agreements.copies_sent',
          envelope,
          {},
          false,
          (error as Error).message
        );
        if ((error as { code?: string }).code === 'AGREEMENT_PDF_HASH_MISMATCH') {
          return reply.code(500).send({
            error: {
              code: 'INTEGRITY_CHECK_FAILED',
              message: 'An executed file failed its integrity check.',
            },
          });
        }
        throw error;
      }
    }
  );

  fastify.post<{ Params: { id: string } }>(
    '/api/v1/platform/agreements/:id/complete',
    admin,
    async (request, reply) => {
      const envelope = await loadEnvelope(request.params.id);
      if (!envelope) return notFound(reply);
      if (envelope.status !== 'SIGNED' && envelope.status !== 'COMPLETED') {
        return reply.code(409).send({
          error: {
            code: 'NOT_SIGNED',
            message: `Only a signed agreement can be completed; this one is ${envelope.status}.`,
          },
        });
      }
      try {
        const result = await completeEnvelope(envelope.id, prisma);
        await audit(request, 'agreements.completion_retried', envelope, {
          alreadyCompleted: result.alreadyCompleted,
        });
        return reply.send({
          data: { status: 'COMPLETED', alreadyCompleted: result.alreadyCompleted },
        });
      } catch (error) {
        const message = (error as Error).message;
        await recordEvent(
          envelope.id,
          {
            type: 'COMPLETION_FAILED',
            actorType: 'SYSTEM',
            detail: { error: message, trigger: 'admin' },
          },
          prisma
        );
        await audit(request, 'agreements.completion_retried', envelope, {}, false, message);
        logger.error({ msg: 'Agreement completion failed', envelopeId: envelope.id, err: error });
        return reply.code(500).send({ error: { code: 'COMPLETION_FAILED', message } });
      }
    }
  );

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
      const settings = await loadAgreementSettings(prisma);
      void reply.code(410).send({
        error: {
          code: 'LINK_INACTIVE',
          status: envelope.status,
          message:
            envelope.status === 'EXPIRED'
              ? 'This signing link has expired.'
              : envelope.status === 'VOIDED'
                ? 'These agreements were withdrawn by NetEnroll.'
                : 'Changes were requested, so this signing link no longer works.',
          noticeEmail: noticeEmailOf(settings),
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
      return reply.send({
        data: {
          status: envelope.viewedAt === null ? 'VIEWED' : envelope.status,
          agencyLegalName: legalNameOf(envelope),
          documents: titlesOf(envelope).map(title => ({ title })),
          signerEmailMasked: maskEmail(envelope.signerEmail),
          expiresAt: envelope.expiresAt,
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
      const settings = await loadAgreementSettings(prisma);
      const email = await sendOtpEmail({
        to: envelope.signerEmail,
        code,
        noticeEmail: noticeEmailOf(settings),
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
            message: `We could not email your code right now. Try again shortly, or contact ${noticeEmailOf(settings)}.`,
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
            version: ESIGN_DISCLOSURE_VERSION,
            html: disclosureHtml(noticeEmail),
            text: disclosureText(noticeEmail),
            checkboxLabel: ESIGN_DISCLOSURE_V1.checkbox,
          },
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
      if (parsed.data.disclosureVersion !== ESIGN_DISCLOSURE_VERSION) {
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
            disclosureVersion: ESIGN_DISCLOSURE_VERSION,
            disclosureSha256: disclosureSha256(noticeEmail),
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

      try {
        const result = await completeEnvelope(envelope.id, prisma);
        return reply.send({
          data: {
            status: 'COMPLETED',
            downloadToken: result.downloadToken,
            downloadUrl: result.downloadToken ? downloadPageUrl(result.downloadToken) : null,
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
        const settings = await loadAgreementSettings(prisma).catch(() => null);
        const sender = await prisma.user
          .findUnique({ where: { id: envelope.sentByUserId }, select: { email: true } })
          .catch(() => null);
        await sendCompletionFailedAlert({
          to: Array.from(
            new Set([...(settings?.internalCopyEmails ?? []), sender?.email ?? ''].filter(Boolean))
          ),
          reference: envelope.reference,
          agencyLegalName: agencyLabel(envelope),
          error: message,
          adminUrl: adminEnvelopeUrl(envelope.id),
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
      const settings = await loadAgreementSettings(prisma);
      const sender = await prisma.user.findUnique({
        where: { id: envelope.sentByUserId },
        select: { email: true },
      });
      await sendChangesRequestedAlert({
        to: Array.from(
          new Set([...settings.internalCopyEmails, sender?.email ?? ''].filter(Boolean))
        ),
        reference: envelope.reference,
        agencyLegalName: legalNameOf(envelope),
        signerName: envelope.signerName,
        signerEmail: envelope.signerEmail,
        note: parsed.data.note,
        adminUrl: adminEnvelopeUrl(envelope.id),
      });
      return reply.send({
        data: { status: 'CHANGES_REQUESTED', noticeEmail: noticeEmailOf(settings) },
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
      const settings = await loadAgreementSettings(prisma);
      void reply.code(410).send({
        error: {
          code: 'LINK_EXPIRED',
          message: `This link has expired. Contact ${noticeEmailOf(settings)} for a new copy.`,
          noticeEmail: noticeEmailOf(settings),
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
          agencyLegalName: legalNameOf(envelope),
          completedAt: envelope.completedAt,
          sealed: envelope.sealed,
          documents: envelope.documents.map(doc => ({
            id: doc.id,
            kind: doc.kind,
            title: doc.title,
            fileName: executedFileName(legalNameOf(envelope), doc.kind, envelope.reference),
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
      return streamExecutedPdf(request, reply, envelope, doc, async () => {
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
          agencyLegalName: legalNameOf(doc.envelope),
          completedAt: doc.envelope.completedAt,
          sealed: doc.envelope.sealed,
        },
      });
    }
  );
}
