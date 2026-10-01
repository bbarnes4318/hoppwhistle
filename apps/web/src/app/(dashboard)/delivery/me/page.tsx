'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * `/delivery/me` ("My day") is now the agent's Today, at `/dashboard`.
 *
 * My day was an agent's calls, applications and closing against the agency --
 * the right numbers in the wrong place: a second personal dashboard beside the
 * Today every other role lands on. Those figures, the seven-day trend and the
 * "nothing recorded is a dash" rules all moved into `components/agent/today.tsx`,
 * served by `GET /api/v1/agent/today`, which reuses the service behind
 * `GET /api/v1/delivery/me` (still served: the Power Dialer's figures read it).
 *
 * The path stays as a redirect for bookmarks and old links, as
 * `/settings/agents` does. `replace`, not `push`, so the back button does not
 * bounce anybody forward again.
 */
export default function MyDayMovedPage(): null {
  const router = useRouter();

  useEffect(() => {
    router.replace('/dashboard');
  }, [router]);

  return null;
}
