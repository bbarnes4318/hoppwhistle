import type { Metadata } from 'next';

/**
 * The client's download page for executed agreements, from the completion
 * email. No session; never indexed; no referrer (the token is in the path).
 */
export const metadata: Metadata = {
  title: 'Your executed agreements · NetEnroll',
  description: 'Download your executed agreements with PVN LLC d/b/a NetEnroll.',
  robots: 'noindex,nofollow',
  referrer: 'no-referrer',
};

export default function AgreementDownloadLayout({ children }: { children: React.ReactNode }) {
  return children;
}
