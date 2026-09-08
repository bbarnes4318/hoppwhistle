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
   * Everything under this layout renders one agency's data, with two
   * exceptions: /settings is about the signed-in person, and /admin is the
   * platform console. Anything else gets the prompt rather than an empty table
   * or a spinner that never resolves.
   */
  const worksWithoutAgency =
    (pathname || '').startsWith('/settings') || (pathname || '').startsWith('/admin');

  const needsAgency = platform.needsAgency && !worksWithoutAgency;

  // Check if we're on the call center page (fullscreen mode)
  const isCallCenterPage = pathname?.startsWith('/call-center');

  // Hide floating dialer on call center page (integrated dialer there)
  const showFloatingDialer = !isCallCenterPage;

  // Fullscreen mode for call center: hide sidebar, header; viewport locked
  if (isCallCenterPage) {
    return (
      <PhoneProvider>
        <div className="h-screen w-screen overflow-hidden bg-background text-foreground">
          {/* Full viewport lock - no scrollbars */}
          {children}
        </div>
      </PhoneProvider>
    );
  }

  // Standard dashboard layout with proper scrolling
  return (
    <PhoneProvider>
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
