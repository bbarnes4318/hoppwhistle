'use client';

/**
 * Project Cortex | Slim Sidebar (The Rail)
 *
 * GEOMETRY:
 * - Width: 220px (slim, fixed)
 * - Height: 100vh (full viewport)
 * - Compact padding to fit all items
 *
 * VISUALS:
 * - Font: JetBrains Mono, small & professional
 * - Active State: Electric Cyan text + Left Border
 * - Flex Column, items left-aligned
 */

import { motion } from 'framer-motion';
import {
  LayoutDashboard,
  Phone,
  Megaphone,
  PhoneCall,
  Receipt,
  Settings,
  Users,
  FileText,
  Shield,
  GitBranch,
  DollarSign,
  AudioLines,
  Bot,
  ClipboardCheck,
  FileSpreadsheet,
  Target,
  BarChart3,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

// ============================================================================
// NAVIGATION — ALL ITEMS RESTORED
// ============================================================================

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Conductor', href: '/bot', icon: Bot },
  { name: 'Comm Link', href: '/phone', icon: Phone },
  { name: 'Endpoints', href: '/numbers', icon: PhoneCall },
  { name: 'Campaigns', href: '/campaigns', icon: Megaphone },
  { name: 'Targets', href: '/targets', icon: Target },
  { name: 'Flow Matrix', href: '/flows', icon: GitBranch },
  { name: 'Calls', href: '/calls', icon: AudioLines },
  { name: 'Call Log', href: '/call-log', icon: FileSpreadsheet },
  { name: 'Retention', href: '/retention', icon: ClipboardCheck },
  { name: 'Reports', href: '/billing', icon: BarChart3 },
  { name: 'Settings', href: '/settings', icon: Settings },
];

const toolsNavigation = [
  { name: 'Audio Analyzer', href: '/tools/recording-analyzer', icon: AudioLines },
];

const adminNavigation = [
  { name: 'Operators', href: '/settings/users', icon: Users },
  { name: 'Webhooks', href: '/settings/webhooks', icon: FileText },
  { name: 'DNC Matrix', href: '/settings/dnc', icon: Shield },
  { name: 'Quotas', href: '/settings/quotas', icon: DollarSign },
];

// ============================================================================
// Navigation Item Component
// ============================================================================

interface NavItemProps {
  item: {
    name: string;
    href: string;
    icon: React.ComponentType<{ className?: string }>;
  };
  isActive: boolean;
}

function NavItem({ item, isActive }: NavItemProps) {
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      className={cn(
        'group relative flex items-center gap-2.5 px-3 py-1.5 transition-all duration-150',
        isActive ? 'text-neon-cyan' : 'text-text-secondary hover:text-text-primary hover:bg-white/5'
      )}
    >
      {/* Active Indicator — 3px Left Border */}
      {isActive && (
        <motion.div
          layoutId="sidebar-active"
          className={cn(
            'absolute left-0 top-0 bottom-0 w-[3px]',
            'bg-neon-cyan',
            'shadow-[0_0_8px_rgba(0,229,255,0.5)]'
          )}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        />
      )}

      {/* Icon */}
      <Icon
        className={cn(
          'h-3.5 w-3.5 shrink-0 transition-colors duration-150',
          isActive ? 'text-neon-cyan' : 'text-current group-hover:text-neon-cyan'
        )}
      />

      {/* Label — JetBrains Mono */}
      <span
        className="font-mono text-[10px] font-medium tracking-wide"
        style={{ fontFamily: "'JetBrains Mono', monospace" }}
      >
        {item.name}
      </span>
    </Link>
  );
}

// ============================================================================
// Section Label Component
// ============================================================================

function SectionLabel({ label }: { label: string }) {
  return (
    <div
      className="px-3 pt-3 pb-1 font-mono text-[9px] font-bold uppercase tracking-widest text-text-muted"
      style={{ fontFamily: "'JetBrains Mono', monospace" }}
    >
      {label}
    </div>
  );
}

// ============================================================================
// Sidebar Component
// ============================================================================

export function Sidebar() {
  const pathname = usePathname();

  return (
    <div
      className={cn(
        'flex flex-col h-screen w-[220px] shrink-0',
        'bg-panel border-r border-white/5'
      )}
    >
      {/* Logo Area — Compact */}
      <div className="flex items-center h-11 px-3 border-b border-white/5 shrink-0">
        <Image
          src="/hopwhistle.png"
          alt="Hopwhistle"
          width={100}
          height={32}
          className="h-5 w-auto"
          priority
        />
      </div>

      {/* Navigation — Scrollable if needed */}
      <nav className="flex-1 overflow-y-auto py-1">
        {/* Main Navigation */}
        {navigation.map(item => {
          const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`);
          return <NavItem key={item.name} item={item} isActive={isActive} />;
        })}

        {/* Tools Section */}
        <SectionLabel label="Tools" />
        {toolsNavigation.map(item => {
          const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`);
          return <NavItem key={item.name} item={item} isActive={isActive} />;
        })}

        {/* Admin Section */}
        <SectionLabel label="Admin" />
        {adminNavigation.map(item => {
          const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`);
          return <NavItem key={item.name} item={item} isActive={isActive} />;
        })}
      </nav>

      {/* Footer — Version */}
      <div className="px-3 py-1.5 border-t border-white/5 shrink-0">
        <p
          className="font-mono text-[8px] text-text-muted uppercase tracking-widest"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          Cortex v2.14
        </p>
      </div>
    </div>
  );
}
