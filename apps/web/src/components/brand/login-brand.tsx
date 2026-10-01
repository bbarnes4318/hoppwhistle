'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { BrandWordmark } from '@/components/brand/brand-lockup';
import { Logo } from '@/components/brand/logo';
import { resolveBrand, type ActiveBrand, type ServerBrand } from '@/lib/brand-themes';
import { cn } from '@/lib/utils';

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

/**
 * The ground the sign-in page's brand panel is painted in.
 *
 * Dark -- the agency's navy -- when the host has a brand: every theme ships a
 * wordmark reversed out for exactly that (`wordmarkOnDark`). Light for
 * NetEnroll, whose lockup is the one supplied artwork and has black lettering
 * that would disappear on anything dark (see components/brand/logo.tsx).
 */
export type LoginSurface = 'dark' | 'light';

export function useLoginSurface(): LoginSurface {
  return useLoginBrand() ? 'dark' : 'light';
}

/**
 * The logo on the sign-in page: the agency's wordmark, or NetEnroll's lockup.
 *
 * `surface` is the ground it sits on, which picks the artwork: the agency's
 * wordmark ships reversed out for navy and in its own colours for light, both
 * transparent. NetEnroll has light artwork only, and the page never asks for
 * it on a dark ground (`useLoginSurface`).
 *
 * `className` sets the width; the height follows the artwork.
 */
export function LoginBrandLogo({
  surface = 'light',
  className,
}: {
  surface?: LoginSurface;
  className?: string;
}): JSX.Element {
  const brand = useLoginBrand();
  if (!brand) {
    return (
      <span className={cn('block', className)}>
        <Logo width={272} className="w-full" />
      </span>
    );
  }
  return <BrandWordmark brand={brand} surface={surface} className={className} />;
}
