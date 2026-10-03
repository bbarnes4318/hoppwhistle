/**
 * A TEST-ONLY template set. Its text is placeholder, not contract language,
 * and it is registered only by the suites that import it -- never by the
 * application. It exists so the white-label send, sign and complete paths can
 * be exercised end to end while no approved Life Leads Plus text exists.
 */

import type { AgreementDocumentKind } from '@prisma/client';

import type { DocumentSpec } from '../../services/agreements/documents.js';
import { esc } from '../../services/agreements/format.js';
import {
  agencyCell,
  documentHtml,
  kvTable,
  para,
  section,
  signatureBlock,
  type RenderOptions,
} from '../../services/agreements/layout.js';
import { getTemplateSet, registerTemplateSet } from '../../services/agreements/template-sets.js';
import type { FrozenTerms } from '../../services/agreements/terms.js';

function spec(kind: AgreementDocumentKind, prefix: string): DocumentSpec {
  const title = `Fixture ${kind} Document`;
  return {
    kind,
    title,
    templateVersion: `${prefix}-${kind}-TEST.1`,
    render: (terms: FrozenTerms, opts: RenderOptions) =>
      documentHtml({
        title,
        runningHeader: `FIXTURE ${kind}`,
        eyebrow: 'TEST FIXTURE · NOT A CONTRACT',
        heading: title,
        subtitle: 'Placeholder text for automated tests only',
        reference: opts.reference,
        brand: opts.brand,
        body: `${para('This fixture document is placeholder text used only by automated tests.')}
${section(
  'Parties',
  kvTable([
    ['NOTICE', `${esc(terms.netenroll.noticeAddress)} · ${esc(terms.netenroll.noticeEmail)}`],
    ['AGENCY LEGAL NAME', agencyCell(terms.agency, a => esc(a.legalName))],
  ])
)}
${signatureBlock(opts)}`,
      }),
  };
}

/** Register (once) a fixture set for one scope/brand. Returns its key. */
export function installFixtureTemplateSet(key: string, brandTheme: string | null): string {
  if (getTemplateSet(key)) return key;
  const prefix = key.toUpperCase().replace(/[^A-Z0-9]/g, '');
  registerTemplateSet({
    key,
    label: `Test fixture (${key})`,
    scope: 'TENANT',
    brandTheme,
    documents: { MSA: spec('MSA', prefix), CPA: spec('CPA', prefix), CPL: spec('CPL', prefix) },
  });
  return key;
}
