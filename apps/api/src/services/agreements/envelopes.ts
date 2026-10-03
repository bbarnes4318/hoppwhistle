/**
 * Creating an envelope, and the rules every route applies to one.
 */

import type {
  AgreementDocumentKind,
  AgreementEnvelope,
  AgreementSettings,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { z } from 'zod';

import { encryptField } from '../../lib/field-encryption.js';
import { defaultPortalUrl } from '../../lib/tenant-brand.js';

import { documentKinds, renderDocuments, type RenderedDocument } from './documents.js';
import { sendInvitationEmail, type EmailResult } from './emails.js';
import { appendEvent } from './events.js';
import { etDateIso } from './format.js';
import { missingSetting } from './settings.js';
import { firstIssueMessage, termsSchema, type FrozenTerms } from './terms.js';
import { mintToken, newReference } from './tokens.js';

export const ENVELOPE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const NETENROLL_AUTHORITY_STATEMENT =
  'I confirm I am authorized to sign these agreements on behalf of PVN LLC d/b/a NetEnroll, and I adopt the signature shown as my electronic signature.';

export class AgreementError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export const createBodySchema = z.object({
  tenantId: z.string().uuid().nullable().optional(),
  includesCpa: z.boolean(),
  includesCpl: z.boolean(),
  existingMsaEnvelopeId: z.string().uuid().nullable().optional(),
  terms: z.unknown(),
  signer: z.object({
    name: z.string().trim().min(2).max(100),
    title: z.string().trim().min(1).max(120),
    email: z.string().trim().email().max(254),
  }),
  ccEmails: z.array(z.string().trim().email().max(254)).max(10).default([]),
  netenrollSignatory: z.object({
    name: z.string().trim().min(2).max(100),
    title: z.string().trim().min(1).max(120),
  }),
  netenrollAuthorityConfirmed: z.boolean().optional(),
});
export type CreateBody = z.infer<typeof createBodySchema>;

export interface PreparedEnvelope {
  body: CreateBody;
  terms: FrozenTerms;
  kinds: AgreementDocumentKind[];
  includesMsa: boolean;
  existingMsaEnvelopeId: string | null;
  tenantId: string | null;
  signerEmail: string;
  ccEmails: string[];
}

/** Validate a create (or preview) body into exactly what will be frozen. */
export async function prepareEnvelope(
  raw: unknown,
  settings: AgreementSettings,
  prisma: PrismaClient
): Promise<PreparedEnvelope> {
  const parsed = createBodySchema.safeParse(raw);
  if (!parsed.success) {
    throw new AgreementError(422, 'VALIDATION_ERROR', firstIssueMessage(parsed.error));
  }
  const body = parsed.data;

  const missing = missingSetting(settings);
  if (missing) {
    throw new AgreementError(
      422,
      'SETTINGS_INCOMPLETE',
      `Agreement settings are incomplete: ${missing} is empty. Complete the settings before sending.`
    );
  }
  if (!body.includesCpa && !body.includesCpl) {
    throw new AgreementError(
      422,
      'NO_CAMPAIGN_AGREEMENT',
      'Choose at least one campaign agreement: the CPA Agreement, the CPL Agreement, or both.'
    );
  }

  const termsInput = { ...((body.terms ?? {}) as Record<string, unknown>) };
  if (!body.includesCpa) delete termsInput.cpa;
  if (!body.includesCpl) delete termsInput.cpl;
  if (body.includesCpa && !termsInput.cpa) {
    throw new AgreementError(422, 'VALIDATION_ERROR', 'The CPA terms are missing.');
  }
  if (body.includesCpl && !termsInput.cpl) {
    throw new AgreementError(422, 'VALIDATION_ERROR', 'The CPL terms are missing.');
  }
  // Without an existing MSA the effective dates are one and the same.
  if (!body.existingMsaEnvelopeId) termsInput.msaEffectiveDate = termsInput.effectiveDate;

  let existingMsaEffectiveDate: string | null = null;
  const tenantId = body.tenantId ?? null;
  if (tenantId) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!tenant) throw new AgreementError(422, 'VALIDATION_ERROR', 'That agency does not exist.');
  }

  if (body.existingMsaEnvelopeId) {
    const existing = await prisma.agreementEnvelope.findUnique({
      where: { id: body.existingMsaEnvelopeId },
    });
    const existingTerms = existing?.terms as unknown as FrozenTerms | undefined;
    const legalName = String(
      ((termsInput.agency ?? {}) as Record<string, unknown>).legalName ?? ''
    ).trim();
    if (!existing || existing.status !== 'COMPLETED' || !existing.includesMsa) {
      throw new AgreementError(
        422,
        'EXISTING_MSA_INVALID',
        'The existing MSA must be a completed envelope that included the Master Services Agreement.'
      );
    }
    const sameTenant = tenantId !== null && existing.tenantId === tenantId;
    const sameName =
      legalName.length > 0 &&
      existingTerms?.agency.legalName.trim().toLowerCase() === legalName.toLowerCase();
    if (!sameTenant && !sameName) {
      throw new AgreementError(
        422,
        'EXISTING_MSA_MISMATCH',
        'The existing MSA belongs to a different agency.'
      );
    }
    existingMsaEffectiveDate = existingTerms!.effectiveDate;
    termsInput.msaEffectiveDate = existingMsaEffectiveDate;
  }

  const terms = termsSchema.safeParse(termsInput);
  if (!terms.success) {
    throw new AgreementError(422, 'VALIDATION_ERROR', firstIssueMessage(terms.error));
  }

  const frozen: FrozenTerms = {
    ...terms.data,
    netenroll: {
      noticeAddress: settings.netenrollNoticeAddress!.trim(),
      noticeEmail: settings.netenrollNoticeEmail!.trim(),
    },
  };
  const includesMsa = !body.existingMsaEnvelopeId;
  const signerEmail = body.signer.email.toLowerCase();
  const ccEmails = Array.from(
    new Set(body.ccEmails.map(e => e.toLowerCase()).filter(e => e !== signerEmail))
  );

  return {
    body,
    terms: frozen,
    kinds: documentKinds({
      includesMsa,
      includesCpa: body.includesCpa,
      includesCpl: body.includesCpl,
    }),
    includesMsa,
    existingMsaEnvelopeId: body.existingMsaEnvelopeId ?? null,
    tenantId,
    signerEmail,
    ccEmails,
  };
}

export function previewDocuments(prepared: PreparedEnvelope): RenderedDocument[] {
  return renderDocuments(prepared.terms, prepared.kinds, {
    mode: 'preview',
    reference: 'NE-PREVIEW',
    netenrollSignatoryName: prepared.body.netenrollSignatory.name,
    netenrollSignatoryTitle: prepared.body.netenrollSignatory.title,
    netenrollSignedDate: etDateIso(),
  });
}

export function signUrlFor(token: string): string {
  return `${defaultPortalUrl()}/sign/${token}`;
}

export interface Actor {
  userId: string;
  email: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface CreatedEnvelope {
  envelope: AgreementEnvelope;
  signUrl: string;
  email: EmailResult;
}

/** Create, NetEnroll-sign and send. */
export async function createEnvelope(
  prepared: PreparedEnvelope,
  actor: Actor,
  prisma: PrismaClient
): Promise<CreatedEnvelope> {
  if (prepared.body.netenrollAuthorityConfirmed !== true) {
    throw new AgreementError(
      422,
      'AUTHORITY_NOT_CONFIRMED',
      'Confirm you are authorized to sign on behalf of PVN LLC d/b/a NetEnroll.'
    );
  }
  const { body, terms } = prepared;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ENVELOPE_TTL_MS);
  const sign = mintToken();

  let created: AgreementEnvelope | null = null;
  for (let attempt = 0; attempt < 5 && !created; attempt += 1) {
    const reference = newReference();
    const clash = await prisma.agreementEnvelope.findUnique({
      where: { reference },
      select: { id: true },
    });
    if (clash) continue;
    const documents = renderDocuments(terms, prepared.kinds, {
      mode: 'send',
      reference,
      netenrollSignatoryName: body.netenrollSignatory.name,
      netenrollSignatoryTitle: body.netenrollSignatory.title,
      netenrollSignedDate: etDateIso(now),
    });

    created = await prisma.$transaction(async tx => {
      const envelope = await tx.agreementEnvelope.create({
        data: {
          reference,
          tenantId: prepared.tenantId,
          status: 'SENT',
          includesMsa: prepared.includesMsa,
          includesCpa: body.includesCpa,
          includesCpl: body.includesCpl,
          existingMsaEnvelopeId: prepared.existingMsaEnvelopeId,
          terms: terms as unknown as Prisma.InputJsonValue,
          signerName: body.signer.name,
          signerTitle: body.signer.title,
          signerEmail: prepared.signerEmail,
          ccEmails: prepared.ccEmails,
          netenrollSignatoryName: body.netenrollSignatory.name,
          netenrollSignatoryTitle: body.netenrollSignatory.title,
          netenrollSignedByUserId: actor.userId,
          netenrollSignedAt: now,
          netenrollSignedIp: actor.ipAddress,
          netenrollSignedUserAgent: actor.userAgent,
          sentByUserId: actor.userId,
          sentAt: now,
          expiresAt,
          signTokenHash: sign.hash,
          signTokenEnc: encryptField(sign.token),
          documents: {
            create: documents.map(doc => ({
              kind: doc.kind,
              title: doc.title,
              templateVersion: doc.templateVersion,
              sentHtml: doc.html,
              sentHtmlSha256: doc.sha256,
              sortOrder: doc.sortOrder,
            })),
          },
        },
      });
      const actorFields = {
        actorUserId: actor.userId,
        actorEmail: actor.email,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      };
      await appendEvent(tx, envelope.id, {
        type: 'CREATED',
        actorType: 'NETENROLL',
        ...actorFields,
        occurredAt: now,
        detail: {
          reference,
          tenantId: prepared.tenantId,
          documents: documents.map(doc => ({
            kind: doc.kind,
            templateVersion: doc.templateVersion,
            sentHtmlSha256: doc.sha256,
          })),
          signer: { name: body.signer.name, title: body.signer.title, email: prepared.signerEmail },
          ccEmails: prepared.ccEmails,
          existingMsaEnvelopeId: prepared.existingMsaEnvelopeId,
          expiresAt: expiresAt.toISOString(),
        },
      });
      await appendEvent(tx, envelope.id, {
        type: 'NETENROLL_SIGNED',
        actorType: 'NETENROLL',
        ...actorFields,
        occurredAt: now,
        detail: {
          signatoryName: body.netenrollSignatory.name,
          signatoryTitle: body.netenrollSignatory.title,
          authorityConfirmation: NETENROLL_AUTHORITY_STATEMENT,
          adminUserId: actor.userId,
          adminEmail: actor.email,
          documentHashes: Object.fromEntries(documents.map(doc => [doc.kind, doc.sha256])),
        },
      });
      return envelope;
    });
  }
  if (!created) throw new Error('Could not allocate a unique agreement reference');

  const signUrl = signUrlFor(sign.token);
  const email = await sendInvitationEmail({
    to: prepared.signerEmail,
    signerName: body.signer.name,
    agencyLegalName: terms.agency.legalName,
    documentTitles: prepared.kinds.map(kind => titleOf(kind)),
    signUrl,
    expiresAt,
    noticeEmail: terms.netenroll.noticeEmail,
  });
  await prisma.$transaction(tx =>
    appendEvent(tx, created.id, {
      type: email.sent ? 'SENT' : 'EMAIL_NOT_SENT',
      actorType: 'SYSTEM',
      detail: { to: prepared.signerEmail, reason: email.reason ?? null },
    })
  );

  return { envelope: created, signUrl, email };
}

function titleOf(kind: AgreementDocumentKind): string {
  return kind === 'MSA'
    ? 'Master Services Agreement'
    : kind === 'CPA'
      ? 'CPA Agreement'
      : 'CPL Agreement';
}

/** Mark past-expiry SENT / VIEWED envelopes EXPIRED, each with an event. */
export async function expireStaleEnvelopes(prisma: PrismaClient, onlyId?: string): Promise<number> {
  const stale = await prisma.agreementEnvelope.findMany({
    where: {
      status: { in: ['SENT', 'VIEWED'] },
      expiresAt: { lte: new Date() },
      ...(onlyId ? { id: onlyId } : {}),
    },
    select: { id: true, expiresAt: true },
  });
  let count = 0;
  for (const row of stale) {
    const done = await prisma.$transaction(async tx => {
      const claimed = await tx.agreementEnvelope.updateMany({
        where: { id: row.id, status: { in: ['SENT', 'VIEWED'] } },
        data: { status: 'EXPIRED' },
      });
      if (claimed.count === 0) return false;
      await appendEvent(tx, row.id, {
        type: 'EXPIRED',
        actorType: 'SYSTEM',
        detail: { expiresAt: row.expiresAt.toISOString() },
      });
      return true;
    });
    if (done) count += 1;
  }
  return count;
}
