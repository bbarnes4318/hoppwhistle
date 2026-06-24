'use client';

import {
  AudioLines,
  BarChart3,
  Bot,
  Clock,
  Disc3,
  DollarSign,
  FileText,
  GitBranch,
  Globe,
  Headphones,
  LayoutDashboard,
  Megaphone,
  PhoneCall,
  Receipt,
  Settings,
  Shield,
  Users,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  title?: string;
}

export function Sidebar() {
  const pathname = usePathname();
  const auth = useAuth();
  const {
    hasFullAccess,
    isBuyerOnly,
    isPublisherOnly,
    isAgentOnly,
    isReadonlyOnly,
    isNewUser,
    canViewRecordings,
    canViewReports,
  } = auth;

  // Build the navigation items dynamically based on roles
  let navItems: NavItem[] = [];

  if (hasFullAccess) {
    // Admin/Owner full navigation
    navItems = [
      { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
      {
        name: 'Music Console',
        href: '/music-console',
        icon: Disc3,
        title: 'AI-Powered Direct-to-Fan Voice Console',
      },
      {
        name: 'AI Voice',
        href: '/voice-agents',
        icon: Bot,
        title: 'AI voice agents & outbound campaigns',
      },
      { name: 'Call Center', href: '/call-center', icon: Headphones },
      { name: 'CRM', href: '/insurance-leads', icon: Users },
      { name: 'Numbers', href: '/numbers', icon: PhoneCall },
      { name: 'Campaigns', href: '/campaigns', icon: Megaphone },
      { name: 'Publishers', href: '/publishers', icon: Users },
      { name: 'Buyers', href: '/buyers', icon: Users },
      { name: 'Flows', href: '/flows', icon: GitBranch },
      { name: 'Call Logs', href: '/calls', icon: AudioLines },
      { name: 'Reports', href: '/reports', icon: BarChart3 },
      { name: 'Billing', href: '/billing', icon: Receipt },
      { name: 'Settings', href: '/settings', icon: Settings },
    ];
  } else if (isPublisherOnly) {
    // Publisher Portal navigation
    navItems = [
      { name: 'Publisher Dashboard', href: '/publisher/dashboard', icon: LayoutDashboard },
      { name: 'API Setup', href: '/publisher/api-setup', icon: Shield },
      { name: 'Calls', href: '/publisher/calls', icon: AudioLines },
      { name: 'Earnings', href: '/publisher/earnings', icon: Receipt },
    ];
    if (canViewRecordings) {
      navItems.push({
        name: 'Recordings',
        href: '/publisher/calls?hasRecording=true',
        icon: Disc3,
      });
    }
    navItems.push(
      { name: 'Payouts', href: '/publisher/payouts', icon: DollarSign },
      { name: 'Support / Docs', href: '/publisher/docs', icon: FileText }
    );
  } else if (isBuyerOnly) {
    // Buyer Portal navigation
    navItems = [
      { name: 'Buyer Dashboard', href: '/buyer/dashboard', icon: LayoutDashboard },
      { name: 'Calls', href: '/buyer/calls', icon: AudioLines },
      { name: 'Costs', href: '/buyer/costs', icon: BarChart3 },
      { name: 'Targets', href: '/buyer/targets', icon: Globe },
      { name: 'Wallet / Billing', href: '/buyer/wallet', icon: Receipt },
      { name: 'Disputes', href: '/buyer/disputes', icon: Shield },
    ];
    if (canViewRecordings) {
      navItems.push({ name: 'Recordings', href: '/buyer/calls?hasRecording=true', icon: Disc3 });
    }
  } else if (isAgentOnly) {
    // Agent Portal navigation
    navItems = [
      { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
      { name: 'Call Center', href: '/call-center', icon: Headphones },
      { name: 'My Calls', href: '/calls/my', icon: AudioLines },
      { name: 'CRM', href: '/insurance-leads', icon: Users },
      { name: 'Numbers', href: '/numbers', icon: PhoneCall },
      { name: 'Campaigns', href: '/campaigns', icon: Megaphone },
      { name: 'Publishers', href: '/publishers', icon: Users },
      { name: 'Buyers', href: '/buyers', icon: Users },
      { name: 'Call Logs', href: '/calls', icon: AudioLines },
      { name: 'Reports', href: '/reports', icon: BarChart3 },
      { name: 'My Payroll', href: '/payroll', icon: Clock },
      { name: 'Billing', href: '/billing', icon: Receipt },
      { name: 'Settings', href: '/settings', icon: Settings },
    ];
  } else if (isReadonlyOnly) {
    // Readonly navigation
    navItems = [{ name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard }];
    if (canViewReports) {
      navItems.push({ name: 'Reports', href: '/reports', icon: BarChart3 });
    }
  } else if (isNewUser) {
    // New user with no assigned role
    navItems = [{ name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard }];
  } else {
    // Fallback default
    navItems = [{ name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard }];
  }

  // Tools Navigation - Admin/Owner Only
  const toolsNav = hasFullAccess
    ? [
        {
          name: 'Recording Analyzer',
          href: '/tools/recording-analyzer',
          icon: AudioLines,
        },
        {
          name: 'Campaign Map',
          href: '/tools/campaign-map',
          icon: Globe,
        },
      ]
    : [];

  // Admin Navigation - Admin/Owner Only
  const adminNav = hasFullAccess
    ? [
        { name: 'Users', href: '/settings/users', icon: Users },
        { name: 'Webhooks', href: '/settings/webhooks', icon: FileText },
        { name: 'DNC Lists', href: '/settings/dnc', icon: Shield },
        { name: 'Quotas & Budgets', href: '/settings/quotas', icon: DollarSign },
        { name: 'Payroll Admin', href: '/admin/payroll', icon: Receipt },
      ]
    : [];

  return (
    <div className="flex h-full w-52 flex-col border-r border-border bg-card flex-shrink-0">
      <div className="flex h-11 items-center border-b border-border px-4 flex-shrink-0">
        <Image
          src="/hopwhistle.png"
          alt="Hopwhistle"
          width={100}
          height={32}
          className="h-6 w-auto"
          priority
        />
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2.5 custom-scrollbar">
        {/* Buyer Portal indicator */}
        {isBuyerOnly && (
          <div className="mb-2.5 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-primary bg-primary/10 rounded border border-primary/20 text-center">
            Buyer Portal
          </div>
        )}

        {/* Publisher Portal indicator */}
        {isPublisherOnly && (
          <div className="mb-2.5 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-400 bg-emerald-500/10 rounded border border-emerald-500/20 text-center">
            Publisher Portal
          </div>
        )}

        {/* Agent Portal indicator */}
        {isAgentOnly && (
          <div className="mb-2.5 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-blue-400 bg-blue-500/10 rounded border border-blue-500/20 text-center">
            Agent Portal
          </div>
        )}

        {navItems.map(item => {
          const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.name}
              href={item.href}
              title={item.title}
              className={cn(
                'flex items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold transition-all duration-150',
                isActive
                  ? 'bg-muted text-primary border-l-2 border-primary'
                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
              )}
            >
              <item.icon className="h-4 w-4 flex-shrink-0" />
              {item.name}
            </Link>
          );
        })}

        {toolsNav.length > 0 && (
          <div className="pt-3">
            <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
              Tools
            </div>
            {toolsNav.map(item => {
              const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold transition-all duration-150',
                    isActive
                      ? 'bg-muted text-primary border-l-2 border-primary'
                      : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                  )}
                >
                  <item.icon className="h-4 w-4 flex-shrink-0" />
                  {item.name}
                </Link>
              );
            })}
          </div>
        )}

        {adminNav.length > 0 && (
          <div className="pt-3">
            <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
              Admin
            </div>
            {adminNav.map(item => {
              const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  title={item.title}
                  className={cn(
                    'flex items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold transition-all duration-150',
                    isActive
                      ? 'bg-muted text-primary border-l-2 border-primary'
                      : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                  )}
                >
                  <item.icon className="h-4 w-4 flex-shrink-0" />
                  {item.name}
                </Link>
              );
            })}
          </div>
        )}
      </nav>
    </div>
  );
}
