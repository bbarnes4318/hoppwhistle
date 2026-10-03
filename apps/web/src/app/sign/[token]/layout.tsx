import type { Metadata } from 'next';

/**
 * The page an emailed signing link opens. Outside the (dashboard) group, so no
 * session guard runs: the signer has no account. Drawn in the ISSUER's brand (from the
 * envelope, never the host), never indexed, and sent with no referrer because the
 * token is in the path (next.config.js sets the header).
 */
export const metadata: Metadata = {
  title: 'Review and sign your agreements',
  description: 'Review and electronically sign your agreements.',
  robots: 'noindex,nofollow',
  referrer: 'no-referrer',
};

export default function SignLayout({ children }: { children: React.ReactNode }) {
  return children;
}
