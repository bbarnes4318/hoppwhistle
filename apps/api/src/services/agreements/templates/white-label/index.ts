/**
 * White-label template sets: NetEnroll's MSA, CPA and CPL with the issuer
 * named in NetEnroll's place, its portal, and its brand's look.
 *
 * Each issuer that uses them gets its own version strings (prefixed with its
 * reference prefix), so its documents never share a version with NetEnroll's
 * or another issuer's, and a change to the white-label text is a new version
 * for every issuer at once -- bump TEXT_DATE below.
 */

import type { AgreementDocumentKind } from '@prisma/client';

import type { DocumentSpec } from '../../documents.js';
import { CPA_TITLE } from '../cpa.js';
import { CPL_TITLE } from '../cpl.js';
import { MSA_TITLE } from '../msa.js';

import * as cpa from './cpa.js';
import * as cpl from './cpl.js';
import * as msa from './msa.js';

/** The date of the white-label text, in every version string. */
const TEXT_DATE = '2026-10-07';

export function whiteLabelDocumentSpecs(issuer: {
  /** "LLP": the start of every version string. */
  versionPrefix: string;
  /** Where the Portal is, as the MSA defines it: "agents.lifeleadsplus.com". */
  portalHost: string;
}): Record<AgreementDocumentKind, DocumentSpec> {
  const version = (kind: AgreementDocumentKind) => `${issuer.versionPrefix}-${kind}-${TEXT_DATE}.1`;
  return {
    MSA: {
      kind: 'MSA',
      title: MSA_TITLE,
      templateVersion: version('MSA'),
      render: (terms, opts) => msa.render(terms, opts, issuer.portalHost),
    },
    CPA: {
      kind: 'CPA',
      title: CPA_TITLE,
      templateVersion: version('CPA'),
      render: (terms, opts) => cpa.render(terms, opts, issuer.portalHost),
    },
    CPL: {
      kind: 'CPL',
      title: CPL_TITLE,
      templateVersion: version('CPL'),
      render: (terms, opts) => cpl.render(terms, opts, issuer.portalHost),
    },
  };
}
