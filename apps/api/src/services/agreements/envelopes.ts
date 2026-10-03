/**
 * Creating an envelope, and the rules every route applies to one.
 */

import type {
  AgreementDocumentKind,
  AgreementEnvelope,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { z } from 'zod';

import { encryptField } from '../../lib/field-encryption.js';
import { defaultPortalUrl } from '../../lib/tenant-brand.js';

import {
  documentKinds,
  renderDocuments,
  type DocumentSpec,
  type RenderedDocument,
} from './documents.js';
import { sendInvitationEmail, type EmailResult } from './emails.js';
import { appendEvent } from './events.js';
import { etDateIso } from './format.js';
import {
  documentBrandFor,
  issuerOfEnvelope,
  presentIssuer,
  type FrozenIssuer,
  type IssuerPresentation,
} from './issuer.js';
import { freezeIssuer, missingSuiteSetting, type SuiteContext } from './suites.js';
import { firstIssueMessage, termsSchema, type FrozenTerms } from './terms.js';
import { mintToken, newReference } from './tokens.js';

export const ENVELOPE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const NETENROLL_AUTHORITY_STATEMENT =
  'I confirm I am authorized to sign these agreements on behalf of PVN LLC d/b/a NetEnroll, and I adopt the signature shown as my electronic signature.';

/** The same confirmation, for the issuer that is signing. NetEnroll's is the constant above. */
export function authorityStatementFor(
  issuer: Pick<IssuerPresentation, 'scope' | 'legalName'>
): string {
  if (issuer.scope === 'PLATFORM') return NETENROLL_AUTHORITY_STATEMENT;
  return `I confirm I am authorized to sign these agreements on behalf of ${issuer.legalName}, and I adopt the signature shown as my electronic signature.`;
}

export class AgreementError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

const signatorySchema = z.object({
  name: z.string().trim().min(2).max(100),
  title: z.string().trim().min(1).max(120),
});

/**
 * NetEnroll's platform screen sends `netenrollSignatory` and
 * `netenrollAuthorityConfirmed`, as it always has; the Sales CRM's agreement
 * screen sends `issuerSignatory` and `issuerAuthorityConfirmed`. Either names
 * the ISSUING suite's signatory -- which suite is never in the body.
 *
 * Anything else in the body (a `salesWorkspaceId`, an `agreementSuiteId`) is
 * stripped by zod and ignored: the issuer comes from the resolved workspace.
 */
export const createBodySchema = z.object({
  tenantId: z.string().uuid().nullable().optional(),
  /** The Sales CRM prospect this is sent to; must be in the issuing workspace. */
  salesProspectId: z.string().uuid().nullable().optional(),
  includesCpa: z.boolean(),
  includesCpl: z.boolean(),
  existingMsaEnvelopeId: z.string().uuid().nullable().optional(),
  terms: z.unknown(),
  /**
   * Who the link goes to. They enter the agency's details (business or
   * individual agent) and the signer's name and title themselves; the email
   * is fixed here, because the one-time code is sent to it.
   */
  recipient: z.object({
    name: z.string().trim().min(2).max(100),
    email: z.string().trim().email().max(254),
    /** NetEnroll's own label for the agency, for the email and its records. */
    organization: z.string().trim().max(200).optional().nullable(),
  }),
  ccEmails: z.array(z.string().trim().email().max(254)).max(10).default([]),
  netenrollSignatory: signatorySchema.optional(),
  issuerSignatory: signatorySchema.optional(),
  netenrollAuthorityConfirmed: z.boolean().optional(),
  issuerAuthorityConfirmed: z.boolean().optional(),
});
export type CreateBody = z.infer<typeof createBodySchema>;

export interface PreparedEnvelope {
  body: CreateBody;
  terms: FrozenTerms & { issuer: FrozenIssuer };
  kinds: AgreementDocumentKind[];
  includesMsa: boolean;
  existingMsaEnvelopeId: string | null;
  tenantId: string | null;
  salesProspectId: string | null;
  signerEmail: string;
  ccEmails: string[];
  signatory: { name: string; title: string };
  authorityConfirmed: boolean;
  ctx: SuiteContext;
  issuer: IssuerPresentation;
  specs: Record<AgreementDocumentKind, DocumentSpec>;
}

/** The issuing suite's documents, or the refusal that it has none. */
function documentsOrRefuse(ctx: SuiteContext): Record<AgreementDocumentKind, DocumentSpec> {
  if (!ctx.templates.configured) {
    throw new AgreementError(
      409,
      'TEMPLATES_NOT_CONFIGURED',
      `Contract templates not configured: ${ctx.suite.displayName} has no approved MSA, CPA and CPL installed, so nothing can be previewed or sent.`
    );
  }
  return ctx.templates.documents;
}

/**
 * Validate a create (or preview) body into exactly what will be frozen, for
 * the ISSUING suite `ctx`. Every reference in the body -- the recipient
 * agency, the prospect, an existing MSA -- is checked against that suite's
 * workspace, and one that is not in it is refused exactly as one that does
 * not exist is, so a guessed id says nothing.
 */
export async function prepareEnvelope(
  raw: unknown,
  ctx: SuiteContext,
  prisma: PrismaClient
): Promise<PreparedEnvelope> {
  const parsed = createBodySchema.safeParse(raw);
  if (!parsed.success) {
    throw new AgreementError(422, 'VALIDATION_ERROR', firstIssueMessage(parsed.error));
  }
  const body = parsed.data;

  if (ctx.suite.status !== 'ACTIVE' || ctx.workspace.status !== 'ACTIVE') {
    throw new AgreementError(409, 'SUITE_DISABLED', 'This agreement suite is disabled.');
  }
  const specs = documentsOrRefuse(ctx);
  const signatory = body.issuerSignatory ?? body.netenrollSignatory;
  if (!signatory) {
    throw new AgreementError(422, 'VALIDATION_ERROR', 'Name the signatory signing for the issuer.');
  }

  const missing = missingSuiteSetting(ctx);
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
  // The agency enters its own details when it signs; nothing NetEnroll typed
  // about it is frozen into the terms.
  delete termsInput.agency;
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
    // NetEnroll contracts any agency on the platform. A white-label issuer may
    // name only its own downline agencies; any other id reads as unknown.
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, parentTenantId: true },
    });
    const allowed =
      tenant !== null &&
      (ctx.scope === 'PLATFORM' || tenant.parentTenantId === ctx.workspace.tenantId);
    if (!allowed) throw new AgreementError(422, 'VALIDATION_ERROR', 'That agency does not exist.');
  }

  const salesProspectId = body.salesProspectId ?? null;
  if (salesProspectId) {
    const prospect = await prisma.salesProspect.findFirst({
      where: { id: salesProspectId, workspaceId: ctx.workspace.id, archivedAt: null },
      select: { id: true },
    });
    if (!prospect) throw new AgreementError(404, 'NOT_FOUND', 'Prospect not found');
  }

  if (body.existingMsaEnvelopeId) {
    // Scoped to the issuing workspace AND suite in the query itself: another
    // workspace's MSA is not "found and refused", it is simply not found, and
    // gets the same answer as an id that exists nowhere.
    const existing = await prisma.agreementEnvelope.findFirst({
      where: {
        id: body.existingMsaEnvelopeId,
        salesWorkspaceId: ctx.workspace.id,
        agreementSuiteId: ctx.suite.id,
      },
    });
    const existingTerms = existing?.terms as unknown as
      | (FrozenTerms & { issuer?: FrozenIssuer })
      | undefined;
    // Same template family: the MSA it cites was rendered from this suite's set.
    const existingSet = existingTerms?.issuer?.templateSetKey ?? 'netenroll';
    if (
      !existing ||
      existing.status !== 'COMPLETED' ||
      !existing.includesMsa ||
      existingSet !== (ctx.suite.templateSetKey ?? '')
    ) {
      throw new AgreementError(
        422,
        'EXISTING_MSA_INVALID',
        'The existing MSA must be a completed envelope that included the Master Services Agreement.'
      );
    }
    const sameTenant = tenantId !== null && existing.tenantId === tenantId;
    const sameSigner = existing.signerEmail === body.recipient.email.trim().toLowerCase();
    const sameProspect = salesProspectId !== null && existing.salesProspectId === salesProspectId;
    // A prospect-linked MSA belongs to that prospect: it cannot be borrowed for
    // another prospect even when the signer's address matches.
    const otherProspect =
      existing.salesProspectId !== null &&
      salesProspectId !== null &&
      existing.salesProspectId !== salesProspectId;
    if (otherProspect || (!sameTenant && !sameSigner && !sameProspect)) {
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

  const issuer = await freezeIssuer(ctx);
  const frozen = {
    ...terms.data,
    // `netenroll` is the historical name of the issuer's notice block, which
    // every template and screen reads. For a white-label suite it holds that
    // issuer's notice details -- the frozen `issuer` beside it says whose.
    netenroll: { noticeAddress: issuer.noticeAddress, noticeEmail: issuer.noticeEmail },
    issuer,
  };
  const includesMsa = !body.existingMsaEnvelopeId;
  const signerEmail = body.recipient.email.toLowerCase();
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
    salesProspectId,
    signerEmail,
    ccEmails,
    signatory,
    authorityConfirmed:
      (body.issuerAuthorityConfirmed ?? body.netenrollAuthorityConfirmed) === true,
    ctx,
    issuer: presentIssuer(issuer),
    specs,
  };
}

/** The render options for an issuer: its brand and party line, the signatory. */
export function renderOptionsFor(
  issuer: IssuerPresentation,
  opts: {
    mode: 'send' | 'preview';
    reference: string;
    signatoryName: string;
    signatoryTitle: string;
    signedDate: string;
  }
) {
  return {
    mode: opts.mode,
    reference: opts.reference,
    netenrollSignatoryName: opts.signatoryName,
    netenrollSignatoryTitle: opts.signatoryTitle,
    netenrollSignedDate: opts.signedDate,
    brand: documentBrandFor(issuer),
    issuerPartyLabel: issuer.legalName.toUpperCase(),
  };
}

export function previewDocuments(prepared: PreparedEnvelope): RenderedDocument[] {
  return renderDocuments(
    prepared.terms,
    prepared.kinds,
    renderOptionsFor(prepared.issuer, {
      mode: 'preview',
      reference: `${prepared.ctx.suite.referencePrefix}-PREVIEW`,
      signatoryName: prepared.signatory.name,
      signatoryTitle: prepared.signatory.title,
      signedDate: etDateIso(),
    }),
    prepared.specs
  );
}

/**
 * The signing link: on the issuer's own portal. NetEnroll's (and every legacy
 * envelope's) on the default portal, as before.
 */
export function signUrlFor(token: string, issuer?: Pick<IssuerPresentation, 'linkOrigin'>): string {
  return `${issuer?.linkOrigin ?? defaultPortalUrl()}/sign/${token}`;
}

/** The signing link of a sent envelope, from its frozen issuer. */
export function signUrlForEnvelope(
  token: string,
  envelope: Pick<AgreementEnvelope, 'terms'>
): string {
  return signUrlFor(token, issuerOfEnvelope(envelope));
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

/** Create, sign for the issuer and send. */
export async function createEnvelope(
  prepared: PreparedEnvelope,
  actor: Actor,
  prisma: PrismaClient
): Promise<CreatedEnvelope> {
  const { issuer, ctx, signatory } = prepared;
  if (!prepared.authorityConfirmed) {
    throw new AgreementError(
      422,
      'AUTHORITY_NOT_CONFIRMED',
      `Confirm you are authorized to sign on behalf of ${issuer.legalName}.`
    );
  }
  const isPlatform = ctx.scope === 'PLATFORM';
  const { body, terms } = prepared;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ENVELOPE_TTL_MS);
  const sign = mintToken();

  let created: AgreementEnvelope | null = null;
  for (let attempt = 0; attempt < 5 && !created; attempt += 1) {
    const reference = newReference(ctx.suite.referencePrefix);
    const clash = await prisma.agreementEnvelope.findUnique({
      where: { reference },
      select: { id: true },
    });
    if (clash) continue;
    const documents = renderDocuments(
      terms,
      prepared.kinds,
      renderOptionsFor(issuer, {
        mode: 'send',
        reference,
        signatoryName: signatory.name,
        signatoryTitle: signatory.title,
        signedDate: etDateIso(now),
      }),
      prepared.specs
    );

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
          // Until the agency enters its details: the person the link went to.
          signerName: body.recipient.name,
          signerTitle: '',
          signerEmail: prepared.signerEmail,
          inviteeOrganization: body.recipient.organization?.trim() || null,
          ccEmails: prepared.ccEmails,
          // NetEnroll signed only NetEnroll's own envelopes.
          ...(isPlatform
            ? {
                netenrollSignatoryName: signatory.name,
                netenrollSignatoryTitle: signatory.title,
                netenrollSignedByUserId: actor.userId,
                netenrollSignedAt: now,
                netenrollSignedIp: actor.ipAddress,
                netenrollSignedUserAgent: actor.userAgent,
              }
            : {}),
          issuerSignatoryName: signatory.name,
          issuerSignatoryTitle: signatory.title,
          issuerSignedByUserId: actor.userId,
          issuerSignedAt: now,
          issuerSignedIp: actor.ipAddress,
          issuerSignedUserAgent: actor.userAgent,
          salesWorkspaceId: ctx.workspace.id,
          agreementSuiteId: ctx.suite.id,
          salesProspectId: prepared.salesProspectId,
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
      const actorType = isPlatform ? ('NETENROLL' as const) : ('ISSUER' as const);
      await appendEvent(tx, envelope.id, {
        type: 'CREATED',
        actorType,
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
          recipient: {
            name: body.recipient.name,
            email: prepared.signerEmail,
            organization: body.recipient.organization?.trim() || null,
          },
          agencyDetails: 'to be entered by the agency',
          ccEmails: prepared.ccEmails,
          existingMsaEnvelopeId: prepared.existingMsaEnvelopeId,
          expiresAt: expiresAt.toISOString(),
          issuer: {
            workspaceId: ctx.workspace.id,
            suiteId: ctx.suite.id,
            scope: ctx.scope,
            legalName: issuer.legalName,
            templateSetKey: ctx.suite.templateSetKey,
          },
          salesProspectId: prepared.salesProspectId,
        },
      });
      const signedDetail = {
        signatoryName: signatory.name,
        signatoryTitle: signatory.title,
        authorityConfirmation: authorityStatementFor(issuer),
        adminUserId: actor.userId,
        adminEmail: actor.email,
        // The offer as signed: agency fields read "To be completed by Agency".
        documentHashes: Object.fromEntries(documents.map(doc => [doc.kind, doc.sha256])),
      };
      await appendEvent(tx, envelope.id, {
        // NetEnroll's own envelopes keep the event they always had. Every other
        // issuer signs as ISSUER_SIGNED, naming itself immutably.
        type: isPlatform ? 'NETENROLL_SIGNED' : 'ISSUER_SIGNED',
        actorType,
        ...actorFields,
        occurredAt: now,
        detail: isPlatform
          ? signedDetail
          : {
              ...signedDetail,
              issuerLegalName: issuer.legalName,
              issuerDisplayName: issuer.displayName,
              issuerWorkspaceId: ctx.workspace.id,
              issuerSuiteId: ctx.suite.id,
            },
      });
      return envelope;
    });
  }
  if (!created) throw new Error('Could not allocate a unique agreement reference');

  const signUrl = signUrlFor(sign.token, issuer);
  const email = await sendInvitationEmail({
    to: prepared.signerEmail,
    signerName: body.recipient.name,
    agencyLegalName: body.recipient.organization?.trim() || null,
    documentTitles: prepared.kinds.map(kind => prepared.specs[kind].title),
    signUrl,
    expiresAt,
    noticeEmail: terms.netenroll.noticeEmail,
    issuer,
  });
  await prisma.$transaction(tx =>
    appendEvent(tx, created.id, {
      type: email.sent ? 'SENT' : 'EMAIL_NOT_SENT',
      actorType: 'SYSTEM',
      detail: { to: prepared.signerEmail, reason: email.reason ?? null },
    })
  );
  await notifyLifecycle(prisma, created.id, 'SENT');

  return { envelope: created, signUrl, email };
}

/** Called after an envelope changes state, to update its Sales CRM prospect. Set by services/sales. */
type LifecycleHook = (
  prisma: PrismaClient,
  envelopeId: string,
  event:
    | 'SENT'
    | 'VIEWED'
    | 'DETAILS_ENTERED'
    | 'SIGNED'
    | 'COMPLETED'
    | 'VOIDED'
    | 'EXPIRED'
    | 'CHANGES_REQUESTED'
) => Promise<void>;
let lifecycleHook: LifecycleHook | null = null;

/**
 * The agreement engine knows nothing about the CRM; the CRM registers here.
 * Best-effort by construction: a failure is logged by the hook and never
 * reaches the agreement flow, whose evidence is already committed.
 */
export function onAgreementLifecycle(hook: LifecycleHook | null): void {
  lifecycleHook = hook;
}

export async function notifyLifecycle(
  prisma: PrismaClient,
  envelopeId: string,
  event: Parameters<LifecycleHook>[2]
): Promise<void> {
  if (!lifecycleHook) return;
  try {
    await lifecycleHook(prisma, envelopeId, event);
  } catch {
    // The hook logs its own failures; nothing propagates into the agreement flow.
  }
}

/** Mark past-expiry SENT / VIEWED envelopes EXPIRED, each with an event. */
export async function expireStaleEnvelopes(
  prisma: PrismaClient,
  onlyId?: string,
  workspaceId?: string
): Promise<number> {
  const stale = await prisma.agreementEnvelope.findMany({
    where: {
      status: { in: ['SENT', 'VIEWED'] },
      expiresAt: { lte: new Date() },
      ...(onlyId ? { id: onlyId } : {}),
      ...(workspaceId ? { salesWorkspaceId: workspaceId } : {}),
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
    if (done) {
      count += 1;
      await notifyLifecycle(prisma, row.id, 'EXPIRED');
    }
  }
  return count;
}
