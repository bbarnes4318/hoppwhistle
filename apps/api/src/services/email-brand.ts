/**
 * Who an email says it is from.
 *
 * ── The rule ─────────────────────────────────────────────────────────────────
 *
 * An email to somebody whose agency has a brand is that brand's email, end to
 * end: the product name in the subject and the body is the brand's name, the
 * header is the brand's logo, links point at the agency's own domain when it
 * has one, the From display name is the brand, and the sign-off is "The
 * <brand> team". "NetEnroll" appears nowhere in it. The agency's customers --
 * its agents, buyers and publishers -- never learn whose platform it runs on.
 *
 * A child agency is sold under the white-label that onboarded it, so it takes
 * the parent's brand (`brandForTenant` falls back to the parent) and the
 * parent's domain when it has none of its own.
 *
 * An agency with no brand, and mail with no agency at all, reads as NetEnroll,
 * exactly as it always has.
 */

import { BRAND_THEME_NAMES } from '@hopwhistle/shared';

import { brandForTenant, defaultPortalUrl, portalUrlForTenant } from '../lib/tenant-brand.js';

export interface EmailBrand {
  /** True when the tenant has a brand. False means NetEnroll's own look. */
  branded: boolean;
  /** What the product is called in this email. */
  productName: string;
  /** The header logo, absolute, or null for NetEnroll's text wordmark. */
  logoUrl: string | null;
  /** Where links in this email point, with no trailing slash. */
  linkBase: string;
  /** The full From header. */
  from: string;
  /** The last line of the message. */
  signOff: string;
}

/**
 * APP_URL, the portal address every link and asset hangs off by default. The
 * default, not the answer for a tenant: a tenant's links come from
 * `portalUrlForTenant` (lib/tenant-brand.ts), which is `linkBase` below.
 */
export function appUrl(): string {
  return defaultPortalUrl();
}

function smtpFrom(): string {
  return process.env.SMTP_FROM || 'noreply@netenroll.com';
}

/**
 * The From header for a display name. A configured SMTP_FROM that already
 * carries a display name ("NetEnroll <noreply@...>") has only its address kept,
 * so a branded message does not end up with two names.
 */
function fromHeader(displayName: string): string {
  const configured = smtpFrom();
  const match = /<([^>]+)>/.exec(configured);
  const address = match ? match[1] : configured;
  const safeName = displayName.replace(/["<>\r\n]/g, '').trim();
  return `${safeName} <${address}>`;
}

/** NetEnroll's own look, for unbranded agencies and platform mail. */
export function netEnrollEmailBrand(): EmailBrand {
  return {
    branded: false,
    productName: 'NetEnroll',
    logoUrl: null,
    linkBase: appUrl(),
    from: smtpFrom(),
    signOff: 'The NetEnroll team',
  };
}

/**
 * The brand for mail to somebody in `tenantId`.
 *
 * Never throws: a failed read is NetEnroll's look, because an email must not be
 * lost over its letterhead.
 */
export async function emailBrandForTenant(
  tenantId: string | null | undefined
): Promise<EmailBrand> {
  if (!tenantId) return netEnrollEmailBrand();

  try {
    // The tenant's domain, else its parent's, else the default portal: the
    // one resolver every tenant-facing link is built from.
    const [brand, linkBase] = await Promise.all([
      brandForTenant(tenantId),
      portalUrlForTenant(tenantId),
    ]);

    if (!brand) {
      return { ...netEnrollEmailBrand(), linkBase };
    }

    const productName = brand.name?.trim() || BRAND_THEME_NAMES[brand.theme];
    return {
      branded: true,
      productName,
      logoUrl: `${appUrl()}/brands/${brand.theme}/logo.png`,
      linkBase,
      from: fromHeader(productName),
      signOff: `The ${productName} team`,
    };
  } catch {
    return netEnrollEmailBrand();
  }
}
