import type { Metadata } from 'next';

/** Check a PDF against NetEnroll's executed agreements, by its SHA-256. */
export const metadata: Metadata = {
  title: 'Verify an agreement · NetEnroll',
  description: 'Check whether a PDF is an unaltered executed NetEnroll agreement.',
  robots: 'noindex,nofollow',
  referrer: 'no-referrer',
};

export default function VerifyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
