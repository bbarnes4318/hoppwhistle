/**
 * Template sets: which MSA, CPA and CPL each agreement suite sends.
 *
 * ── Ownership is separate from rendering ─────────────────────────────────────
 *
 * The engine renders, freezes, signs and executes whatever document specs it is
 * given; a template set says WHICH specs, and whose they are. NetEnroll's three
 * agreements are the `netenroll` set and stay exactly as approved
 * (templates/{msa,cpa,cpl}.ts, pinned sentence by sentence by
 * agreement-templates.test.ts). Another issuer gets its own set, with its own
 * versions, and changing one set never touches another.
 *
 * ── Versions are immutable ───────────────────────────────────────────────────
 *
 * A template version is code. Once a document has been sent from it the sent
 * HTML and its SHA-256 are frozen on the row, so that document never depends on
 * the template again -- but the version string still names the text it was
 * rendered from, so a changed text is ALWAYS a new version string, never an
 * edit under the old one. `agreement-suites.test.ts` refuses two sets sharing a
 * version string.
 *
 * ── A set with no text ───────────────────────────────────────────────────────
 *
 * `life-leads-plus` is registered with `documents: null`. No approved Life
 * Leads Plus contract text exists in this repository, and NetEnroll's is not
 * Life Leads Plus's to send. Its suite therefore reads "Contract templates not
 * configured" and every preview and send is refused. To install approved text:
 *
 *   1. Add templates/life-leads-plus/{msa,cpa,cpl}.ts, each exporting a title,
 *      a NEW version string (e.g. `LLP-MSA-2026-11-01.1`) and a `render`
 *      written with the layout.ts helpers, passing `opts.brand` to
 *      `documentHtml` and `opts.issuerPartyLabel` to `signatureBlock` (all
 *      five signature markers must appear exactly once).
 *   2. Point `documents` below at them.
 *   3. Add a verbatim-text test for them beside agreement-templates.test.ts.
 *
 * Which set a suite uses (`AgreementSuite.templateSetKey`) is set by platform
 * admins only, and audited. A set names the scope -- and for a tenant set, the
 * brand theme -- it may serve, so NetEnroll's legal text can never be selected
 * for a white-label suite and vice versa.
 */

import type { AgreementDocumentKind } from '@prisma/client';

import { DOCUMENT_SPECS, type DocumentSpec } from './documents.js';
import type { IssuerScope } from './issuer.js';

export interface TemplateSet {
  key: string;
  label: string;
  /** Which kind of workspace may use it. */
  scope: IssuerScope;
  /** For a TENANT set: the only brand theme whose suites may use it. */
  brandTheme: string | null;
  /** The specs, or null when no approved text is installed. */
  documents: Record<AgreementDocumentKind, DocumentSpec> | null;
  /** Shown while `documents` is null: where the text goes. */
  installNote?: string;
}

const REGISTRY = new Map<string, TemplateSet>();

/** Register a set. A key may be registered once; a version string never twice. */
export function registerTemplateSet(set: TemplateSet): void {
  if (!/^[a-z0-9][a-z0-9-]{1,47}$/.test(set.key)) {
    throw new Error(`Template set key ${set.key} is not a valid key`);
  }
  if (REGISTRY.has(set.key)) throw new Error(`Template set ${set.key} is already registered`);
  if (set.documents) {
    const taken = new Set(
      [...REGISTRY.values()].flatMap(s =>
        s.documents ? Object.values(s.documents).map(d => d.templateVersion) : []
      )
    );
    for (const spec of Object.values(set.documents)) {
      if (taken.has(spec.templateVersion)) {
        throw new Error(
          `Template version ${spec.templateVersion} already belongs to another set; a new text is a new version`
        );
      }
    }
  }
  REGISTRY.set(set.key, set);
}

/** Remove a set registered by a test. Never used by the application. */
export function unregisterTemplateSet(key: string): void {
  if (key === 'netenroll' || key === 'life-leads-plus') {
    throw new Error(`The ${key} template set cannot be removed`);
  }
  REGISTRY.delete(key);
}

export function getTemplateSet(key: string | null | undefined): TemplateSet | null {
  return key ? (REGISTRY.get(key) ?? null) : null;
}

export function listTemplateSets(): TemplateSet[] {
  return [...REGISTRY.values()];
}

registerTemplateSet({
  key: 'netenroll',
  label: 'NetEnroll (PVN LLC d/b/a NetEnroll) — MSA, CPA, CPL',
  scope: 'PLATFORM',
  brandTheme: null,
  documents: DOCUMENT_SPECS,
});

registerTemplateSet({
  key: 'life-leads-plus',
  label: 'Life Leads Plus — MSA, CPA, CPL',
  scope: 'TENANT',
  brandTheme: 'life-leads-plus',
  documents: null,
  installNote:
    'Approved Life Leads Plus MSA, CPA and CPL text has not been installed. See apps/api/src/services/agreements/template-sets.ts.',
});

export type TemplateSetState =
  | { configured: true; set: TemplateSet; documents: Record<AgreementDocumentKind, DocumentSpec> }
  | { configured: false; set: TemplateSet | null; reason: string };

/**
 * The set a suite may send from, or why it may not.
 *
 * Refuses a set registered for another scope or another brand, even if a row
 * names it -- a defence behind the platform-only write path, not instead of it.
 */
export function templateSetFor(suite: {
  scope: IssuerScope;
  templateSetKey: string | null;
  brandTheme: string | null;
}): TemplateSetState {
  const set = getTemplateSet(suite.templateSetKey);
  if (!set) {
    return { configured: false, set: null, reason: 'Contract templates not configured' };
  }
  if (
    set.scope !== suite.scope ||
    (set.scope === 'TENANT' && set.brandTheme !== null && set.brandTheme !== suite.brandTheme)
  ) {
    return { configured: false, set: null, reason: 'Contract templates not configured' };
  }
  if (!set.documents) {
    return { configured: false, set, reason: 'Contract templates not configured' };
  }
  return { configured: true, set, documents: set.documents };
}

/** Whether a set may be assigned to a suite of this scope and brand. */
export function templateSetAssignable(
  key: string | null,
  suite: { scope: IssuerScope; brandTheme: string | null }
): boolean {
  if (key === null) return true;
  const set = getTemplateSet(key);
  if (!set || set.scope !== suite.scope) return false;
  return set.scope === 'PLATFORM' || set.brandTheme === null || set.brandTheme === suite.brandTheme;
}
