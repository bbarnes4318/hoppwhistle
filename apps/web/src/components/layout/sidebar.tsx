'use client';

/**
 * Project Cortex | Command Grid Sidebar
 *
 * Collapsible vertical rail in Carbon Obsidian.
 * Icons: stroke-based outlines that fill with Iridescent Gradient on hover.
 */

import { motion, AnimatePresence } from 'framer-motion';
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
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

import { cn } from '@/lib/utils';

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  {
    name: 'Conductor',
    href: '/bot',
    icon: Bot,
    title: 'Outbound calling & live transfer orchestration',
  },
  { name: 'Phone', href: '/phone', icon: Phone },
  { name: 'Numbers', href: '/numbers', icon: PhoneCall },
  { name: 'Campaigns', href: '/campaigns', icon: Megaphone },
  { name: 'Flows', href: '/flows', icon: GitBranch },
  { name: 'Calls', href: '/calls', icon: AudioLines },
  {
    name: 'Retention',
    href: '/retention',
    icon: ClipboardCheck,
    title: 'Policy onboarding & retention queue',
  },
  { name: 'Billing', href: '/billing', icon: Receipt },
  { name: 'Settings', href: '/settings', icon: Settings },
];

const toolsNavigation = [
  { name: 'Recording Analyzer', href: '/tools/recording-analyzer', icon: AudioLines },
];

const adminNavigation = [
  { name: 'Users', href: '/settings/users', icon: Users },
  { name: 'Webhooks', href: '/settings/webhooks', icon: FileText },
  { name: 'DNC Lists', href: '/settings/dnc', icon: Shield },
  { name: 'Quotas & Budgets', href: '/settings/quotas', icon: DollarSign },
];

interface NavItemProps {
  item: {
    name: string;
    href: string;
    icon: React.ComponentType<{ className?: string }>;
    title?: string;
  };
  isActive: boolean;
  isCollapsed: boolean;
}

function NavItem({ item, isActive, isCollapsed }: NavItemProps) {
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      title={item.title || item.name}
      className={cn(
        'group relative flex items-center gap-3 rounded-lg transition-all duration-200',
        isCollapsed ? 'justify-center p-3' : 'px-3 py-2',
        isActive
          ? 'bg-brand-cyan/10 text-brand-cyan'
          : 'text-text-secondary hover:text-text-primary'
      )}
    >
      {/* Icon with gradient fill on hover */}
      <div className="relative">
        <Icon
          className={cn(
            'h-5 w-5 transition-all duration-200',
            isActive ? 'stroke-brand-cyan' : 'stroke-current group-hover:stroke-brand-cyan'
          )}
        />
      </div>

      {/* Label (hidden when collapsed) */}
      <AnimatePresence>
        {!isCollapsed && (
          <motion.span
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 'auto' }}
            exit={{ opacity: 0, width: 0 }}
            className="text-sm font-medium whitespace-nowrap overflow-hidden"
          >
            {item.name}
          </motion.span>
        )}
      </AnimatePresence>

      {/* Active indicator */}
      {isActive && (
        <motion.div
          layoutId="sidebar-active"
          className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-brand-cyan rounded-r"
        />
      )}
    </Link>
  );
}

function SectionLabel({ label, isCollapsed }: { label: string; isCollapsed: boolean }) {
  if (isCollapsed) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="px-3 py-2 text-xs font-semibold uppercase tracking-widest text-text-muted"
    >
      {label}
    </motion.div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <motion.div
      className={cn('flex h-full flex-col border-r border-grid-line', 'bg-surface-panel')}
      initial={false}
      animate={{ width: isCollapsed ? 72 : 256 }}
      transition={{ duration: 0.2, ease: 'easeInOut' }}
    >
      {/* SVG Gradient Definition */}
      <svg className="absolute h-0 w-0">
        <defs>
          <linearGradient id="icon-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#00E5FF" />
            <stop offset="100%" stopColor="#9C4AFF" />
          </linearGradient>
        </defs>
      </svg>

      {/* Logo Area */}
      <div
        className={cn(
          'flex h-16 items-center border-b border-grid-line',
          isCollapsed ? 'justify-center px-2' : 'px-6'
        )}
      >
        <AnimatePresence mode="wait">
          {isCollapsed ? (
            <motion.div
              key="collapsed-logo"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-cyan to-brand-violet flex items-center justify-center"
            >
              <span className="font-display font-bold text-surface-dark text-sm">H</span>
            </motion.div>
          ) : (
            <motion.div
              key="full-logo"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <Image
                src="/hopwhistle.png"
                alt="Hopwhistle"
                width={120}
                height={40}
                className="h-8 w-auto"
                priority
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-2 space-y-1">
        {navigation.map(item => {
          const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`);
          return (
            <NavItem key={item.name} item={item} isActive={isActive} isCollapsed={isCollapsed} />
          );
        })}

        {/* Tools Section */}
        <div className="pt-4">
          <SectionLabel label="Tools" isCollapsed={isCollapsed} />
          {toolsNavigation.map(item => {
            const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`);
            return (
              <NavItem key={item.name} item={item} isActive={isActive} isCollapsed={isCollapsed} />
            );
          })}
        </div>

        {/* Admin Section */}
        <div className="pt-4">
          <SectionLabel label="Admin" isCollapsed={isCollapsed} />
          {adminNavigation.map(item => {
            const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`);
            return (
              <NavItem key={item.name} item={item} isActive={isActive} isCollapsed={isCollapsed} />
            );
          })}
        </div>
      </nav>

      {/* Collapse Toggle */}
      <div className="border-t border-grid-line p-2">
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className={cn(
            'flex w-full items-center justify-center rounded-lg p-2',
            'text-text-muted hover:text-text-primary hover:bg-grid-line/50',
            'transition-colors duration-200'
          )}
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isCollapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
        </button>
      </div>
    </motion.div>
  );
}
