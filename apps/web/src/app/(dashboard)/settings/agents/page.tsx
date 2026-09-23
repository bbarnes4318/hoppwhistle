'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * `/settings/agents` is now part of `/settings/users`.
 *
 * The roster and the account list were two screens listing the same people,
 * and neither answered a whole question -- see the header of
 * `settings/users/page.tsx`. They are one Team Members page now, where an
 * agent's row opens onto the readiness controls that used to live here.
 *
 * This stays as a redirect rather than being deleted, because the path is in
 * bookmarks, in older invitation emails, and in anything anyone wrote down.
 * `replace`, not `push`: a redirected page has no business in the back stack,
 * where it would bounce a person forward again the moment they tried to leave.
 */
export default function AgentsMovedPage(): null {
  const router = useRouter();

  useEffect(() => {
    router.replace('/settings/users');
  }, [router]);

  return null;
}
