'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import '@/features/industry-research/ui/foundations/ir.css';

/**
 * Independent Industry Research product shell. Deliberately does NOT render the
 * Hopwhistle sidebar/header/softphone — these routes escape the (dashboard)
 * layout entirely so Industry Research reads as a separate institutional product.
 * The only connection back to the main app is one restrained link.
 */
export default function IndustryResearchLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  const isHistory = pathname === '/tools/industry-research';
  const isNew = pathname.startsWith('/tools/industry-research/new');
  const isMethod = pathname.startsWith('/tools/industry-research/methodology');

  return (
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
              Back to Hopwhistle
            </Link>
          </nav>
        </div>
      </header>
      <main className="ir-container" style={{ paddingTop: 20, paddingBottom: 64 }}>
        {children}
      </main>
    </div>
  );
}
