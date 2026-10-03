/**
 * Which documents an envelope carries, how each is rendered, and the exact
 * statements the signer is shown -- the disclosure, the per-document
 * acceptance and the intent statement. Each statement is recorded verbatim on
 * the event it belongs to, so the evidence names the words agreed to rather
 * than a pointer to code that may since have changed.
 */

import type { AgreementDocumentKind } from '@prisma/client';

import { esc, joinList, sha256Hex } from './format.js';
import type { RenderOptions } from './layout.js';
import * as cpa from './templates/cpa.js';
import * as cpl from './templates/cpl.js';
import * as msa from './templates/msa.js';
import type { FrozenTerms } from './terms.js';

export interface DocumentSpec {
  kind: AgreementDocumentKind;
  title: string;
  templateVersion: string;
  render: (terms: FrozenTerms, opts: RenderOptions) => string;
}

export const DOCUMENT_SPECS: Record<AgreementDocumentKind, DocumentSpec> = {
  MSA: {
    kind: 'MSA',
    title: msa.MSA_TITLE,
    templateVersion: msa.MSA_TEMPLATE_VERSION,
    render: msa.render,
  },
  CPA: {
    kind: 'CPA',
    title: cpa.CPA_TITLE,
    templateVersion: cpa.CPA_TEMPLATE_VERSION,
    render: cpa.render,
  },
  CPL: {
    kind: 'CPL',
    title: cpl.CPL_TITLE,
    templateVersion: cpl.CPL_TEMPLATE_VERSION,
    render: cpl.render,
  },
};

/** MSA first, then CPA, then CPL. */
export function documentKinds(flags: {
  includesMsa: boolean;
  includesCpa: boolean;
  includesCpl: boolean;
}): AgreementDocumentKind[] {
  const kinds: AgreementDocumentKind[] = [];
  if (flags.includesMsa) kinds.push('MSA');
  if (flags.includesCpa) kinds.push('CPA');
  if (flags.includesCpl) kinds.push('CPL');
  return kinds;
}

export interface RenderedDocument {
  kind: AgreementDocumentKind;
  title: string;
  templateVersion: string;
  html: string;
  sha256: string;
  sortOrder: number;
}

export function renderDocuments(
  terms: FrozenTerms,
  kinds: AgreementDocumentKind[],
  opts: RenderOptions
): RenderedDocument[] {
  return kinds.map((kind, sortOrder) => {
    const spec = DOCUMENT_SPECS[kind];
    const html = spec.render(terms, opts);
    return {
      kind,
      title: spec.title,
      templateVersion: spec.templateVersion,
      html,
      sha256: sha256Hex(html),
      sortOrder,
    };
  });
}

/** "the Master Services Agreement and the CPA Agreement". */
export function documentList(titles: string[]): string {
  return joinList(titles.map(title => `the ${title}`));
}

/** The intent statement above the Sign Agreements button, exactly as shown. */
export function intentStatement(params: {
  signerName: string;
  titles: string[];
  agencyLegalName: string;
}): string {
  return `By selecting Sign Agreements, I, ${params.signerName}, adopt the signature and initials shown above as my electronic signature and initials, intend to sign and be legally bound by ${documentList(params.titles)}, and confirm that I am authorized to sign on behalf of ${params.agencyLegalName}.`;
}

/** The checkbox beside each document. */
export function acceptanceStatement(title: string): string {
  return `I have read and agree to the ${title}.`;
}

// ── Electronic Records and Signature Disclosure ─────────────────────────────

export const ESIGN_DISCLOSURE_VERSION = 'ESIGN-2026-10-03';

/**
 * The disclosure, verbatim. `{{netenroll.noticeEmail}}` is the only value
 * substituted. The version and the SHA-256 of the text as shown are recorded
 * on the CONSENT_GIVEN event.
 */
export const ESIGN_DISCLOSURE_V1 = {
  title: 'Consent to Electronic Records and Signatures',
  intro:
    'PVN LLC d/b/a NetEnroll ("NetEnroll") asks you to receive, review and sign the agreements listed on this page electronically. Please read this disclosure before you continue.',
  items: [
    '1. Scope. Your consent applies to the agreements listed on this page and to the notices, statements and records NetEnroll provides to you under them.',
    '2. Electronic signature. By typing or drawing your signature and selecting "Sign Agreements", you adopt that mark as your signature. It has the same legal effect as a handwritten signature.',
    '3. Paper copies. You may request a paper copy of any agreement at no charge by writing to {{netenroll.noticeEmail}}. Your executed agreements are also emailed to you as PDF files and remain available for download.',
    '4. Withdrawing consent. You may withdraw this consent at any time before you sign by selecting "Request changes" on this page or by writing to {{netenroll.noticeEmail}}. Withdrawal does not affect the validity of anything signed before it.',
    '5. Updating your contact information. Notify NetEnroll in writing at {{netenroll.noticeEmail}} of any change to your email address.',
    '6. System requirements. A current version of Chrome, Safari, Edge or Firefox with JavaScript enabled, an email account able to receive messages from NetEnroll, and software able to open PDF files. By consenting, you confirm you meet these requirements and can open and keep the PDF copies.',
    '7. Authority. You confirm you are authorized to consent and sign on behalf of the agency named in the agreements.',
  ],
  checkbox: 'I have read this disclosure and agree to use electronic records and signatures.',
} as const;

/** The disclosure as plain text, with NetEnroll's notice email filled in. */
export function disclosureText(noticeEmail: string): string {
  const fill = (s: string) => s.split('{{netenroll.noticeEmail}}').join(noticeEmail);
  return [
    ESIGN_DISCLOSURE_V1.title,
    fill(ESIGN_DISCLOSURE_V1.intro),
    ...ESIGN_DISCLOSURE_V1.items.map(fill),
    ESIGN_DISCLOSURE_V1.checkbox,
  ].join('\n\n');
}

export function disclosureHtml(noticeEmail: string): string {
  const fill = (s: string) => esc(s).split('{{netenroll.noticeEmail}}').join(esc(noticeEmail));
  return `<h2>${esc(ESIGN_DISCLOSURE_V1.title)}</h2>
<p>${fill(ESIGN_DISCLOSURE_V1.intro)}</p>
${ESIGN_DISCLOSURE_V1.items.map(item => `<p>${fill(item)}</p>`).join('\n')}`;
}

export function disclosureSha256(noticeEmail: string): string {
  return sha256Hex(disclosureText(noticeEmail));
}
