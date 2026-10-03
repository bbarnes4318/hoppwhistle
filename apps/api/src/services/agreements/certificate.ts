/**
 * The Certificate of Completion appended to every executed PDF.
 *
 * It is the audit trail, printed: who signed, how they were identified, what
 * they consented to, from where, and every event on the envelope with the
 * chain hash that ties them together. With it, an executed PDF stands on its
 * own -- nobody needs this system to read the evidence.
 */

import type { AgreementEnvelope, AgreementEvent } from '@prisma/client';

import { SIGNATURE_FONT_FAMILY, signatureFontFace } from './assets.js';
import { esc, etDateTime } from './format.js';
import { BRAND_GREEN, GREEN_TEXT, LABEL_BG, logoHtml } from './layout.js';

export const EVENT_LABELS: Record<string, string> = {
  CREATED: 'Envelope created',
  NETENROLL_SIGNED: 'Signed by NetEnroll',
  SENT: 'Sent to signer',
  EMAIL_NOT_SENT: 'Email not sent',
  RESENT: 'Link resent',
  LINK_OPENED: 'Link opened',
  OTP_SENT: 'Verification code sent',
  OTP_VERIFIED: 'Verification code verified',
  OTP_FAILED: 'Wrong verification code',
  OTP_LOCKED: 'Verification code locked',
  CONSENT_GIVEN: 'Electronic records consent given',
  DOCUMENT_REVIEWED: 'Document reviewed',
  SIGNED: 'Signed by agency',
  COMPLETED: 'Completed',
  COMPLETION_FAILED: 'Completion failed',
  CHANGES_REQUESTED: 'Changes requested',
  VOIDED: 'Voided',
  EXPIRED: 'Expired',
  COPIES_SENT: 'Executed copies sent',
  DOWNLOADED: 'Executed copy downloaded',
  PARTY_DETAILS_SUBMITTED: 'Agency details entered',
};

function shortUa(ua: string | null): string {
  if (!ua) return '—';
  return ua.length > 60 ? `${ua.slice(0, 57)}…` : ua;
}

/** A one-line summary of an event's detail, for the table. */
export function shortDetail(event: Pick<AgreementEvent, 'type' | 'detail'>): string {
  const d = (event.detail ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  const add = (label: string, value: unknown) => {
    if (value !== undefined && value !== null && value !== '')
      parts.push(`${label}: ${String(value)}`);
  };
  switch (event.type) {
    case 'NETENROLL_SIGNED':
      add('signatory', d.signatoryName);
      add('title', d.signatoryTitle);
      break;
    case 'SENT':
    case 'RESENT':
    case 'EMAIL_NOT_SENT':
    case 'OTP_SENT':
      add('to', d.to);
      add('reason', d.reason);
      break;
    case 'OTP_FAILED':
      add('attempt', d.attempts);
      break;
    case 'CONSENT_GIVEN':
      add('version', d.disclosureVersion);
      break;
    case 'DOCUMENT_REVIEWED':
      add('document', d.kind);
      {
        const reviewedSha =
          typeof d.reviewedSha256 === 'string' ? d.reviewedSha256 : d.sentHtmlSha256;
        add(
          'text SHA-256',
          typeof reviewedSha === 'string' ? `${reviewedSha.slice(0, 16)}…` : null
        );
      }
      break;
    case 'SIGNED':
      add('name', d.typedName);
      add('initials', d.initials);
      add('method', d.method);
      break;
    case 'COMPLETION_FAILED':
      add('error', typeof d.error === 'string' ? d.error.slice(0, 80) : null);
      break;
    case 'VOIDED':
      add('reason', d.reason);
      break;
    case 'COPIES_SENT':
      add('trigger', d.trigger);
      add('sent', d.sent);
      break;
    case 'PARTY_DETAILS_SUBMITTED': {
      const party = (d.party ?? {}) as Record<string, unknown>;
      add('as', party.kind === 'INDIVIDUAL' ? 'individual agent' : 'business');
      add('name', party.legalName);
      break;
    }
    case 'DOWNLOADED':
      add('document', d.kind);
      break;
    default:
      break;
  }
  const text = parts.join(' · ');
  return text.length > 140 ? `${text.slice(0, 137)}…` : text;
}

export interface CertificateInput {
  portalUrl: string;
  envelope: AgreementEnvelope;
  document: {
    id: string;
    title: string;
    templateVersion: string;
    sentHtmlSha256: string;
    presentedHtmlSha256?: string | null;
  };
  contentSha256: string;
  contentPageCount: number;
  completedAt: Date;
  agencyLegalName: string;
  /** Rendered signature: drawn PNG data URI, or null for typed. */
  drawnPngDataUri: string | null;
  netenrollAdminEmail: string | null;
  internalCopyEmails: string[];
  events: AgreementEvent[];
}

function iso(at: Date | null | undefined): string {
  return at ? at.toISOString() : '—';
}

function both(at: Date | null | undefined): string {
  return at ? `${esc(at.toISOString())}<br><span class="muted">${esc(etDateTime(at))}</span>` : '—';
}

export function renderCertificate(input: CertificateInput): string {
  const { envelope, events } = input;
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  const signed = [...sorted].reverse().find(e => e.type === 'SIGNED');
  const verified = [...sorted]
    .reverse()
    .find(e => e.type === 'OTP_VERIFIED' && (!signed || e.seq < signed.seq));
  const consent = [...sorted].reverse().find(e => e.type === 'CONSENT_GIVEN');
  const partyAt = sorted.find(e => e.type === 'PARTY_DETAILS_SUBMITTED')?.occurredAt ?? null;
  const consentDetail = (consent?.detail ?? {}) as Record<string, unknown>;
  const lastHash = sorted.length > 0 ? sorted[sorted.length - 1].hash : '—';
  const lastSeq = sorted.length > 0 ? sorted[sorted.length - 1].seq : 0;

  const kv = (rows: Array<[string, string]>) =>
    `<table class="kv">${rows.map(([l, v]) => `<tr><th>${esc(l)}</th><td>${v}</td></tr>`).join('')}</table>`;

  const signatureRender =
    envelope.signatureMethod === 'DRAWN' && input.drawnPngDataUri
      ? `<img class="sig-img" src="${esc(input.drawnPngDataUri)}" alt="Drawn signature">`
      : `<span class="sig-script">${esc(envelope.signerTypedSignature ?? '')}</span>`;

  const eventRows = sorted
    .map(
      e => `<tr>
<td class="n">${e.seq}</td>
<td>${esc(EVENT_LABELS[e.type] ?? e.type)}<div class="muted mono">${esc(e.type)}</div></td>
<td class="mono">${esc(e.occurredAt.toISOString())}</td>
<td>${esc(etDateTime(e.occurredAt))}</td>
<td>${esc(e.actorType)}${e.actorEmail ? `<div class="muted">${esc(e.actorEmail)}</div>` : ''}</td>
<td class="mono">${esc(e.ipAddress ?? '—')}</td>
<td class="ua">${esc(shortUa(e.userAgent))}</td>
<td>${esc(shortDetail(e))}</td>
</tr>`
    )
    .join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Certificate of Completion</title>
<style>
${signatureFontFace()}
@page { size: Letter; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; color: #1f2933; font-family: Helvetica, Arial, 'Liberation Sans', 'Nimbus Sans', 'FreeSans', sans-serif; font-size: 9pt; line-height: 1.4; }
.logo-crop { height: 28px; overflow: hidden; }
.logo-crop img { height: 41px; width: auto; display: block; }
.eyebrow { margin-top: 18px; font-size: 7.5pt; font-weight: 700; letter-spacing: 0.14em; color: ${GREEN_TEXT}; }
h1 { margin: 4px 0 2px; font-size: 20pt; color: #111827; }
.rule { height: 3px; background: ${BRAND_GREEN}; margin: 8px 0 14px; }
h2 { margin: 14px 0 6px; padding-bottom: 3px; border-bottom: 1px solid ${BRAND_GREEN}; font-size: 9.5pt; letter-spacing: 0.05em; color: #111827; break-after: avoid; page-break-after: avoid; }
table.kv { width: 100%; border-collapse: collapse; break-inside: avoid; page-break-inside: avoid; }
table.kv th, table.kv td { border: 1px solid #d9e3df; padding: 4px 7px; text-align: left; vertical-align: top; }
table.kv th { width: 30%; background: ${LABEL_BG}; font-size: 7pt; letter-spacing: 0.08em; text-transform: uppercase; color: #374151; }
.mono { font-family: Menlo, Consolas, 'DejaVu Sans Mono', 'Liberation Mono', monospace; font-size: 7.5pt; word-break: break-all; }
.muted { color: #6b7280; font-size: 7.5pt; }
.sig-script { font-family: '${SIGNATURE_FONT_FAMILY}', cursive; font-size: 20pt; color: #0f2a4a; }
.sig-img { max-height: 44px; max-width: 260px; display: block; }
table.events { width: 100%; border-collapse: collapse; font-size: 7pt; }
table.events th { background: #111827; color: #fff; text-align: left; padding: 4px 5px; font-size: 6.5pt; letter-spacing: 0.06em; text-transform: uppercase; }
table.events td { border: 1px solid #e5e7eb; padding: 3px 5px; vertical-align: top; }
table.events tr { break-inside: avoid; page-break-inside: avoid; }
table.events td.n { text-align: right; width: 22px; }
table.events td.ua { max-width: 120px; word-break: break-word; }
.closing { margin-top: 14px; padding: 9px 11px; border-left: 4px solid ${BRAND_GREEN}; background: #f7faf9; }
</style></head>
<body>
${logoHtml()}
<div class="eyebrow">PVN LLC D/B/A NETENROLL · ELECTRONIC SIGNATURE RECORD</div>
<h1>Certificate of Completion</h1>
<div class="rule"></div>

<h2>DOCUMENT</h2>
${kv([
  ['Reference', esc(envelope.reference)],
  ['Envelope ID', `<span class="mono">${esc(envelope.id)}</span>`],
  [
    'Document',
    `${esc(input.document.title)} <span class="muted">(${esc(input.document.templateVersion)})</span>`,
  ],
  ['Agency', esc(input.agencyLegalName)],
  ['Document page count', String(input.contentPageCount)],
  ['Content SHA-256', `<span class="mono">${esc(input.contentSha256)}</span>`],
  ...(input.document.presentedHtmlSha256
    ? ([
        [
          'Offer text SHA-256',
          `<span class="mono">${esc(input.document.sentHtmlSha256)}</span><br><span class="muted">As signed and sent by NetEnroll, agency details to be completed</span>`,
        ],
        [
          'Signed text SHA-256',
          `<span class="mono">${esc(input.document.presentedHtmlSha256)}</span><br><span class="muted">Completed with the agency's own details${partyAt ? ` at ${esc(iso(partyAt))}` : ''}; the text reviewed and signed</span>`,
        ],
      ] as Array<[string, string]>)
    : ([
        ['As-sent text SHA-256', `<span class="mono">${esc(input.document.sentHtmlSha256)}</span>`],
      ] as Array<[string, string]>)),
  ['Status', 'Completed'],
  ['Completed at', both(input.completedAt)],
])}

<h2>SIGNER</h2>
${kv([
  ['Name', esc(envelope.signerName)],
  [
    'Title',
    esc(
      signed
        ? String((signed.detail as Record<string, unknown>).title ?? envelope.signerTitle)
        : envelope.signerTitle
    ),
  ],
  ['Email', esc(envelope.signerEmail)],
  ['Signature', signatureRender],
  ['Initials', esc(envelope.signerInitials ?? '—')],
  [
    'Adoption method',
    envelope.signatureMethod === 'DRAWN' ? 'Drawn signature adopted' : 'Typed signature adopted',
  ],
  ['Signed at', both(envelope.signedAt)],
  ['IP address', `<span class="mono">${esc(signed?.ipAddress ?? '—')}</span>`],
  ['User agent', `<span class="mono">${esc(signed?.userAgent ?? '—')}</span>`],
  [
    'Verification',
    verified
      ? `Email one-time code to ${esc(envelope.signerEmail)} verified at ${esc(iso(verified.occurredAt))} (${esc(etDateTime(verified.occurredAt))}) from IP ${esc(verified.ipAddress ?? '—')}`
      : '—',
  ],
])}

<h2>NETENROLL</h2>
${kv([
  ['Signatory', esc(envelope.netenrollSignatoryName)],
  ['Title', esc(envelope.netenrollSignatoryTitle)],
  [
    'Authorized by platform user',
    esc(input.netenrollAdminEmail ?? envelope.netenrollSignedByUserId),
  ],
  ['Signed at', both(envelope.netenrollSignedAt)],
  ['IP address', `<span class="mono">${esc(envelope.netenrollSignedIp ?? '—')}</span>`],
])}

<h2>ELECTRONIC RECORDS CONSENT</h2>
${kv([
  ['Disclosure version', esc(String(consentDetail.disclosureVersion ?? '—'))],
  [
    'Disclosure text SHA-256',
    `<span class="mono">${esc(String(consentDetail.disclosureSha256 ?? '—'))}</span>`,
  ],
  ['Accepted at', both(consent?.occurredAt ?? envelope.consentedAt)],
  ['IP address', `<span class="mono">${esc(consent?.ipAddress ?? '—')}</span>`],
])}

<h2>RECIPIENTS</h2>
${kv([
  ['Signer', esc(envelope.signerEmail)],
  ['Copies to', esc(envelope.ccEmails.length > 0 ? envelope.ccEmails.join(', ') : '—')],
  [
    'NetEnroll copies',
    esc(input.internalCopyEmails.length > 0 ? input.internalCopyEmails.join(', ') : '—'),
  ],
])}

<h2>AUDIT TRAIL</h2>
<table class="events"><thead><tr><th>#</th><th>Event</th><th>UTC</th><th>Eastern</th><th>Actor</th><th>IP</th><th>User agent</th><th>Detail</th></tr></thead><tbody>${eventRows}</tbody></table>
<p style="margin-top:8px;">Event-chain hash through event ${lastSeq}: <span class="mono">${esc(lastHash)}</span></p>

<p class="closing">This certificate records the electronic execution of the document identified above under the Electronic Signatures in Global and National Commerce Act (15 U.S.C. §7001 et seq.) and the Florida Uniform Electronic Transaction Act (Fla. Stat. §668.50). The document content SHA-256 above identifies the exact signed pages; any change to them produces a different value. To verify a copy, visit ${esc(input.portalUrl)}/agreements/verify.</p>
</body></html>`;
}
