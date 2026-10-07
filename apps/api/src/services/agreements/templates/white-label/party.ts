/**
 * Who a white-label document names: the issuer frozen into the envelope's
 * terms at send (`terms.issuer`), never the request and never NetEnroll.
 */

import { legalNameOf, type FrozenIssuer } from '../../issuer.js';
import type { FrozenTerms } from '../../terms.js';

export interface IssuerParty {
  /** The contracting party: "Life Leads Plus LLC", with its d/b/a if any. */
  legalName: string;
  /** The name used in sentences: the d/b/a, else the brand. */
  shortName: string;
  /** The issuer's portal, e.g. agents.lifeleadsplus.com. */
  portalHost: string;
}

export function issuerParty(terms: FrozenTerms, portalHost: string): IssuerParty {
  const issuer = (terms as FrozenTerms & { issuer?: FrozenIssuer }).issuer;
  if (!issuer?.legalEntityName?.trim()) {
    // A white-label document never falls back to NetEnroll as the party.
    throw new Error('A white-label agreement needs its issuer’s legal contracting entity');
  }
  return {
    legalName: legalNameOf(issuer),
    shortName: issuer.dbaName?.trim() || issuer.displayName,
    portalHost,
  };
}
