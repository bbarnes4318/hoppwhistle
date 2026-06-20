'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { Header } from '@/components/layout/header';
import { Sidebar } from '@/components/layout/sidebar';
import { AgentPhonePanel, GlobalDispositionModal, PhoneProvider } from '@/components/phone';
import { useAuth } from '@/hooks/use-auth';

export default function DashboardLayout({ children }: { children: React.ReactNode }): JSX.Element {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isPublisherOnly, isBuyerOnly, isAgentOnly, loading: authLoading } = useAuth();

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      router.replace('/login');
      return;
    }

    const path = pathname || '';

    if (isPublisherOnly && !path.startsWith('/publisher')) {
      router.replace('/publisher/dashboard');
    } else if (isBuyerOnly && !path.startsWith('/buyer')) {
      router.replace('/buyer/dashboard');
    } else if (isAgentOnly && !path.startsWith('/call-center') && !path.startsWith('/calls/my') && !path.startsWith('/contacts') && !path.startsWith('/payroll')) {
      router.replace('/call-center');
    }
  }, [user, isPublisherOnly, isBuyerOnly, isAgentOnly, authLoading, pathname, router]);

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

 const isCampaignMapPage = pathname?.includes('/tools/campaign-map');

 // Standard dashboard layout with proper scrolling
 return (
 <PhoneProvider>
 <div className="flex h-screen overflow-hidden bg-background text-foreground">
 <Sidebar />
 <div className="flex flex-1 flex-col h-screen overflow-hidden">
 <Header />
 <main className="flex-1 bg-background flex flex-col min-h-0 overflow-hidden">
 {children}
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

