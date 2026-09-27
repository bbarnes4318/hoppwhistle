import type { Metadata } from 'next';

import { LoginBrandProvider } from '@/components/brand/login-brand';
import { resolveBrand } from '@/lib/brand-themes';
import { DEFAULT_PRODUCT_NAME, serverBrandForRequest } from '@/lib/server/public-brand';

/**
 * The tab, on the one page a person reaches with no session.
 *
 * `page.tsx` is a client component and so cannot export metadata itself. The
 * root layout's template makes this "Sign in · NetEnroll" -- or "Sign in ·
 * <agency>" on a white-label agency's own domain -- which is what a browser
 * shows in a restored tab and what a bookmark is named: both worth more than
 * the bare product name on the front door of the domain.
 */
export async function generateMetadata(): Promise<Metadata> {
  const name = resolveBrand(await serverBrandForRequest())?.name ?? DEFAULT_PRODUCT_NAME;
  return {
    title: 'Sign in',
    description: `Sign in to the ${name} agent portal for licensed insurance agencies.`,
  };
}

/**
 * The brand is resolved here, on the server, from the request's host, and
 * handed to the page: see components/brand/login-brand.tsx.
 */
export default async function LoginLayout({ children }: { children: React.ReactNode }) {
  const brand = await serverBrandForRequest();
  return <LoginBrandProvider brand={brand}>{children}</LoginBrandProvider>;
}
