/**
 * The agency's own details, entered by the signer.
 *
 * NetEnroll sends the commercial terms only. Before reviewing, the signer
 * says whether they sign for a business or as an individual licensed agent
 * and enters the details that go in the Parties tables. The documents are
 * then completed with those details -- the same templates, the same
 * reference, NetEnroll's signature as applied at send -- and that completed
 * version (`AgreementDocument.presentedHtml`) is what the signer reviews and
 * signs. The offer NetEnroll signed stays as it was (`sentHtml`), its agency
 * fields reading "To be completed by Agency". Both are frozen by triggers.
 *
 * Envelopes sent before this carry the agency in their terms and have no
 * presented version; everything here falls back to that.
 */

import type { AgreementDocument, AgreementEnvelope, Prisma, PrismaClient } from '@prisma/client';

import { renderDocuments } from './documents.js';
import { AgreementError, renderOptionsFor } from './envelopes.js';
import { appendEvent, lockEnvelope } from './events.js';
import { etDateIso } from './format.js';
import { issuerOfEnvelope, type FrozenIssuer } from './issuer.js';
import { getTemplateSet } from './template-sets.js';
import {
  agencyFromParty,
  firstIssueMessage,
  partyDetailsSchema,
  signerFromParty,
  type AgencyDetails,
  type FrozenTerms,
  type PartyDetails,
} from './terms.js';

type EnvelopeLike = Pick<
  AgreementEnvelope,
  'terms' | 'partyDetails' | 'inviteeOrganization' | 'signerName'
>;

/** The agency as the documents print it, or undefined while it is still to enter it. */
export function agencyOf(
  envelope: Pick<AgreementEnvelope, 'terms' | 'partyDetails'>
): AgencyDetails | undefined {
  if (envelope.partyDetails)
    return agencyFromParty(envelope.partyDetails as unknown as PartyDetails);
  return (envelope.terms as unknown as FrozenTerms).agency;
}

/** A name for the agency on screens and in emails, whatever stage it is at. */
export function agencyLabel(envelope: EnvelopeLike): string {
  return agencyOf(envelope)?.legalName ?? envelope.inviteeOrganization ?? envelope.signerName;
}

/** Whether the signer still has to enter the agency's details before reviewing. */
export function needsPartyDetails(
  envelope: Pick<AgreementEnvelope, 'terms' | 'partyDetails'>
): boolean {
  return agencyOf(envelope) === undefined;
}

/** Whether this envelope's agency is an individual licensed agent. */
export function isIndividual(envelope: Pick<AgreementEnvelope, 'terms' | 'partyDetails'>): boolean {
  return agencyOf(envelope)?.kind === 'INDIVIDUAL';
}

/** The text the signer reviews and signs: the completed version when there is one. */
export function signableHtml(doc: Pick<AgreementDocument, 'presentedHtml' | 'sentHtml'>): string {
  return doc.presentedHtml ?? doc.sentHtml;
}

export function signableSha256(
  doc: Pick<AgreementDocument, 'presentedHtmlSha256' | 'sentHtmlSha256'>
): string {
  return doc.presentedHtmlSha256 ?? doc.sentHtmlSha256;
}

/**
 * Details to start the form with: the agency's own, from the completed MSA
 * this envelope builds on, when there is one.
 */
export async function partyPrefill(
  envelope: Pick<AgreementEnvelope, 'existingMsaEnvelopeId'>,
  prisma: PrismaClient
): Promise<PartyDetails | null> {
  if (!envelope.existingMsaEnvelopeId) return null;
  const msa = await prisma.agreementEnvelope.findUnique({
    where: { id: envelope.existingMsaEnvelopeId },
    select: { partyDetails: true },
  });
  return (msa?.partyDetails as unknown as PartyDetails | null) ?? null;
}

export interface Evidence {
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * Record the agency's details and complete the documents with them. Once.
 *
 * In one transaction holding the envelope lock: re-check nothing was entered
 * already, render every document with the details, store each completed
 * version with its hash, set the signer from the details, and append
 * PARTY_DETAILS_SUBMITTED naming the details and both hashes of each document.
 */
export async function submitPartyDetails(
  envelopeId: string,
  raw: unknown,
  evidence: Evidence,
  prisma: PrismaClient
): Promise<PartyDetails> {
  const parsed = partyDetailsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AgreementError(422, 'VALIDATION_ERROR', firstIssueMessage(parsed.error));
  }
  const party = parsed.data;
  const signer = signerFromParty(party);
  const now = new Date();

  await prisma.$transaction(async tx => {
    await lockEnvelope(tx, envelopeId);
    const envelope = await tx.agreementEnvelope.findUniqueOrThrow({
      where: { id: envelopeId },
      include: { documents: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!needsPartyDetails(envelope)) {
      throw new AgreementError(
        409,
        'DETAILS_ALREADY_ENTERED',
        'The agency details have already been entered for these agreements.'
      );
    }
    const terms = envelope.terms as unknown as FrozenTerms & { issuer?: FrozenIssuer };
    // The issuing suite's own templates -- NetEnroll's for every envelope that
    // predates suites -- never whichever suite happens to be asking.
    const set = getTemplateSet(terms.issuer?.templateSetKey ?? 'netenroll');
    if (!set?.documents) {
      throw new AgreementError(
        409,
        'TEMPLATES_NOT_CONFIGURED',
        'Contract templates not configured.'
      );
    }
    const issuer = issuerOfEnvelope(envelope);
    const completed = renderDocuments(
      { ...terms, agency: agencyFromParty(party) },
      envelope.documents.map(d => d.kind),
      renderOptionsFor(issuer, {
        mode: 'send',
        reference: envelope.reference,
        signatoryName: envelope.issuerSignatoryName ?? envelope.netenrollSignatoryName ?? '',
        signatoryTitle: envelope.issuerSignatoryTitle ?? envelope.netenrollSignatoryTitle ?? '',
        signedDate: etDateIso(
          envelope.issuerSignedAt ?? envelope.netenrollSignedAt ?? envelope.sentAt
        ),
      }),
      set.documents
    );
    // Completed from the very text that was sent: a template that has moved on
    // to another version since must not complete this envelope.
    for (const doc of envelope.documents) {
      const rendered = completed.find(c => c.kind === doc.kind)!;
      if (rendered.templateVersion !== doc.templateVersion) {
        throw new AgreementError(
          409,
          'TEMPLATE_CHANGED',
          `The ${doc.title} was sent from template ${doc.templateVersion}, which is no longer installed. Contact the sender for new agreements.`
        );
      }
    }
    for (const doc of envelope.documents) {
      const rendered = completed.find(c => c.kind === doc.kind)!;
      await tx.agreementDocument.update({
        where: { id: doc.id },
        data: { presentedHtml: rendered.html, presentedHtmlSha256: rendered.sha256 },
      });
    }
    await tx.agreementEnvelope.update({
      where: { id: envelopeId },
      data: {
        partyDetails: party as unknown as Prisma.InputJsonValue,
        partySubmittedAt: now,
        signerName: signer.name,
        signerTitle: signer.title,
      },
    });
    await appendEvent(tx, envelopeId, {
      type: 'PARTY_DETAILS_SUBMITTED',
      actorType: 'SIGNER',
      actorEmail: envelope.signerEmail,
      ipAddress: evidence.ipAddress,
      userAgent: evidence.userAgent,
      occurredAt: now,
      detail: {
        party,
        signer,
        documents: envelope.documents.map(doc => ({
          documentId: doc.id,
          kind: doc.kind,
          sentHtmlSha256: doc.sentHtmlSha256,
          presentedHtmlSha256: completed.find(c => c.kind === doc.kind)!.sha256,
        })),
      },
    });
  });
  return party;
}
