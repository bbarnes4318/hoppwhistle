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
  { name: 'Campaign Analytics', href: '/music-console/reports', icon: BarChart3 },
  { name: 'Settings', href: '/music-console/settings', icon: Settings },
];

export function MusicConsoleNav() {
  const pathname = usePathname();

  return (
    <div className="flex items-center gap-1 border-b border-violet-500/20 bg-gradient-to-r from-violet-950/40 via-fuchsia-950/20 to-transparent px-2 py-1">
      <div className="flex items-center gap-2 mr-4 pl-2">
        <Disc3 className="h-5 w-5 text-violet-400 animate-[spin_3s_linear_infinite]" />
        <span className="text-sm font-bold tracking-wide bg-gradient-to-r from-violet-300 to-fuchsia-400 bg-clip-text text-transparent">
          MUSIC CONSOLE
        </span>
      </div>
      <nav className="flex items-center gap-0.5">
        {musicNav.map(item => {
          const isActive =
            pathname === item.href ||
            (item.href !== '/music-console' && pathname?.startsWith(item.href));
          const isExactDashboard =
            item.href === '/music-console' && pathname === '/music-console';
          const active = isActive || isExactDashboard;
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-200',
                active
                  ? 'bg-violet-500/20 text-violet-300 shadow-[inset_0_-2px_0_0_theme(colors.violet.500)]'
                  : 'text-zinc-400 hover:text-violet-300 hover:bg-violet-500/10'
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
