'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { StaffOnlyGuard } from '@/components/auth/staff-only-guard';

import '@/features/industry-research/ui/foundations/ir.css';

/**
 * Independent Industry Research product shell. Deliberately does NOT render the
 * Hopwhistle sidebar/header/softphone — these routes escape the (dashboard)
 * layout entirely so Industry Research reads as a separate institutional product.
 * The only connection back to the main app is one restrained link.
 *
 * Escaping the (dashboard) layout also escaped its redirects, which is why the
 * guard is mounted here by hand: Industry Research is NetEnroll's own research
 * product and is listed in `lib/staff-only-routes.ts`, but no sidebar filter
 * could have kept an agency principal off a route group that renders no
 * sidebar. `StaffOnlyGuard` wraps everything, header included, so an agency
 * account never sees the wordmark of a product it cannot use.
 */
export default function IndustryResearchLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  const isHistory = pathname === '/tools/industry-research';
  const isNew = pathname.startsWith('/tools/industry-research/new');
  const isMethod = pathname.startsWith('/tools/industry-research/methodology');

  return (
    <StaffOnlyGuard>
      <div data-product="industry-research" data-ir-theme="auto" className="ir-root">
        <header className="ir-header">
          <div className="ir-container" style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
            <Link
              href="/tools/industry-research"
              className="ir-wordmark"
              style={{ textDecoration: 'none' }}
            >
              Industry Research
            </Link>
            <nav className="ir-nav">
              <Link href="/tools/industry-research" data-active={isHistory}>
                Investigations
              </Link>
              <Link href="/tools/industry-research/new" data-active={isNew}>
                New investigation
              </Link>
              <Link href="/tools/industry-research/methodology" data-active={isMethod}>
                Methodology
              </Link>
              <Link href="/dashboard" className="ir-back">
                Back to NetEnroll
              </Link>
            </nav>
          </div>
        </header>
        <main className="ir-container ir-main">{children}</main>
      </div>
    </StaffOnlyGuard>
  );
}
