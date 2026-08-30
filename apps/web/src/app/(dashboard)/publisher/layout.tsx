import * as React from 'react';

import { SessionCookieSync } from '@/components/auth/session-cookie-sync';
import { requirePublisherScope } from '@/lib/server/session';

/**
 * The publisher shell, and the access control for everything under it.
 *
 * The pages below are client components that fetch in effects, so none of them
 * can gate themselves on the server the way the buyer pages do. Putting the
 * check in the layout covers all of them at once: a buyer who types
 * /publisher/dashboard is redirected on the server, before any publisher markup
 * or data reaches the browser.
 *
 * SessionCookieSync is mounted for the same reason the buyer layout mounts it:
 * the guard reads the mirrored session cookie, and a session predating that
 * cookie needs it written once.
 */
export default async function PublisherLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<JSX.Element> {
  await requirePublisherScope();

  return (
    <>
      <SessionCookieSync />
      {children}
    </>
  );
}
