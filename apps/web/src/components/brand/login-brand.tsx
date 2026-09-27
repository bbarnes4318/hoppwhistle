'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { BrandLockup } from '@/components/brand/brand-lockup';
import { Logo } from '@/components/brand/logo';
import { resolveBrand, type ActiveBrand, type ServerBrand } from '@/lib/brand-themes';

/**
 * The sign-in page's brand: the agency that owns the host, or none.
 *
 * Everywhere past sign-in the brand is the session's (`useBrand`). This page
 * has no session, so `app/login/layout.tsx` resolves the brand from the
 * request's host on the server (`lib/server/public-brand.ts`) and hands it in
 * here. Rendered on the server, so a branded domain's login page never shows
 * NetEnroll's logo first.
 *
 * With a brand, the page is also wrapped in the brand's palette: `data-brand`
 * over a light `data-theme` scope, which is the nested form of the palette
 * block in globals.css. On the page's own subtree rather than on <html>, so
 * nothing outlives the page.
 */
const LoginBrandContext = createContext<ActiveBrand | null>(null);

export function LoginBrandProvider({
  brand,
  children,
}: {
  brand: ServerBrand | null;
  children: ReactNode;
}): JSX.Element {
  const active = useMemo(() => resolveBrand(brand), [brand]);
  return (
    <LoginBrandContext.Provider value={active}>
      {active ? (
        <div data-brand={active.key}>
          <div data-theme="light">{children}</div>
        </div>
      ) : (
        children
      )}
    </LoginBrandContext.Provider>
  );
}

/** The host's brand on the sign-in page, or null for NetEnroll. */
export function useLoginBrand(): ActiveBrand | null {
  return useContext(LoginBrandContext);
}

/** The logo at the top of the sign-in card: the agency's, or NetEnroll's. */
export function LoginBrandLogo(): JSX.Element {
  const brand = useLoginBrand();
  if (!brand) return <Logo width={272} />;
  return <BrandLockup brand={brand} tone="light" />;
}
