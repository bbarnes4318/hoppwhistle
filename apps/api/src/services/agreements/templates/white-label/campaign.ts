/**
 * The white-label parties table: NetEnroll's (../campaign.ts) with the issuer
 * named in NetEnroll's place. The delivery and payment tables are shared
 * unchanged.
 */

import { esc, formatIsoDate } from '../../format.js';
import { agencyCell, hasPrincipal, kvTable } from '../../layout.js';
import type { FrozenTerms } from '../../terms.js';

import type { IssuerParty } from './party.js';

export function partiesTable(terms: FrozenTerms, p: IssuerParty): string {
  const a = terms.agency;
  return kvTable([
    [`${p.shortName.toUpperCase()} ENTITY`, esc(p.legalName)],
    ['AGENCY LEGAL NAME', agencyCell(a, x => esc(x.legalName))],
    ['STATE / ENTITY TYPE', agencyCell(a, x => esc(x.stateEntityType))],
    ...(hasPrincipal(a)
      ? [
          [
            'PRINCIPAL NAME & TITLE',
            agencyCell(a, x => `${esc(x.principalName)}, ${esc(x.principalTitle)}`),
          ] as [string, string],
        ]
      : []),
    [
      'BILLING EMAIL & PHONE',
      agencyCell(a, x => `${esc(x.billingEmail)} · ${esc(x.billingPhone)}`),
    ],
    ['MSA EFFECTIVE DATE', esc(formatIsoDate(terms.msaEffectiveDate))],
  ]);
}
