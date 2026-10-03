/**
 * The agreement management routes, mounted once per surface.
 *
 * ── One engine, two doors ────────────────────────────────────────────────────
 *
 *   /api/v1/platform/agreements   NetEnroll's own suite. Platform admins only,
 *                                 exactly as before (routes/agreements.ts).
 *   /api/v1/sales/agreements      The suite of the sales workspace the caller
 *                                 resolves to (lib/sales-workspace.ts): a
 *                                 white-label owner's, a granted user's, or --
 *                                 for a platform admin in the cross-agency view
 *                                 -- NetEnroll's.
 *
 * Both are this file. Neither takes a workspace, suite or issuer from the
 * request: `resolve` returns the issuing suite from the authenticated
 * principal, and EVERY envelope query below is filtered by that suite's
 * workspace. An envelope of another workspace is not found -- the same 404 as
 * an id that exists nowhere -- so ids cannot be enumerated across workspaces.
 */

import type {
  AgreementDocument,
  AgreementEnvelope,
  AgreementStatus,
  PrismaClient,
} from '@prisma/client';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';

import { clientIp, clientUserAgent } from '../lib/client-ip.js';
import { decryptField } from '../lib/field-encryption.js';
import { logger } from '../lib/logger.js';
import { getActingUserId } from '../lib/tenant-context.js';
import {
  adminEnvelopeUrl,
  completeEnvelope,
  deliverExecutedCopies,
  downloadPageUrl,
  DOWNLOAD_TOKEN_TTL_MS,
  executedFileName,
  readVerifiedPdf,
} from '../services/agreements/complete.js';
import { sendInvitationEmail, sendVoidedEmail } from '../services/agreements/emails.js';
import {
  AgreementError,
  createEnvelope,
  expireStaleEnvelopes,
  notifyLifecycle,
  prepareEnvelope,
  previewDocuments,
  signUrlForEnvelope,
} from '../services/agreements/envelopes.js';
import { appendEvent, recordEvent, verifyEventChain } from '../services/agreements/events.js';
import { issuerOfEnvelope } from '../services/agreements/issuer.js';
import { agencyLabel, agencyOf, needsPartyDetails } from '../services/agreements/party.js';
import type { SuiteContext } from '../services/agreements/suites.js';
import { mintToken } from '../services/agreements/tokens.js';
import { auditLog } from '../services/audit.js';

export type SurfaceLevel = 'MANAGER' | 'MEMBER' | 'READONLY';

/** What a surface's resolver hands every route. */
export interface SurfaceAccess {
  ctx: SuiteContext;
  level: SurfaceLevel;
  /** The tenant audit rows of this surface's writes belong to (the issuer's), or null. */
  auditTenantId: (envelope: { tenantId: string | null } | null) => string | null;
}

export interface AgreementSurface {
  prefix: string;
  preHandler: preHandlerHookHandler[];
  /** The caller's issuing suite, or null after sending the refusal. */
  resolve: (request: FastifyRequest, reply: FastifyReply) => Promise<SurfaceAccess | null>;
}

const OPEN: AgreementStatus[] = ['SENT', 'VIEWED'];
const RANK: Record<SurfaceLevel, number> = { READONLY: 0, MEMBER: 1, MANAGER: 2 };

const STATUS_VALUES: AgreementStatus[] = [
  'SENT',
  'VIEWED',
  'SIGNED',
  'COMPLETED',
  'CHANGES_REQUESTED',
  'VOIDED',
  'EXPIRED',
];

export function sendAgreementError(reply: FastifyReply, error: unknown): FastifyReply | null {
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

export function titlesOf(envelope: {
  documents: Array<{ title: string; sortOrder: number }>;
}): string[] {
  return [...envelope.documents].sort((a, b) => a.sortOrder - b.sortOrder).map(d => d.title);
}

export function summariseEnvelope(envelope: AgreementEnvelope) {
  const issuer = issuerOfEnvelope(envelope);
  return {
    id: envelope.id,
    reference: envelope.reference,
    status: envelope.status,
    tenantId: envelope.tenantId,
    agencyLegalName: agencyLabel(envelope),
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
    salesProspectId: envelope.salesProspectId,
    issuer: { displayName: issuer.displayName, legalName: issuer.legalName, scope: issuer.scope },
  };
}

export function registerAgreementSurface(
  fastify: FastifyInstance,
  prisma: PrismaClient,
  surface: AgreementSurface
): void {
  const P = surface.prefix;
  const guard = { preHandler: surface.preHandler };

  async function access(
    request: FastifyRequest,
    reply: FastifyReply,
    need: SurfaceLevel
  ): Promise<SurfaceAccess | null> {
    const resolved = await surface.resolve(request, reply);
    if (!resolved) return null;
    if (RANK[resolved.level] < RANK[need]) {
      void reply.code(403).send({
        error: {
          code: 'FORBIDDEN',
          message:
            need === 'MANAGER'
              ? 'Only a manager of this sales workspace can do this.'
              : 'Your access to this sales workspace is read-only.',
        },
      });
      return null;
    }
    return resolved;
  }

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
    acc: SurfaceAccess,
    action: string,
    envelope: { id: string; tenantId: string | null } | null,
    changes: Record<string, unknown> = {},
    success = true,
    error?: string
  ): Promise<void> {
    await auditLog({
      tenantId: acc.auditTenantId(envelope),
      userId: getActingUserId(request) ?? undefined,
      action,
      entityType: 'AgreementEnvelope',
      entityId: envelope?.id,
      resource: request.url,
      method: request.method,
      changes: { ...changes, salesWorkspaceId: acc.ctx.workspace.id },
      ipAddress: clientIp(request) ?? undefined,
      userAgent: clientUserAgent(request) ?? undefined,
      requestId: request.id,
      success,
      error,
    });
  }

  /** One envelope of THIS workspace, or null -- never another workspace's. */
  async function loadEnvelope(id: string, acc: SurfaceAccess) {
    if (!z.string().uuid().safeParse(id).success) return null;
    return prisma.agreementEnvelope.findFirst({
      where: { id, salesWorkspaceId: acc.ctx.workspace.id },
      include: { documents: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  fastify.post(`${P}/preview`, guard, async (request, reply) => {
    const acc = await access(request, reply, 'MEMBER');
    if (!acc) return reply;
    try {
      const prepared = await prepareEnvelope(request.body, acc.ctx, prisma);
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

  fastify.post(P, guard, async (request, reply) => {
    const acc = await access(request, reply, 'MEMBER');
    if (!acc) return reply;
    try {
      const prepared = await prepareEnvelope(request.body, acc.ctx, prisma);
      const actor = await actorOf(request);
      const created = await createEnvelope(prepared, actor, prisma);
      await audit(request, acc, 'agreements.sent', created.envelope, {
        reference: created.envelope.reference,
        documents: prepared.kinds,
        signerEmail: prepared.signerEmail,
        ccEmails: prepared.ccEmails,
        emailSent: created.email.sent,
        agreementSuiteId: acc.ctx.suite.id,
        salesProspectId: prepared.salesProspectId,
      });
      return reply.code(201).send({
        data: {
          envelope: summariseEnvelope(created.envelope),
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

  fastify.get<{ Querystring: { status?: string; q?: string; page?: string; prospectId?: string } }>(
    P,
    guard,
    async (request, reply) => {
      const acc = await access(request, reply, 'READONLY');
      if (!acc) return reply;
      const workspaceId = acc.ctx.workspace.id;
      await expireStaleEnvelopes(prisma, undefined, workspaceId);
      const statuses = (request.query.status ?? '')
        .split(',')
        .map(s => s.trim().toUpperCase())
        .filter((s): s is AgreementStatus => STATUS_VALUES.includes(s as AgreementStatus));
      const q = (request.query.q ?? '').trim();
      const page = Math.max(1, Number.parseInt(request.query.page ?? '1', 10) || 1);
      const pageSize = 25;
      const prospectId = z.string().uuid().safeParse(request.query.prospectId).success
        ? request.query.prospectId
        : undefined;

      let idFilter: string[] | undefined;
      if (q) {
        const like = `%${q.replace(/[\\%_]/g, m => `\\${m}`)}%`;
        const rows = await prisma.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "agreement_envelopes"
          WHERE "salesWorkspaceId" = ${workspaceId}
            AND ("reference" ILIKE ${like}
             OR "signerName" ILIKE ${like}
             OR "signerEmail" ILIKE ${like}
             OR ("terms"->'agency'->>'legalName') ILIKE ${like}
             OR ("partyDetails"->>'legalName') ILIKE ${like}
             OR ("partyDetails"->>'dbaName') ILIKE ${like}
             OR "inviteeOrganization" ILIKE ${like})`;
        idFilter = rows.map(r => r.id);
      }
      const where = {
        salesWorkspaceId: workspaceId,
        ...(statuses.length > 0 ? { status: { in: statuses } } : {}),
        ...(idFilter ? { id: { in: idFilter } } : {}),
        ...(prospectId ? { salesProspectId: prospectId } : {}),
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
            ...summariseEnvelope(row),
            lastActivityAt: lastActivity.get(row.id) ?? row.sentAt,
          })),
          total,
          page,
          pageSize,
        },
      });
    }
  );

  fastify.get<{ Params: { id: string } }>(`${P}/:id`, guard, async (request, reply) => {
    const acc = await access(request, reply, 'READONLY');
    if (!acc) return reply;
    const envelope0 = await loadEnvelope(request.params.id, acc);
    if (!envelope0) return notFound(reply);
    await expireStaleEnvelopes(prisma, envelope0.id, acc.ctx.workspace.id);
    const envelope = (await loadEnvelope(envelope0.id, acc))!;
    const [events, chain, sender, existingMsa, prospect] = await Promise.all([
      prisma.agreementEvent.findMany({
        where: { envelopeId: envelope.id },
        orderBy: { seq: 'asc' },
      }),
      verifyEventChain(envelope.id, prisma),
      prisma.user.findUnique({ where: { id: envelope.sentByUserId }, select: { email: true } }),
      envelope.existingMsaEnvelopeId
        ? prisma.agreementEnvelope.findFirst({
            where: { id: envelope.existingMsaEnvelopeId, salesWorkspaceId: acc.ctx.workspace.id },
            select: { id: true, reference: true },
          })
        : Promise.resolve(null),
      envelope.salesProspectId
        ? prisma.salesProspect.findFirst({
            where: { id: envelope.salesProspectId, workspaceId: acc.ctx.workspace.id },
            select: { id: true, companyName: true, primaryContactName: true, stage: true },
          })
        : Promise.resolve(null),
    ]);
    return reply.send({
      data: {
        ...summariseEnvelope(envelope),
        terms: envelope.terms,
        partyDetails: envelope.partyDetails,
        partySubmittedAt: envelope.partySubmittedAt,
        existingMsa,
        prospect,
        netenrollSignatoryName: envelope.issuerSignatoryName ?? envelope.netenrollSignatoryName,
        netenrollSignatoryTitle: envelope.issuerSignatoryTitle ?? envelope.netenrollSignatoryTitle,
        netenrollSignedAt: envelope.issuerSignedAt ?? envelope.netenrollSignedAt,
        netenrollSignedIp: envelope.issuerSignedIp ?? envelope.netenrollSignedIp,
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
          fileName: executedFileName(agencyLabel(envelope), doc.kind, envelope.reference),
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
  });

  for (const version of ['sent', 'presented'] as const) {
    fastify.get<{ Params: { id: string; documentId: string } }>(
      `${P}/:id/documents/:documentId/${version}.html`,
      guard,
      async (request, reply) => {
        const acc = await access(request, reply, 'READONLY');
        if (!acc) return reply;
        const envelope = await loadEnvelope(request.params.id, acc);
        const doc = envelope?.documents.find(d => d.id === request.params.documentId);
        const html = version === 'sent' ? doc?.sentHtml : doc?.presentedHtml;
        if (!envelope || !doc || !html) return notFound(reply, 'Document not found');
        await audit(request, acc, `agreements.document.viewed_as_${version}`, envelope, {
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
    `${P}/:id/documents/:documentFile`,
    guard,
    async (request, reply) => {
      const acc = await access(request, reply, 'READONLY');
      if (!acc) return reply;
      const documentId = request.params.documentFile.replace(/\.pdf$/, '');
      if (documentId === request.params.documentFile) return notFound(reply, 'Document not found');
      const envelope = await loadEnvelope(request.params.id, acc);
      const doc = envelope?.documents.find(d => d.id === documentId);
      if (!envelope || !doc) return notFound(reply, 'Document not found');
      if (envelope.status !== 'COMPLETED' || !doc.executedPdfKey) {
        return reply.code(409).send({
          error: { code: 'NOT_COMPLETED', message: 'This agreement is not executed yet.' },
        });
      }
      return streamExecutedPdf(request, reply, envelope, doc, async () => {
        await audit(request, acc, 'agreements.document.downloaded', envelope, {
          documentId: doc.id,
          kind: doc.kind,
          sha256: doc.executedPdfSha256,
        });
      });
    }
  );

  fastify.post<{ Params: { id: string } }>(`${P}/:id/resend`, guard, async (request, reply) => {
    const acc = await access(request, reply, 'MEMBER');
    if (!acc) return reply;
    const envelope = await loadEnvelope(request.params.id, acc);
    if (!envelope) return notFound(reply);
    await expireStaleEnvelopes(prisma, envelope.id, acc.ctx.workspace.id);
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
    const issuer = issuerOfEnvelope(current);
    const signUrl = signUrlForEnvelope(token, current);
    const email = await sendInvitationEmail({
      to: current.signerEmail,
      signerName: current.signerName,
      agencyLegalName: agencyLabel(current),
      documentTitles: titlesOf(envelope),
      signUrl,
      expiresAt: current.expiresAt,
      noticeEmail: await noticeEmailFor(prisma, acc, current),
      resend: true,
      issuer: issuer.scope === 'PLATFORM' ? undefined : issuer,
    });
    const actor = await actorOf(request);
    await recordEvent(
      current.id,
      {
        type: 'RESENT',
        actorType: acc.ctx.scope === 'PLATFORM' ? 'NETENROLL' : 'ISSUER',
        actorUserId: actor.userId,
        actorEmail: actor.email,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
        detail: { to: current.signerEmail, sent: email.sent, reason: email.reason ?? null },
      },
      prisma
    );
    await audit(request, acc, 'agreements.resent', current, { emailSent: email.sent });
    return reply.send({
      data: { signUrl, emailSent: email.sent, emailReason: email.reason ?? null },
    });
  });

  fastify.post<{ Params: { id: string } }>(`${P}/:id/void`, guard, async (request, reply) => {
    const acc = await access(request, reply, 'MANAGER');
    if (!acc) return reply;
    const parsed = z.object({ reason: z.string().trim().min(1).max(500) }).safeParse(request.body);
    if (!parsed.success) return validation(reply, 'Give a reason for voiding (1–500 characters).');
    const envelope = await loadEnvelope(request.params.id, acc);
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
        actorType: acc.ctx.scope === 'PLATFORM' ? 'NETENROLL' : 'ISSUER',
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
    await notifyLifecycle(prisma, envelope.id, 'VOIDED');
    const issuer = issuerOfEnvelope(envelope);
    const email = await sendVoidedEmail({
      to: envelope.signerEmail,
      reference: envelope.reference,
      documentTitles: titlesOf(envelope),
      noticeEmail: await noticeEmailFor(prisma, acc, envelope),
      issuer: issuer.scope === 'PLATFORM' ? undefined : issuer,
    });
    await audit(request, acc, 'agreements.voided', envelope, {
      reason: parsed.data.reason,
      previousStatus: envelope.status,
      signerNotified: email.sent,
    });
    return reply.send({ data: { status: 'VOIDED', signerNotified: email.sent } });
  });

  fastify.post<{ Params: { id: string } }>(
    `${P}/:id/send-copies`,
    guard,
    async (request, reply) => {
      const acc = await access(request, reply, 'MEMBER');
      if (!acc) return reply;
      const envelope = await loadEnvelope(request.params.id, acc);
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
        await audit(request, acc, 'agreements.copies_sent', envelope, result);
        return reply.send({
          data: {
            emailSent: result.signerSent,
            internalSent: result.internalSent,
            downloadUrl: downloadPageUrl(download.token, issuerOfEnvelope(envelope)),
          },
        });
      } catch (error) {
        await audit(
          request,
          acc,
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

  fastify.post<{ Params: { id: string } }>(`${P}/:id/complete`, guard, async (request, reply) => {
    const acc = await access(request, reply, 'MANAGER');
    if (!acc) return reply;
    const envelope = await loadEnvelope(request.params.id, acc);
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
      await audit(request, acc, 'agreements.completion_retried', envelope, {
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
      await audit(request, acc, 'agreements.completion_retried', envelope, {}, false, message);
      logger.error({ msg: 'Agreement completion failed', envelopeId: envelope.id, err: error });
      return reply.code(500).send({ error: { code: 'COMPLETION_FAILED', message } });
    }
  });

  async function streamExecutedPdf(
    request: FastifyRequest,
    reply: FastifyReply,
    envelope: AgreementEnvelope,
    doc: AgreementDocument,
    onServed: () => Promise<void>
  ): Promise<FastifyReply> {
    return serveExecutedPdf(request, reply, envelope, doc, onServed);
  }
}

/** The notice email a refusal or email names: the issuer suite's, as configured now. */
function noticeEmailFor(
  _prisma: PrismaClient,
  acc: SurfaceAccess,
  envelope: AgreementEnvelope
): Promise<string> {
  return Promise.resolve(
    acc.ctx.suite.noticeEmail?.trim() || issuerOfEnvelope(envelope).noticeEmail
  );
}

/**
 * Stream a stored executed PDF after re-checking its SHA-256; refuse (500,
 * audited) if it does not match. Shared by the admin surfaces and the
 * client's public download link.
 */
export async function serveExecutedPdf(
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
    const issuer = issuerOfEnvelope(envelope);
    return reply.code(500).send({
      error: {
        code: 'INTEGRITY_CHECK_FAILED',
        message: `This file failed its integrity check and was not served. ${issuer.shortName} has been notified.`,
      },
    });
  }
  await onServed();
  return reply
    .header('Content-Type', 'application/pdf')
    .header(
      'Content-Disposition',
      `attachment; filename="${executedFileName(agencyLabel(envelope), doc.kind, envelope.reference)}"`
    )
    .header('Content-Length', String(bytes.length))
    .header('Cache-Control', 'no-store')
    .header('X-Content-SHA256', doc.executedPdfSha256 ?? '')
    .send(bytes);
}

export { adminEnvelopeUrl };
