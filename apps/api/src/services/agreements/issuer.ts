/**
 * Who issues an agreement, and how its documents, emails and pages look.
 *
 * ── Two kinds of issuer ──────────────────────────────────────────────────────
 *
 * Every envelope is issued by one agreement suite (`AgreementSuite`), owned by
 * one sales workspace: NetEnroll's own (PLATFORM) or a white-label tenant's
 * (TENANT). The issuer is NOT the recipient: `AgreementEnvelope.tenantId` is
 * the agency being contracted, and keeps meaning that.
 *
 * ── Frozen at send ───────────────────────────────────────────────────────────
 *
 * The issuer's identity is written into the envelope's terms as `issuer` when
 * it is sent, and the terms are frozen by a database trigger. So the issuer of
 * a document is a fact about the document: nothing a signer does -- opening the
 * link on another host, for instance -- and nothing an owner later changes in
 * the suite's settings can change who issued it. Envelopes sent before suites
 * existed carry no `issuer` and are NetEnroll's (`LEGACY_NETENROLL_ISSUER`).
 *
 * Brand selection uses the brand theme KEY (`@hopwhistle/shared`), never a
 * tenant name and never a hostname.
 */

import { BRAND_THEME_NAMES, isBrandThemeKey, type BrandThemeKey } from '@hopwhistle/shared';
import type { AgreementEnvelope } from '@prisma/client';

import { defaultPortalUrl } from '../../lib/tenant-brand.js';

import { brandLogoDataUri, netenrollLogoDataUri } from './assets.js';
import type { FrozenTerms } from './terms.js';

export type IssuerScope = 'PLATFORM' | 'TENANT';

/** The issuer as frozen into `terms.issuer`. Everything here is presentation. */
export interface FrozenIssuer {
  workspaceId: string;
  suiteId: string;
  scope: IssuerScope;
  /** The brand: "NetEnroll", "Life Leads Plus". */
  displayName: string;
  /** "PVN LLC". */
  legalEntityName: string;
  /** "NetEnroll", or null. */
  dbaName: string | null;
  noticeAddress: string;
  noticeEmail: string;
  replyToEmail: string | null;
  /** A BRAND_THEME_KEYS value, or null for NetEnroll's look. */
  brandTheme: string | null;
  /** `https://host` for links, or null for the default portal at the time. */
  linkOrigin: string | null;
  templateSetKey: string;
}

/** Every envelope that predates suites was issued by NetEnroll. */
export const NETENROLL_LEGAL_NAME = 'PVN LLC d/b/a NetEnroll';

/** "PVN LLC d/b/a NetEnroll": the legal entity with its d/b/a. */
export function legalNameOf(issuer: Pick<FrozenIssuer, 'legalEntityName' | 'dbaName'>): string {
  return issuer.dbaName
    ? `${issuer.legalEntityName} d/b/a ${issuer.dbaName}`
    : issuer.legalEntityName;
}

/** What an issuer looks like to a reader: names, notice email, links. */
export interface IssuerPresentation {
  scope: IssuerScope;
  displayName: string;
  /** The short name used in sentences: "NetEnroll", "Life Leads Plus". */
  shortName: string;
  /** The contracting party: "PVN LLC d/b/a NetEnroll". */
  legalName: string;
  noticeEmail: string;
  replyToEmail: string;
  brandTheme: BrandThemeKey | null;
  /** Links in emails and on pages: `https://host`, no trailing slash. */
  linkOrigin: string;
  suiteId: string | null;
  workspaceId: string | null;
}

/** Presentation of a frozen issuer. */
export function presentIssuer(issuer: FrozenIssuer): IssuerPresentation {
  const brandTheme = isBrandThemeKey(issuer.brandTheme) ? issuer.brandTheme : null;
  return {
    scope: issuer.scope,
    displayName: issuer.displayName,
    shortName: issuer.dbaName || issuer.displayName,
    legalName: legalNameOf(issuer),
    noticeEmail: issuer.noticeEmail,
    replyToEmail: issuer.replyToEmail || issuer.noticeEmail,
    brandTheme,
    linkOrigin: (issuer.linkOrigin || defaultPortalUrl()).replace(/\/+$/, ''),
    suiteId: issuer.suiteId,
    workspaceId: issuer.workspaceId,
  };
}

/**
 * NetEnroll, as every pre-suite envelope was issued. `noticeEmail` is the one
 * frozen in that envelope's terms.
 */
export function legacyNetEnrollIssuer(noticeEmail: string): IssuerPresentation {
  return {
    scope: 'PLATFORM',
    displayName: 'NetEnroll',
    shortName: 'NetEnroll',
    legalName: NETENROLL_LEGAL_NAME,
    noticeEmail,
    replyToEmail: noticeEmail,
    brandTheme: null,
    linkOrigin: defaultPortalUrl(),
    suiteId: null,
    workspaceId: null,
  };
}

/** The issuer of an envelope, from its frozen terms. Never from the request. */
export function issuerOfEnvelope(envelope: Pick<AgreementEnvelope, 'terms'>): IssuerPresentation {
  const terms = envelope.terms as unknown as FrozenTerms & { issuer?: FrozenIssuer };
  if (terms.issuer) return presentIssuer(terms.issuer);
  return legacyNetEnrollIssuer(terms.netenroll?.noticeEmail ?? 'support@pvnvoice.com');
}

/** Whether this envelope's issuer is NetEnroll (legacy or the platform suite). */
export function isNetEnrollIssued(envelope: Pick<AgreementEnvelope, 'terms'>): boolean {
  return issuerOfEnvelope(envelope).scope === 'PLATFORM';
}

// ── Document brand ──────────────────────────────────────────────────────────

/** The look of a generated document, certificate and PDF frame. */
export interface DocumentBrand {
  key: 'netenroll' | 'neutral' | BrandThemeKey;
  /** Null draws the issuer's name as text: never another issuer's logo. */
  logoDataUri: string | null;
  logoAlt: string;
  /** Rules, checks and callout borders. */
  accent: string;
  /** Eyebrows and callout titles. */
  accentText: string;
  /** Label cells. */
  labelBg: string;
  /** NetEnroll's logo file carries a tagline line under it, cropped off. */
  cropLogo: boolean;
}

export const NETENROLL_DOCUMENT_BRAND_COLORS = {
  accent: '#10B981',
  accentText: '#047857',
  labelBg: '#EEF4F2',
} as const;

/** Each theme's document palette: the portal's own brand colours. */
const THEME_DOCUMENT_COLORS: Record<
  BrandThemeKey,
  { accent: string; accentText: string; labelBg: string }
> = {
  'life-leads-plus': { accent: '#0081F1', accentText: '#0A56C2', labelBg: '#EAF2FE' },
  'powerhouse-insurance': { accent: '#9466F7', accentText: '#5B2BC9', labelBg: '#F1ECFE' },
};

export function netenrollDocumentBrand(): DocumentBrand {
  return {
    key: 'netenroll',
    logoDataUri: netenrollLogoDataUri(),
    logoAlt: 'NetEnroll',
    ...NETENROLL_DOCUMENT_BRAND_COLORS,
    cropLogo: true,
  };
}

/**
 * The document brand for an issuer: its theme's; NetEnroll's for NetEnroll;
 * and for any other issuer with no theme, a neutral look with its name as
 * text. A white-label document never carries NetEnroll's logo.
 */
export function documentBrandFor(
  issuer: Pick<IssuerPresentation, 'brandTheme' | 'displayName' | 'scope'>
): DocumentBrand {
  if (!issuer.brandTheme) {
    if (issuer.scope === 'PLATFORM') return netenrollDocumentBrand();
    return {
      key: 'neutral',
      logoDataUri: null,
      logoAlt: issuer.displayName,
      accent: '#334155',
      accentText: '#1E293B',
      labelBg: '#F1F5F9',
      cropLogo: false,
    };
  }
  return {
    key: issuer.brandTheme,
    logoDataUri: brandLogoDataUri(issuer.brandTheme),
    logoAlt: issuer.displayName || BRAND_THEME_NAMES[issuer.brandTheme],
    ...THEME_DOCUMENT_COLORS[issuer.brandTheme],
    cropLogo: false,
  };
}
