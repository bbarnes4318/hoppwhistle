import * as React from 'react';

import { SessionCookieSync } from '@/components/auth/session-cookie-sync';
import { ThemeScope } from '@/components/domain';

/**
 * The buyer shell.
 *
 * Every page under here renders on the server, so this layout does two things
 * the pages cannot: it opts the whole section into the light theme scope (the
 * dashboard layout still carries the legacy dark class for unconverted routes),
 * and it mounts the one client component that keeps the session cookie in step
 * with localStorage so the server render has a session to read.
 */
export default function BuyerLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeScope theme="light" className="min-h-full">
      <SessionCookieSync />
      <div className="space-y-5 px-3 py-5 sm:px-6">{children}</div>
    </ThemeScope>
  );
}
