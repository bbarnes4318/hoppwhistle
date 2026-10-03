import type { Metadata } from 'next';

/**
 * The page an emailed signing link opens. Outside the (dashboard) group, so no
 * session guard runs: the signer has no account. NetEnroll-branded whatever
 * host it is opened on, never indexed, and sent with no referrer because the
 * token is in the path (next.config.js sets the header).
 */
export const metadata: Metadata = {
  title: 'Review and sign · NetEnroll',
  description: 'Review and electronically sign your agreements with PVN LLC d/b/a NetEnroll.',
  robots: 'noindex,nofollow',
  referrer: 'no-referrer',
};

export default function SignLayout({ children }: { children: React.ReactNode }) {
  return children;
}
