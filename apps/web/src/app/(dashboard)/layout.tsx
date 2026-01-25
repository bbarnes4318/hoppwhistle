'use client';

/**
 * Project Cortex | Dashboard Layout
 *
 * COCKPIT MODE: 100vh Viewport Lock
 * - NO page scrolling
 * - Behaves like a Native Desktop App
 *
 * Command Grid Shell:
 * - Sidebar (collapsible vertical rail) - h-screen
 * - Header (Protocol Status Bar) - fixed height
 * - Main content (overflow-hidden, internal scroll only)
 * - Phone Panel (floating)
 *
 * Role-Based Views:
 * - Operator: Full access (buyers, margins, caps)
 * - Publisher: Restricted (qualified calls, payout only)
 *
 * SAFETY: Outlet/children remains connected to router.
 */

import { Header } from '@/components/layout/header';
import { Sidebar } from '@/components/layout/sidebar';
import { AgentPhonePanel, PhoneProvider } from '@/components/phone';
import { DynamicFavicon } from '@/components/ui/dynamic-favicon';
import { UserProvider } from '@/contexts/UserContext';
import { RoleSwitcher } from '@/components/ui/RoleSwitcher';

export default function DashboardLayout({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <UserProvider>
      <PhoneProvider>
        {/* Dynamic Pulsing Favicon */}
        <DynamicFavicon />

        {/* COCKPIT MODE: h-screen flex, no overflow */}
        <div className="flex h-screen w-screen overflow-hidden bg-void">
          {/* Sidebar - Full Height Rail */}
          <Sidebar />

          {/* Main Content Area - Flex Column */}
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* Header - Fixed Height */}
            <Header />

            {/* Main Content - Internal Scroll Only */}
            <main className="flex-1 overflow-hidden relative">
              {/* SAFETY: children prop connects to router - DO NOT REMOVE */}
              {children}
            </main>

            {/* NO FOOTER - Cockpit Mode */}
          </div>

          {/* Agent Phone Panel - Floating softphone */}
          <AgentPhonePanel />
        </div>

        {/* DEV: Role Switcher - Bottom Left (after sidebar) */}
        <div className="fixed bottom-4 left-[230px] z-50">
          <RoleSwitcher />
        </div>
      </PhoneProvider>
    </UserProvider>
  );
}
