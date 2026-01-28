'use client';

import { usePathname } from 'next/navigation';

import { Header } from '@/components/layout/header';
import { Sidebar } from '@/components/layout/sidebar';
import { AgentPhonePanel, PhoneProvider } from '@/components/phone';
import { cn } from '@/lib/utils';

export default function DashboardLayout({ children }: { children: React.ReactNode }): JSX.Element {
  const pathname = usePathname();

  // Check if we're on the call center page (fullscreen mode)
  const isCallCenterPage = pathname?.startsWith('/call-center');

  // Hide floating dialer on call center page (integrated dialer there)
  const showFloatingDialer = !isCallCenterPage;

  // Fullscreen mode for call center: hide sidebar, header; viewport locked
  if (isCallCenterPage) {
    return (
      <PhoneProvider>
        <div className="h-screen w-screen overflow-hidden bg-background">
          {/* Full viewport lock - no scrollbars */}
          {children}
        </div>
      </PhoneProvider>
    );
  }

  // Standard dashboard layout (footer removed, legal links moved to settings)
  return (
    <PhoneProvider>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Header />
          <main className="flex-1 overflow-auto bg-background p-6">
            <div className="h-full overflow-auto">{children}</div>
          </main>
          {/* Footer removed - legal links accessible via Settings page */}
        </div>

        {/* Agent Phone Panel - Floating softphone (hidden on call center page) */}
        {showFloatingDialer && <AgentPhonePanel />}
      </div>
    </PhoneProvider>
  );
}
