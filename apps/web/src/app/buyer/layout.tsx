'use client';

import { BarChart3, History, LayoutDashboard, Settings, Target, Wallet } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';

// Buyer Portal Navigation (simplified from main dashboard)
const buyerNavigation = [
  { name: 'Dashboard', href: '/buyer/dashboard', icon: LayoutDashboard },
  {
    name: 'Campaigns',
    href: '/buyer/campaigns',
    icon: Target,
    title: 'Manage your call targets',
  },
  { name: 'Call History', href: '/buyer/calls', icon: History },
  { name: 'Wallet', href: '/buyer/wallet', icon: Wallet },
  { name: 'Settings', href: '/buyer/settings', icon: Settings },
];

function BuyerSidebar() {
  const pathname = usePathname();

  return (
    <div className="flex h-full w-56 flex-col border-r bg-card">
      <div className="flex h-16 items-center border-b px-6">
        <Image
          src="/hopwhistle.png"
          alt="Hopwhistle"
          width={120}
          height={40}
          className="h-8 w-auto"
          priority
        />
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-4">
        {/* Portal Label */}
        <div className="mb-4 px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
          Buyer Portal
        </div>

        {buyerNavigation.map(item => {
          const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.name}
              href={item.href}
              title={(item as any).title}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.name}
            </Link>
          );
        })}
      </nav>

      {/* Footer with support link */}
      <div className="border-t p-4">
        <p className="text-xs text-muted-foreground text-center">
          Need help?{' '}
          <a href="mailto:support@hopwhistle.com" className="text-primary hover:underline">
            Contact Support
          </a>
        </p>
      </div>
    </div>
  );
}

function BuyerHeader() {
  return (
    <header className="flex h-14 items-center justify-between border-b bg-card px-6">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-5 w-5 text-primary" />
        <span className="font-semibold">Buyer Portal</span>
      </div>
      <div className="flex items-center gap-4">
        {/* Future: Add notification bell, user menu */}
        <span className="text-sm text-muted-foreground">Welcome back</span>
      </div>
    </header>
  );
}

export default function BuyerLayout({ children }: { children: React.ReactNode }): JSX.Element {
  const router = useRouter();
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check if user has BUYER role
    const checkAuth = async () => {
      try {
        const response = await fetch('/api/v1/auth/me', {
          credentials: 'include',
        });

        if (!response.ok) {
          router.push('/login');
          return;
        }

        const data = await response.json();
        const roles = data?.data?.roles || [];

        // Allow BUYER role, or ADMIN/OWNER for testing
        if (roles.includes('BUYER') || roles.includes('ADMIN') || roles.includes('OWNER')) {
          setIsAuthorized(true);
        } else {
          // Redirect non-buyers to main dashboard
          router.push('/dashboard');
        }
      } catch (error) {
        console.error('Auth check failed:', error);
        router.push('/login');
      } finally {
        setLoading(false);
      }
    };

    void checkAuth();
  }, [router]);

  // Loading state
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Not authorized - redirect is happening
  if (!isAuthorized) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Redirecting...</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <BuyerSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <BuyerHeader />
        <main className="flex-1 overflow-auto bg-background p-6">
          <div className="h-full overflow-auto">{children}</div>
        </main>
      </div>
    </div>
  );
}
