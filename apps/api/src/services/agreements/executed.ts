/**
 * The executed document: the as-sent HTML with only the five signature
 * markers filled.
 *
 * This is what associates the signature with the exact record. The executed
 * HTML is built from `sentHtml` -- the frozen, hashed text the signer reviewed
 * -- and is then checked to BE that text plus the signature fragments and
 * nothing else: strip the markers from one and the inserted fragments from the
 * other and the two must be byte-identical. If they are not, completion stops.
 */

import { SIGNATURE_FONT_FAMILY } from './assets.js';
import { esc, formatIsoDate } from './format.js';
import { SIG_MARKERS, type SigMarker } from './layout.js';

export interface AgencySignature {
  method: 'TYPED' | 'DRAWN';
  /** The typed name; also the alt text of a drawn signature. */
  typedName: string;
  /** `data:image/png;base64,...` when DRAWN. */
  drawnPngDataUri?: string | null;
  printedName: string;
  title: string;
  /** `YYYY-MM-DD`, Eastern Time. */
  signedDate: string;
}

const MARKER_KEYS = Object.keys(SIG_MARKERS) as SigMarker[];

function fragment(marker: SigMarker, html: string): string {
  return `<!--SIGFRAG:${marker}-->${html}<!--/SIGFRAG:${marker}-->`;
}

export function stripMarkers(html: string): string {
  let out = html;
  for (const key of MARKER_KEYS) out = out.split(SIG_MARKERS[key]).join('');
  return out;
}

export function stripFragments(html: string): string {
  return html.replace(/<!--SIGFRAG:([A-Z_]+)-->[\s\S]*?<!--\/SIGFRAG:\1-->/g, '');
}

/** Throws unless `executed` is `sent` with only signature fragments added. */
export function assertExecutedMatchesSent(sentHtml: string, executedHtml: string): void {
  if (stripMarkers(sentHtml) !== stripFragments(executedHtml)) {
    throw new Error(
      'Executed document does not match the document as sent: refusing to produce it.'
    );
  }
  for (const key of MARKER_KEYS) {
    if (executedHtml.includes(SIG_MARKERS[key])) {
      throw new Error(`Executed document still contains the ${key} signature marker.`);
    }
  }
}

export function renderExecutedHtml(sentHtml: string, sig: AgencySignature): string {
  if (sentHtml.includes('SIGFRAG:')) {
    throw new Error('The document as sent already contains a signature fragment.');
  }
  for (const key of MARKER_KEYS) {
    const count = sentHtml.split(SIG_MARKERS[key]).length - 1;
    if (count !== 1) {
      throw new Error(
        `The document as sent has ${count} ${key} signature markers; exactly one is required.`
      );
    }
  }

  const mark =
    sig.method === 'DRAWN' && sig.drawnPngDataUri
      ? `<img src="${esc(sig.drawnPngDataUri)}" alt="Signature of ${esc(sig.typedName)}">`
      : `<span class="sig-script" style="font-family:'${SIGNATURE_FONT_FAMILY}',cursive;">${esc(sig.typedName)}</span>`;

  const values: Record<SigMarker, string> = {
    // NetEnroll's signature was applied at send and is already in the text.
    NETENROLL: '',
    AGENCY: mark,
    AGENCY_NAME: esc(sig.printedName),
    AGENCY_TITLE: esc(sig.title),
    AGENCY_DATE: esc(formatIsoDate(sig.signedDate)),
  };

  let executed = sentHtml;
  for (const key of MARKER_KEYS) {
    executed = executed.split(SIG_MARKERS[key]).join(fragment(key, values[key]));
  }
  assertExecutedMatchesSent(sentHtml, executed);
  return executed;
}
