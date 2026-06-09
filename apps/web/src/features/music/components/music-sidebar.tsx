'use client';

import {
  BarChart3,
  LayoutDashboard,
  Megaphone,
  Settings,
  ShieldCheck,
  Users,
  ArrowLeft,
  Map,
  Volume2,
  Smartphone,
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
      { name: 'Customer Demo', href: '/music-console/customer-demo', icon: Smartphone },
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
      <div className="flex flex-col justify-center px-5 py-5 border-b border-white/[0.04] shrink-0 gap-2.5">
        <Link href="/music-console" className="block group">
          <div className="bg-white rounded-lg p-2.5 flex items-center justify-center border border-white/10 shadow-[0_4px_12px_rgba(0,0,0,0.3)] transition-all duration-300 group-hover:shadow-[0_4px_16px_rgba(20,92,255,0.15)]">
            <img src="/rps-logo.png" alt="RPS / Radio Phone Station" className="h-5.5 w-auto object-contain" />
          </div>
          <div className="flex items-center justify-between mt-2.5 px-0.5">
            <span className="text-[9px] font-black tracking-[0.08em] text-[#CBD5E1] uppercase leading-none">
              RPS MEDIA NETWORK
            </span>
            <div className="flex items-center gap-1 px-1.5 py-0.5 bg-[#10b981]/15 border border-[#10b981]/20 rounded text-[8px] font-bold text-[#10b981]">
              <span className="h-1 w-1 rounded-full bg-[#10b981] animate-pulse" />
              <span className="uppercase tracking-wider">LIVE</span>
            </div>
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
          <span className="text-[8px] font-black uppercase tracking-wider text-[#00a3ff] bg-[#00a3ff]/10 px-1.5 py-0.5 rounded border border-[#00a3ff]/20">
            Exit
          </span>
        </Link>
      </div>
    </div>
  );
}
