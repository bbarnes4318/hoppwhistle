'use client';

import {
  BarChart3,
  Disc3,
  LayoutDashboard,
  Megaphone,
  Settings,
  ShieldCheck,
  Users,
  ArrowLeft,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

interface MusicNavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const musicNav: MusicNavItem[] = [
  { name: 'Dashboard', href: '/music-console', icon: LayoutDashboard },
  { name: 'Fan Campaigns', href: '/music-console/campaigns', icon: Megaphone },
  { name: 'Fan Database', href: '/music-console/fans', icon: Users },
  { name: 'Proof Log', href: '/music-console/proof', icon: ShieldCheck },
  { name: 'Campaign Reports', href: '/music-console/reports', icon: BarChart3 },
  { name: 'Settings', href: '/music-console/settings', icon: Settings },
];

export function MusicSidebar() {
  const pathname = usePathname();

  return (
    <div className="flex h-full w-64 flex-col border-r border-[var(--m-border-2)] m-bg-surface z-20">
      <div className="flex h-16 items-center px-6 border-b border-[var(--m-border-2)]">
        <Link href="/music-console" className="flex items-center gap-2">
          <Disc3 className="h-6 w-6 m-text-accent animate-[spin_4s_linear_infinite]" />
          <span className="text-sm font-bold tracking-[0.2em] m-text-text uppercase">
            Music Console
          </span>
        </Link>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-4">
        {musicNav.map(item => {
          const isExactDashboard = item.href === '/music-console' && pathname === '/music-console';
          const isSubpage = item.href !== '/music-console' && pathname?.startsWith(item.href);
          const isActive = isExactDashboard || isSubpage;
          
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-semibold transition-all duration-200',
                isActive
                  ? 'm-bg-accent-dim m-text-accent border-l-2 border-[var(--m-accent)]'
                  : 'm-text-dim hover:text-[var(--m-text)] hover:bg-[rgba(255,255,255,0.03)]'
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.name}
            </Link>
          );
        })}
      </nav>
      
      <div className="p-4 border-t border-[var(--m-border-2)]">
        <Link
          href="/dashboard"
          className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium m-text-dim hover:text-[var(--m-text)] hover:bg-[rgba(255,255,255,0.03)] transition-all"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Core Platform
        </Link>
      </div>
    </div>
  );
}
