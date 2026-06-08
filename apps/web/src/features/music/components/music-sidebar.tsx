'use client';

import {
  BarChart3,
  Radio,
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
      { name: 'RPS Voice', href: '/music-console/voice', icon: Volume2 },
    ],
  },
  {
    title: 'Intelligence & Proof',
    items: [
      { name: 'Fan Database', href: '/music-console/fans', icon: Users },
      { name: 'Voice Proof', href: '/music-console/proof', icon: ShieldCheck },
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
      <div className="flex flex-col justify-center px-6 py-4 border-b border-white/[0.04] shrink-0 gap-2">
        <Link href="/music-console" className="flex items-center gap-3 group">
          <div className="relative p-1.5 bg-gradient-to-br from-[#00a3ff]/20 to-[#00d2ff]/10 rounded-lg border border-[#00a3ff]/30 shadow-[0_0_12px_rgba(0,163,255,0.15)] transition-all duration-300 group-hover:border-[#00a3ff]/50">
            <Radio className="h-4.5 w-4.5 text-[#00a3ff] animate-pulse" />
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] font-black tracking-[0.12em] text-[#FFFFFF] uppercase leading-none">
              RADIO PHONE STATION
            </span>
            <span className="text-[8px] font-extrabold text-[#00a3ff] uppercase tracking-[0.12em] mt-1.5 leading-none">
              RPS MEDIA NETWORK
            </span>
          </div>
        </Link>
        <div className="flex items-center gap-1.5 px-2 py-0.5 w-fit bg-[#10b981]/10 border border-[#10b981]/20 rounded text-[8px] font-bold text-[#10b981]">
          <span className="h-1 w-1 rounded-full bg-[#10b981] animate-pulse" />
          <span className="uppercase tracking-wider">LIVE STATION NETWORK</span>
        </div>
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
          <span className="text-[8px] font-black uppercase tracking-wider text-[#00a3ff] bg-[#00a3ff]/10 px-1.5 py-0.5 rounded border border-[#00a3ff]/20">
            Exit
          </span>
        </Link>
      </div>
    </div>
  );
}
