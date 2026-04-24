'use client';

import {
  BarChart3,
  Disc3,
  LayoutDashboard,
  Megaphone,
  Settings,
  ShieldCheck,
  Users,
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

export function MusicConsoleNav() {
  const pathname = usePathname();

  return (
    <div className="flex items-center gap-1 border-b border-[var(--m-border-2)] m-bg-surface px-4 py-2 relative z-20">
      <div className="flex items-center gap-2 mr-6 pl-2">
        <Disc3 className="h-5 w-5 m-text-accent animate-[spin_4s_linear_infinite]" />
        <span className="text-[11px] font-bold tracking-[0.2em] m-text-text uppercase">
          Music Console
        </span>
      </div>
      <nav className="flex items-center gap-1">
        {musicNav.map(item => {
          const isExactDashboard = item.href === '/music-console' && pathname === '/music-console';
          const isSubpage = item.href !== '/music-console' && pathname?.startsWith(item.href);
          const isActive = isExactDashboard || isSubpage;
          
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex items-center gap-2 rounded px-3 py-1.5 text-xs font-semibold transition-all duration-200',
                isActive
                  ? 'm-bg-accent-dim m-text-accent shadow-[inset_0_-2px_0_0_var(--m-accent)]'
                  : 'm-text-dim hover:text-[var(--m-text)] hover:bg-[rgba(255,255,255,0.03)]'
              )}
            >
              <item.icon className="h-3.5 w-3.5" />
              {item.name}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
