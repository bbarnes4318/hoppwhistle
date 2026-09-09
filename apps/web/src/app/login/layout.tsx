import type { Metadata } from 'next';

/**
 * The tab, on the one page a person reaches with no session.
 *
 * `page.tsx` is a client component and so cannot export metadata itself. The
 * root layout's template makes this "Sign in · NetEnroll", which is what a
 * browser shows in a restored tab and what a bookmark is named — both worth
 * more than the bare product name on the front door of the domain.
 */
export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to the NetEnroll agent portal for licensed insurance agencies.',
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
