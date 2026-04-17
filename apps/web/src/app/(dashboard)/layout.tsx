'use client';

import { usePathname } from 'next/navigation';

import { Header } from '@/components/layout/header';
import { Sidebar } from '@/components/layout/sidebar';
import { AgentPhonePanel, PhoneProvider } from '@/components/phone';

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
 <Sidebar />
 <div className="flex flex-1 flex-col h-screen overflow-hidden">
 <Header />
 <main className="flex-1 overflow-y-auto bg-background p-6 pb-20">{children}</main>
 {/* Footer removed - legal links accessible via Settings page */}
 </div>

 {/* Agent Phone Panel - Floating softphone (hidden on call center page) */}
 {showFloatingDialer && <AgentPhonePanel />}
 </div>
 </PhoneProvider>
 );
}

