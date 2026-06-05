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
  Map,
  Volume2,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

interface MusicNavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface SidebarSection {
  title: string;
  items: MusicNavItem[];
}

const sidebarSections: SidebarSection[] = [
  {
    title: 'Operations',
    items: [
      { name: 'Dashboard', href: '/music-console', icon: LayoutDashboard },
      { name: 'Fan Campaigns', href: '/music-console/campaigns', icon: Megaphone },
      { name: 'Campaign Map', href: '/music-console/map', icon: Map },
      { name: 'AI Voice', href: '/music-console/voice', icon: Volume2 },
    ],
  },
  {
    title: 'Intelligence & Proof',
    items: [
      { name: 'Fan Database', href: '/music-console/fans', icon: Users },
      { name: 'Proof Log', href: '/music-console/proof', icon: ShieldCheck },
    ],
  },
  {
    title: 'Management',
    items: [
      { name: 'Campaign Reports', href: '/music-console/reports', icon: BarChart3 },
      { name: 'Settings', href: '/music-console/settings', icon: Settings },
    ],
  },
];

export function MusicSidebar() {
  const pathname = usePathname();

  return (
    <div className="m-sidebar flex h-full w-64 flex-col z-20 animate-fadeIn">
      {/* Brand Logo area */}
      <div className="flex h-14 lg:h-16 items-center px-6 border-b border-white/[0.04] shrink-0">
        <Link href="/music-console" className="flex items-center gap-3 group">
          <div className="relative p-1.5 bg-gradient-to-br from-[#8B5CF6]/20 to-[#6D28D9]/10 rounded-lg border border-[#8B5CF6]/30 shadow-[0_0_12px_rgba(139,92,246,0.1)] transition-all duration-300 group-hover:border-[#8B5CF6]/50">
            <Disc3 className="h-4.5 w-4.5 text-[#A78BFA] animate-[spin_10s_linear_infinite]" />
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-black tracking-[0.18em] text-[#FFFFFF] uppercase leading-none">
              HOPWHISTLE
            </span>
            <span className="text-[9px] font-extrabold text-[#A78BFA] uppercase tracking-[0.15em] mt-1 leading-none">
              MUSIC CONSOLE
            </span>
          </div>
        </Link>
      </div>

      {/* Navigation menu */}
      <nav className="flex-1 overflow-y-auto p-3 space-y-4">
        {sidebarSections.map(section => (
          <div key={section.title} className="space-y-1">
            <div className="m-sidebar-section-title">{section.title}</div>
            {section.items.map(item => {
              const isExactDashboard = item.href === '/music-console' && pathname === '/music-console';
              const isSubpage = item.href !== '/music-console' && pathname?.startsWith(item.href);
              const isActive = isExactDashboard || isSubpage;

              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={cn(
                    'm-sidebar-link',
                    isActive && 'm-sidebar-link--active'
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  <span>{item.name}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Back to Core Platform link */}
      <div className="p-4 border-t border-white/[0.04]">
        <Link
          href="/dashboard"
          className="flex items-center gap-3 rounded-lg px-3.5 py-2.5 text-xs font-semibold text-[#7A8B9E] hover:text-white bg-white/[0.01] border border-white/[0.03] hover:bg-white/[0.03] transition-all group"
        >
          <ArrowLeft className="h-3.5 w-3.5 text-[#4A586B] group-hover:text-white transition-colors" />
          <span className="flex-1">Core Platform</span>
          <span className="text-[8px] font-black uppercase tracking-wider text-[#A78BFA] bg-[#8B5CF6]/10 px-1.5 py-0.5 rounded border border-[#8B5CF6]/20">
            Exit
          </span>
        </Link>
      </div>
    </div>
  );
}
