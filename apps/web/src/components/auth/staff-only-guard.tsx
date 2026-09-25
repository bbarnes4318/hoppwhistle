'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { usePlatformContext } from '@/hooks/use-platform-context';
import { isRouteBlockedFor, isStaffOnlyRoute } from '@/lib/staff-only-routes';

/**
 * The same removal as `app/(dashboard)/layout.tsx`, for the shells that escape it.
 *
 * ── Why a second mount point exists at all ───────────────────────────────────
 *
 * Two of NetEnroll's own products are mounted OUTSIDE the `(dashboard)` route
 * group, each with a layout of its own: Industry Research renders its own
 * header and theme under `(research)`, and the Music Console renders a whole
 * separate shell under `/music-console`. Neither passes through the dashboard
 * layout, so neither saw the redirect that took the rest of the staff-only
 * screens away from an agency principal -- and they were the two entries most
 * exposed by the removal, because they are the two with no sidebar to have been
 * removed from.
 *
 * ── It asks the list, not the mount point ────────────────────────────────────
 *
 * The obvious shape for this component is "you are not staff, go home", and it
 * would be wrong. A guard that decides on the strength of being mounted holds
 * an opinion of its own, and the opinion silently outlives the list: take
 * `/music-console` out of `STAFF_ONLY_ROUTES` and the sidebar offers the link
 * while this turns everyone away from it.
 *
 * So it reads `isStaffOnlyRoute(usePathname())`. On a route the list does not
 * claim it renders children and gets out of the way, which means the nav and
 * the guard cannot disagree in either direction, and mounting it somewhere it
 * is not needed costs nothing.
 *
 * ── `isPlatformAdmin`, and role preview ──────────────────────────────────────
 *
 * `useAuth().isPlatformAdmin` is true for staff and STAYS true while an
 * operator previews an agency as one of its roles -- the preview replaces their
 * role list, not the capability. So a previewing operator still reaches these
 * pages, which matches the dashboard layout, where the same capability returns
 * before the role dispatch runs. A preview is for looking at an agency, and a
 * redirect out of one is one more way to be stuck somewhere it cannot be left.
 *
 * ── Nothing renders until both answers are in ────────────────────────────────
 *
 * `authLoading` and `platform.loading` are separate requests and
 * `isPlatformAdmin` reads both. Rendering the shell on the strength of the
 * first would mount Industry Research or the Music Console for an agency owner
 * for as long as the second took -- the page being taken away rather than never
 * shown, and on the Music Console that means a sidebar, a live status poll and
 * a map tile fetch first.
 *
 * Advisory, like every guard in the browser. The endpoints behind these two
 * products decide what they serve; this decides what is offered.
 */
export function StaffOnlyGuard({ children }: { children: React.ReactNode }): JSX.Element | null {
  const {
    isPlatformAdmin,
    isWhiteLabel,
    status,
    loading: authLoading,
    defaultDashboardPath,
  } = useAuth();
  const platform = usePlatformContext();
  const pathname = usePathname();
  const router = useRouter();

  const guarded = isStaffOnlyRoute(pathname);
  const settling = authLoading || platform.loading;
  // The same decision the dashboard layout makes, so the two cannot disagree
  // about who may open a staff-only path -- a white-label owner included.
  const blocked = isRouteBlockedFor(pathname, { isPlatformAdmin, isWhiteLabel });
  const turnAway = guarded && !settling && blocked;

  useEffect(() => {
    if (!guarded || settling) return;

    // A credential the server actually rejected, and not a request that merely
    // failed -- the same distinction the dashboard layout draws, for the same
    // reason: a 429 is not a signed-out session.
    if (status === 'anonymous') {
      router.replace('/login');
      return;
    }

    if (blocked) router.replace(defaultDashboardPath);
  }, [guarded, settling, status, blocked, router, defaultDashboardPath]);

  if (!guarded) return <>{children}</>;

  // Quiet on purpose. These shells are full-screen, and a spinner here would be
  // a flash of one product before another on every load.
  if (settling) return <div aria-busy="true" aria-live="polite" />;

  if (turnAway) return null;

  return <>{children}</>;
}
