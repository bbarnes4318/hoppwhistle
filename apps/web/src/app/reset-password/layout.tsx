import type { Metadata } from 'next';

/**
 * The page an emailed reset link opens. Like /login it sits outside the
 * (dashboard) group, so no session guard runs on it: the person following the
 * link is by definition not signed in.
 */
export const metadata: Metadata = {
  title: 'Choose a new password',
  description: 'Choose a new password for your NetEnroll account.',
};

export default function ResetPasswordLayout({ children }: { children: React.ReactNode }) {
  return children;
}
