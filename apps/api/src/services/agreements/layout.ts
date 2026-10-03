/**
 * The shared look of the three agreements, and the building blocks their
 * templates are written in.
 *
 * Every document is one self-contained HTML file: logo and signature font are
 * inlined (see assets.ts), there are no scripts and no external requests. The
 * same file is what the signer reads in a sandboxed iframe, what is hashed and
 * frozen as `AgreementDocument.sentHtml`, and -- with only the signature
 * markers filled -- what headless Chrome prints into the executed PDF.
 *
 * The running header and the page footer ("Agency Initials", "Page X of Y",
 * the reference) are puppeteer header/footer templates in print, so they repeat
 * on every page; on screen the header is drawn once at the top instead.
 */

import { SIGNATURE_FONT_FAMILY, netenrollLogoDataUri, signatureFontFace } from './assets.js';
import { esc, formatIsoDate } from './format.js';

export const BRAND_GREEN = '#10B981';
export const GREEN_TEXT = '#047857';
export const LABEL_BG = '#EEF4F2';

/** The five places the executed render fills in. Nothing else changes. */
export const SIG_MARKERS = {
  NETENROLL: '<!--SIG:NETENROLL-->',
  AGENCY: '<!--SIG:AGENCY-->',
  AGENCY_NAME: '<!--SIG:AGENCY_NAME-->',
  AGENCY_TITLE: '<!--SIG:AGENCY_TITLE-->',
  AGENCY_DATE: '<!--SIG:AGENCY_DATE-->',
} as const;
export type SigMarker = keyof typeof SIG_MARKERS;

export interface RenderOptions {
  /** 'preview' shows NetEnroll's signature as "applied at send". */
  mode: 'send' | 'preview';
  reference: string;
  netenrollSignatoryName: string;
  netenrollSignatoryTitle: string;
  /** `YYYY-MM-DD`, Eastern Time. */
  netenrollSignedDate: string;
}

/**
 * Legal text, escaped, with `**bold**` set in bold. The only markup the
 * templates' verbatim text carries.
 */
export function md(text: string): string {
  return esc(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

export function section(
  title: string,
  inner: string,
  opts: { newPage?: boolean; id?: string } = {}
): string {
  return `<section class="section${opts.newPage ? ' new-page' : ''}">
<h2 class="section-title">${md(title)}</h2>
${inner}
</section>`;
}

/** `1.1 **Heading.** Text`, with optional (a)/(b) items below. */
export function clause(num: string, text: string, items: string[] = []): string {
  const list = items.map(item => `<p class="sub">${md(item)}</p>`).join('\n');
  return `<div class="clause"><p><span class="num">${esc(num)}</span> ${md(text)}</p>${list}</div>`;
}

/** In the offer NetEnroll signs, before the agency has entered its details. */
export const AGENCY_PENDING = '<span class="pending">To be completed by Agency</span>';

/**
 * One agency cell: the value once the agency has entered its details, the
 * pending note in the offer before it has.
 */
export function agencyCell<A>(agency: A | undefined, value: (a: A) => string): string {
  return agency ? value(agency) : AGENCY_PENDING;
}

/**
 * Whether the Parties tables carry a principal row. An individual licensed
 * agent has no principal; in the offer the row is shown, pending, because the
 * agency has not said yet which it is.
 */
export function hasPrincipal(agency: { principalName?: string } | undefined): boolean {
  return !agency || Boolean(agency.principalName);
}

export function para(text: string, cls = ''): string {
  return `<p${cls ? ` class="${cls}"` : ''}>${md(text)}</p>`;
}

/** A two-column label / value table. Values are already HTML. */
export function kvTable(rows: Array<[string, string]>): string {
  return `<table class="kv">${rows
    .map(([label, value]) => `<tr><th>${esc(label)}</th><td>${value}</td></tr>`)
    .join('')}</table>`;
}

export function callout(title: string, rows: Array<[string, string]>): string {
  return `<div class="callout"><div class="callout-title">${esc(title)}</div>${rows
    .map(
      ([label, value]) =>
        `<div class="callout-row"><div class="callout-label">${esc(label)}</div><div class="callout-value">${value}</div></div>`
    )
    .join('')}</div>`;
}

export function bullets(items: string[]): string {
  return `<ul class="ack">${items.map(item => `<li>${md(item)}</li>`).join('')}</ul>`;
}

export function partHeading(title: string, subtitle: string, newPage = false): string {
  return `<div class="part${newPage ? ' new-page' : ''}"><div class="part-title">${esc(title)}</div><div class="part-subtitle">${esc(subtitle)}</div></div>`;
}

export const CHECK_ON = `<span class="check on" aria-label="Selected"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.2 6.3l2.4 2.4 5.2-5.4" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
export const CHECK_OFF = `<span class="check off" aria-label="Not selected"></span>`;

/** A typed signature in the script font. */
export function scriptSignature(name: string): string {
  return `<span class="sig-script">${esc(name)}</span>`;
}

/** The two-column signature block shared by all three documents. */
export function signatureBlock(opts: RenderOptions): string {
  const netenrollMark =
    opts.mode === 'preview'
      ? `<span class="sig-pending">Applied at send</span>`
      : scriptSignature(opts.netenrollSignatoryName);
  const row = (label: string, value: string) =>
    `<div class="sig-row"><div class="sig-row-label">${label}</div><div class="sig-row-value">${value}</div></div>`;
  return `<div class="sig-grid">
<div class="sig-col">
<div class="sig-party">PVN LLC d/b/a NETENROLL</div>
<div class="sig-line">${SIG_MARKERS.NETENROLL}${netenrollMark}</div>
<div class="sig-caption">AUTHORIZED SIGNATURE</div>
${row('PRINTED NAME', esc(opts.netenrollSignatoryName))}
${row('TITLE', esc(opts.netenrollSignatoryTitle))}
${row('DATE', esc(formatIsoDate(opts.netenrollSignedDate)))}
</div>
<div class="sig-col">
<div class="sig-party">AGENCY</div>
<div class="sig-line">${SIG_MARKERS.AGENCY}</div>
<div class="sig-caption">AUTHORIZED SIGNATURE</div>
${row('PRINTED NAME', SIG_MARKERS.AGENCY_NAME)}
${row('TITLE', SIG_MARKERS.AGENCY_TITLE)}
${row('DATE', SIG_MARKERS.AGENCY_DATE)}
</div>
</div>`;
}

const CSS = `
@page { size: Letter; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; color: #1f2933; font-family: Helvetica, Arial, 'Liberation Sans', 'Nimbus Sans', 'FreeSans', sans-serif; font-size: 10.5pt; line-height: 1.45; background: #ffffff; }
@media screen { body { max-width: 816px; margin: 0 auto; padding: 32px 40px 48px; } .new-page { margin-top: 36px; padding-top: 24px; border-top: 1px dashed #cbd5d1; } }
@media print { .screen-only { display: none !important; } .new-page { break-before: page; page-break-before: always; } }
.masthead { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 22px; }
.logo-crop { height: 28px; overflow: hidden; }
.logo-crop img { height: 41px; width: auto; display: block; }
.tagline { margin-top: 4px; font-size: 7.5pt; letter-spacing: 0.12em; color: #6b7280; text-transform: uppercase; }
.running { font-size: 7.5pt; letter-spacing: 0.12em; color: #6b7280; text-transform: uppercase; text-align: right; }
.running .ref { margin-top: 2px; letter-spacing: 0.04em; }
.eyebrow { font-size: 8pt; font-weight: 700; letter-spacing: 0.14em; color: ${GREEN_TEXT}; text-transform: uppercase; }
h1.title { margin: 6px 0 4px; font-size: 24pt; line-height: 1.15; font-weight: 700; color: #111827; }
.subtitle { color: #6b7280; font-size: 11pt; margin-bottom: 12px; }
.rule { height: 3px; background: ${BRAND_GREEN}; margin: 10px 0 18px; }
p { margin: 0 0 8px; }
strong { color: #111827; }
.section { margin-top: 18px; }
.section-title { margin: 0 0 10px; padding-bottom: 4px; border-bottom: 1px solid ${BRAND_GREEN}; font-size: 10.5pt; font-weight: 700; letter-spacing: 0.04em; color: #111827; break-after: avoid; page-break-after: avoid; }
.clause { margin: 0 0 7px; break-inside: avoid; page-break-inside: avoid; }
.clause .num { font-weight: 700; color: #111827; margin-right: 2px; }
.sub { margin: 3px 0 3px 26px; }
table.kv { width: 100%; border-collapse: collapse; margin: 6px 0 12px; break-inside: avoid; page-break-inside: avoid; }
table.kv th, table.kv td { border: 1px solid #d9e3df; padding: 6px 9px; vertical-align: top; text-align: left; }
table.kv th { width: 34%; background: ${LABEL_BG}; font-size: 7.5pt; font-weight: 700; letter-spacing: 0.08em; color: #374151; text-transform: uppercase; }
table.kv td { font-size: 10pt; }
.callout { border: 1px solid #d9e3df; border-left: 4px solid ${BRAND_GREEN}; background: #f7faf9; padding: 10px 14px; margin: 14px 0 6px; break-inside: avoid; page-break-inside: avoid; }
.callout-title { font-size: 8pt; font-weight: 700; letter-spacing: 0.14em; color: ${GREEN_TEXT}; margin-bottom: 6px; }
.callout-row { display: flex; gap: 12px; padding: 4px 0; border-top: 1px solid #e5ecea; }
.callout-row:first-of-type { border-top: 0; }
.callout-label { width: 26%; flex: none; font-size: 7.5pt; font-weight: 700; letter-spacing: 0.08em; color: #374151; text-transform: uppercase; padding-top: 1px; }
.callout-value { flex: 1; font-size: 10pt; }
.part { margin-top: 24px; padding: 10px 0 6px; border-bottom: 3px solid ${BRAND_GREEN}; }
.part-title { font-size: 15pt; font-weight: 700; color: #111827; }
.part-subtitle { color: #6b7280; font-size: 9.5pt; }
table.grid { width: 100%; border-collapse: collapse; margin: 8px 0 12px; break-inside: avoid; page-break-inside: avoid; }
table.grid th { background: #111827; color: #ffffff; font-size: 7.5pt; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; text-align: left; padding: 7px 9px; }
table.grid td { border: 1px solid #d9e3df; padding: 7px 9px; font-size: 10pt; }
table.grid td.c { text-align: center; }
.check { display: inline-block; width: 14px; height: 14px; border-radius: 3px; vertical-align: middle; line-height: 0; }
.check.off { border: 1.5px solid #9ca3af; background: #ffffff; }
.check.on { background: ${BRAND_GREEN}; border: 1.5px solid ${BRAND_GREEN}; padding: 0.5px; }
ul.ack { margin: 6px 0 10px; padding-left: 18px; }
ul.ack li { margin: 0 0 6px; }
.sig-grid { display: flex; gap: 28px; margin-top: 18px; break-inside: avoid; page-break-inside: avoid; }
.sig-col { flex: 1; min-width: 0; }
.sig-party { font-weight: 700; font-size: 10pt; letter-spacing: 0.04em; color: #111827; margin-bottom: 10px; }
.sig-line { height: 52px; border-bottom: 1.5px solid #111827; display: flex; align-items: flex-end; padding: 0 2px 3px; }
.sig-line img { max-height: 48px; max-width: 100%; display: block; }
.sig-script { font-family: '${SIGNATURE_FONT_FAMILY}', cursive; font-size: 24pt; line-height: 1; color: #0f2a4a; white-space: nowrap; overflow: hidden; }
.sig-pending { color: #6b7280; font-style: italic; font-size: 9.5pt; }
.sig-caption { font-size: 7pt; letter-spacing: 0.1em; color: #6b7280; margin: 3px 0 10px; }
.sig-row { display: flex; border-bottom: 1px solid #d1d5db; padding: 5px 0 3px; min-height: 26px; align-items: flex-end; }
.sig-row-label { width: 40%; flex: none; font-size: 7pt; letter-spacing: 0.1em; color: #6b7280; }
.sig-row-value { flex: 1; font-size: 10pt; color: #111827; }
.pending { color: #9ca3af; font-style: italic; }
.end { margin-top: 26px; text-align: center; font-size: 8pt; font-weight: 700; letter-spacing: 0.16em; color: #6b7280; }
.witness { margin-top: 6px; }
`;

export interface DocumentFrame {
  /** The `<title>`, e.g. "Master Services Agreement". */
  title: string;
  runningHeader: string;
  tagline?: string;
  eyebrow: string;
  heading: string;
  subtitle: string;
  body: string;
  reference: string;
}

/**
 * The wordmark alone. The logo file carries a "PAY-PER-APPLICATION" line under
 * it, which belongs on the CPA only (as its tagline), so it is cropped off.
 */
export function logoHtml(): string {
  return `<div class="logo-crop"><img src="${netenrollLogoDataUri()}" alt="NetEnroll"></div>`;
}

/** The complete HTML document. */
export function documentHtml(frame: DocumentFrame): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(frame.title)}</title>
<style>${signatureFontFace()}${CSS}</style>
</head>
<body>
<header class="masthead">
<div>${logoHtml()}${frame.tagline ? `<div class="tagline">${esc(frame.tagline)}</div>` : ''}</div>
<div class="running screen-only"><div>${esc(frame.runningHeader)}</div><div class="ref">Ref ${esc(frame.reference)}</div></div>
</header>
<div class="eyebrow">${esc(frame.eyebrow)}</div>
<h1 class="title">${esc(frame.heading)}</h1>
<div class="subtitle">${esc(frame.subtitle)}</div>
<div class="rule"></div>
${frame.body}
</body>
</html>`;
}
