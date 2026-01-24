'use client';

/**
 * Project Cortex | Dashboard Layout
 *
 * Command Grid Shell:
 * - Sidebar (collapsible vertical rail)
 * - Header (Protocol Status Bar)
 * - Main content (Command Grid)
 * - Phone Panel (floating)
 *
 * SAFETY: Outlet/children remains connected to router.
 */

import { Footer } from '@/components/layout/footer';
import { Header } from '@/components/layout/header';
import { Sidebar } from '@/components/layout/sidebar';
import { AgentPhonePanel, PhoneProvider } from '@/components/phone';

export default function DashboardLayout({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <PhoneProvider>
      <div className="flex h-screen overflow-hidden bg-surface-dark">
        {/* Sidebar - Collapsible Vertical Rail */}
        <Sidebar />

        {/* Main Content Area */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Header - Protocol Status Bar */}
          <Header />

          {/* Main Content - Command Grid Container */}
          <main className="flex-1 overflow-auto bg-surface-dark p-6">
            <div className="h-full overflow-auto">
              {/* SAFETY: children prop connects to router - DO NOT REMOVE */}
              {children}
            </div>
          </main>

          {/* Footer */}
          <Footer />
        </div>

        {/* Agent Phone Panel - Floating softphone */}
        <AgentPhonePanel />
      </div>
    </PhoneProvider>
  );
}
