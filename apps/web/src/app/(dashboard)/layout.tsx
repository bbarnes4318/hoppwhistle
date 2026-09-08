'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { ThemeScope } from '@/components/domain/theme-scope';
import { ErrorBoundary } from '@/components/error-boundary';
import { LiveStripMount } from '@/components/layout/live-strip-mount';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import { AgentPhonePanel, GlobalDispositionModal, PhoneProvider } from '@/components/phone';
import { CrossAgencyPrompt } from '@/components/platform/cross-agency-prompt';
import { useAuth } from '@/hooks/use-auth';
import { usePlatformContext } from '@/hooks/use-platform-context';
import { getRedirectPath } from '@/lib/roles';

export default function DashboardLayout({ children }: { children: React.ReactNode }): JSX.Element {
  const pathname = usePathname();
  const router = useRouter();
  const {
    user,
    userRoles,
    isPublisherOnly,
    isBuyerOnly,
    isAgentOnly,
    loading: authLoading,
  } = useAuth();


  /*
   * NetEnroll staff, and the agency they are inside.
   *
   * A platform admin with no agency selected used to be sent to /login by the
   * API client, because every agency-scoped route answered 401 and the client
   * read that as a dead session. The API now distinguishes the two conditions;
   * this is the other half — the operator lands on the cross-agency view with a
   * prompt to pick an agency instead of on a page that cannot load.
   */
  const platform = usePlatformContext();

  /*
   * Who gets a softphone.
   *
   * The provider wraps this whole layout, so before this gate existed it
   * initialised SIP for everybody who loaded the dashboard -- platform
   * operators in the cross-agency view, buyers, publishers. Each one fetched
   * agent credentials, was refused, and handed the failure to a watchdog that
   * re-initialised forever. The production console showed that cycle running
   * for a platform admin who has never had an extension.
   *
   * Two conditions, and both are needed. The role, because only an agent takes
   * calls. And an agency, because a platform operator in the cross-agency view
   * has no tenant for an extension to belong to -- entering one reloads the
   * page, so the phone comes up then.
   */
  const canTakeCalls =
    !authLoading && userRoles.includes('AGENT') && !platform.needsAgency;


  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      router.replace('/login');
      return;
    }

    // A platform operator holds no agency roles in the cross-agency view, so
    // the role-based redirects below have nothing to say about them. Leaving
    // them to fall through would send them to an agency home page that cannot
    // load.
    if (platform.isPlatformAdmin) return;

    const path = pathname || '';
    const home = getRedirectPath(userRoles);

    // A section user is sent home unless the page they are on is a section they
    // are entitled to. This is deliberately one decision rather than a branch
    // per role: `isBuyerOnly` and `isPublisherOnly` both mean "holds the role
    // and is not staff", so a user holding BUYER *and* PUBLISHER satisfied both
    // of the old branches -- /publisher bounced them to /buyer, /buyer bounced
    // them straight back, and the pair looped until the tab was closed.
    if (isPublisherOnly || isBuyerOnly) {
      const inAllowedSection =
        (isPublisherOnly && path.startsWith('/publisher')) ||
        (isBuyerOnly && path.startsWith('/buyer'));

      if (!inAllowedSection && path !== home) {
        router.replace(home);
      }
    } else if (
      isAgentOnly &&
      (path.startsWith('/music-console') ||
        path.startsWith('/voice-agents') ||
        path.startsWith('/flows') ||
        path.startsWith('/buyer') ||
        path.startsWith('/publisher'))
    ) {
      router.replace('/dashboard');
    }
  }, [
    user,
    userRoles,
    isPublisherOnly,
    isBuyerOnly,
    isAgentOnly,
    authLoading,
    pathname,
    router,
    platform.isPlatformAdmin,
  ]);

  /*
   * Which pages an operator can use without having entered an agency.
   *
   * ── The prompt is the exception now, not the entry point ──────────────────
   *
   * Phase 2 swapped every page under this layout for "Choose an agency" when a
   * platform admin had no acting tenant. That was backwards for the pages
   * NetEnroll staff actually run the platform from: they run the whole thing,
   * and drilling into one agency is the exception. So `/delivery`, `/rating`
   * and `/delivery/settlements` each render a PLATFORM-WIDE counterpart in that
   * state -- every agency's rows, with totals -- and entering an agency narrows
   * the same page to it. The switcher is a filter, not a gate.
   *
   * The rest of the surface still gets the prompt, because there genuinely is
   * no cross-agency reading of it: see docs/PLATFORM_ADMIN.md §2f, which names
   * each one and why.
   *
   * `/delivery` is matched exactly rather than by prefix. `/delivery/me` is one
   * agent's own numbers and has no platform-wide meaning at all, so it keeps
   * the prompt -- a prefix here would have quietly included it.
   */
  const PLATFORM_WIDE_PREFIXES = [
    '/settings',
    '/admin',
    '/rating',
    '/delivery/settlements',
  ];

  const path = pathname || '';
  const worksWithoutAgency =
    PLATFORM_WIDE_PREFIXES.some(prefix => path.startsWith(prefix)) || path === '/delivery';

  const needsAgency = platform.needsAgency && !worksWithoutAgency;

  // Check if we're on the call center page (fullscreen mode)
  const isCallCenterPage = pathname?.startsWith('/call-center');

  // Hide floating dialer on call center page (integrated dialer there)
  const showFloatingDialer = !isCallCenterPage;

  // Fullscreen mode for call center: hide sidebar, header; viewport locked
  if (isCallCenterPage) {
    return (
      // Same gate. The call centre is where an agent works, but a platform
      // operator can open the page too, and they should not start a phone.
      <PhoneProvider enabled={canTakeCalls}>
        <div className="h-screen w-screen overflow-hidden bg-background text-foreground">
          {/*
            The cross-agency prompt applies here too.

            This branch returns before the one below, so it used to skip the
            `needsAgency` swap entirely: a platform operator with no agency
            selected got the live call centre, which then asked for one
            agency's queue, calls and metrics and was refused 409 on every one.
            Phase 2 required a landing prompt rather than a broken page, and
            "every page" has to include the one that returns early.

            Wrapped in the boundary for the same reason as the main branch: a
            fullscreen page that throws would otherwise take the whole app with
            it, with no chrome left to navigate away from.
          */}
          <ErrorBoundary label="This page" resetKey={pathname ?? ''}>
            {needsAgency ? <CrossAgencyPrompt /> : children}
          </ErrorBoundary>
        </div>
      </PhoneProvider>
    );
  }

  // Standard dashboard layout with proper scrolling
  return (
    <PhoneProvider enabled={canTakeCalls}>
      <div className="flex h-screen overflow-hidden bg-background text-foreground">
        {/*
   THE SHELL IS LIGHT; PAGE BODIES ARE NOT, YET.

   The brief makes light the default, but 22 routes under this layout still
   hardcode dark utilities (text-white, bg-slate-900, border-white/10) — 138
   occurrences in /calls alone. Flipping <html class="dark"> off now would
   render half the app unreadable, and this task converts the layout only.

   So the new chrome opts into light through the same data-theme scope the
   admin live board will use for dark, and everything inside <main> keeps
   inheriting the document's dark tokens until its page is rebuilt. Prompts
   4-6 wrap each converted page in <ThemeScope theme="light">; once none are
   left, the class comes off <html> and both scopes are deleted.
 */}
        {/* The rail is 208px wide and does not shrink, so below md it is
            replaced by MobileNav's drawer in the topbar. */}
        <ThemeScope theme="light" className="hidden h-full shrink-0 bg-transparent md:flex">
          <Sidebar />
        </ThemeScope>
        <div className="flex flex-1 flex-col h-screen overflow-hidden">
          <ThemeScope theme="light" className="shrink-0 bg-transparent">
            <Topbar />
            {/* Signature 2 — below the topbar, above the page, on every screen. */}
            <LiveStripMount />
          </ThemeScope>
          <main className="flex-1 bg-background flex flex-col min-h-0 overflow-y-auto">
            {/*
              A page that throws loses the page, not the shell. Before this, an
              uncaught render error anywhere under the layout unmounted the
              whole tree from the root: the sidebar, the topbar and the agency
              switcher went with it, and the operator's only route out of a
              blank "Application error" screen was to know a URL by heart.

              Keyed on the pathname, so navigating away from a broken page
              clears the boundary rather than leaving somebody stuck on the
              message.
            */}
            <ErrorBoundary label="This page" resetKey={pathname}>
              {needsAgency ? <CrossAgencyPrompt /> : children}
            </ErrorBoundary>
          </main>
          {/* Footer removed - legal links accessible via Settings page */}
        </div>

        {/* Agent Phone Panel - Floating softphone (hidden on call center page) */}
        {showFloatingDialer && <AgentPhonePanel />}

        {/* Global Disposition Modal - triggers when softphone call ends outside call center */}
        <GlobalDispositionModal />
      </div>
    </PhoneProvider>
  );
}
