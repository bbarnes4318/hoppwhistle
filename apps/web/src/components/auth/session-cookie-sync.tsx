'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { syncSessionCookie } from '@/lib/session-token';

/**
 * Keeps the server render's view of the session in step with the browser's.
 *
 * Sessions that predate the cookie have a token in localStorage and no cookie,
 * so their first server render would come back signed out. This writes the
 * cookie and refreshes exactly once — after that the sync is a no-op and costs
 * nothing on every subsequent navigation.
 */
export function SessionCookieSync(): null {
  const router = useRouter();

  useEffect(() => {
    if (syncSessionCookie()) router.refresh();
  }, [router]);

  return null;
}
