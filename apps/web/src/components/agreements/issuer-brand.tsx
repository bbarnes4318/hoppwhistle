'use client';

import { BrandWordmark } from '@/components/brand/brand-lockup';
import { Logo } from '@/components/brand/logo';
import { resolveBrand } from '@/lib/brand-themes';

/**
 * Who issued an agreement, as the public signing and download pages receive
 * it from the API -- read from the envelope's FROZEN issuer, never from the
 * host the page was opened on. A Life Leads Plus agreement opened on
 * agents.netenroll.com is still drawn as Life Leads Plus, and vice versa.
 */
export interface PublicIssuer {
  scope: 'PLATFORM' | 'TENANT';
  displayName: string;
  shortName: string;
  legalName: string;
  brandTheme: string | null;
}

/** NetEnroll, which issued every agreement before suites existed. */
export const NETENROLL_ISSUER: PublicIssuer = {
  scope: 'PLATFORM',
  displayName: 'NetEnroll',
  shortName: 'NetEnroll',
  legalName: 'PVN LLC d/b/a NetEnroll',
  brandTheme: null,
};

/**
 * The issuer's logo: its brand wordmark, NetEnroll's lockup for NetEnroll, its
 * name in text for any other issuer -- and nothing at all until it is known,
 * so a white-label signer never sees NetEnroll's logo flash first.
 */
export function IssuerLogo({ issuer }: { issuer: PublicIssuer | null }): JSX.Element | null {
  if (!issuer) return <span className="h-8" aria-hidden="true" />;
  const brand = resolveBrand(
    issuer.brandTheme ? { theme: issuer.brandTheme, name: issuer.displayName } : null
  );
  if (brand) return <BrandWordmark brand={brand} surface="light" className="w-[200px]" />;
  if (issuer.scope === 'PLATFORM') return <Logo width={180} />;
  return <span className="text-lg font-semibold text-ink">{issuer.displayName}</span>;
}

/** The issuer's palette around the page (the portal's own brand tokens). */
export function IssuerBrandScope({
  issuer,
  children,
}: {
  issuer: PublicIssuer | null;
  children: React.ReactNode;
}): JSX.Element {
  const brand = resolveBrand(
    issuer?.brandTheme ? { theme: issuer.brandTheme, name: issuer.displayName } : null
  );
  if (!brand) return <>{children}</>;
  return (
    <div data-brand={brand.key}>
      <div data-theme="light">{children}</div>
    </div>
  );
}
