'use client';

import {
  AudioLines,
  Bot,
  ClipboardCheck,
  Clock,
  DollarSign,
  FileText,
  GitBranch,
  Headphones,
  LayoutDashboard,
  Megaphone,
  Phone,
  PhoneCall,
  Receipt,
  Send,
  Settings,
  Shield,
  Users,
  Wallet,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  title?: string;
  // If set, only these roles can see this item
  roles?: string[];
  // If set, hide from these roles
  hideFromRoles?: string[];
}

// Main navigation items
const navigation: NavItem[] = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  {
    name: 'AI Voice',
    href: '/bot',
    icon: Bot,
    title: 'Outbound calling & live transfer orchestration',
  },
  {
    name: 'Phone',
    href: '/phone',
    icon: Phone,
    hideFromRoles: ['BUYER'],
  },
  {
    name: 'Call Center',
    href: '/call-center',
    icon: Headphones,
    title: 'Integrated dialer with scripting & quoting',
    hideFromRoles: ['BUYER'],
  },
  { name: 'Numbers', href: '/numbers', icon: PhoneCall },
  { name: 'Campaigns', href: '/campaigns', icon: Megaphone },
  { name: 'Flows', href: '/flows', icon: GitBranch },
  { name: 'Calls', href: '/calls', icon: AudioLines },
  {
    name: 'Publishers',
    href: '/publishers',
    icon: Send,
    title: 'Manage publisher accounts',
  },
  {
    name: 'Buyers',
    href: '/buyers',
    icon: Wallet,
    title: 'Manage buyers & billing wallets',
    hideFromRoles: ['BUYER'], // Buyers shouldn't see buyer management
  },
  {
    name: 'Retention',
    href: '/retention',
    icon: ClipboardCheck,
    title: 'Policy onboarding & retention queue',
    hideFromRoles: ['BUYER'],
  },
  { name: 'Billing', href: '/billing', icon: Receipt },
  {
    name: 'My Payroll',
    href: '/payroll',
    icon: Clock,
    title: 'Track hours & view earnings',
    hideFromRoles: ['BUYER'],
  },
  { name: 'Settings', href: '/settings', icon: Settings },
];

const toolsNavigation: NavItem[] = [
  { name: 'Recording Analyzer', href: '/tools/recording-analyzer', icon: AudioLines },
];

// Admin section - hidden from BUYER role entirely
const adminNavigation: NavItem[] = [
  { name: 'Users', href: '/settings/users', icon: Users },
  { name: 'Webhooks', href: '/settings/webhooks', icon: FileText },
  {
    name: 'DNC Lists',
    href: '/settings/dnc',
    icon: Shield,
  },
  { name: 'Quotas & Budgets', href: '/settings/quotas', icon: DollarSign },
  {
    name: 'Payroll Admin',
    href: '/admin/payroll',
    icon: Receipt,
    title: 'Manage contractor payroll',
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { userRoles, isBuyer, loading } = useAuth();

  // Filter navigation items based on user roles
  const filterNavItems = (items: NavItem[]): NavItem[] => {
    return items.filter(item => {
      // Check if user has required roles (if specified)
      if (item.roles && item.roles.length > 0) {
        const hasRequiredRole = item.roles.some(r => userRoles.includes(r));
        if (!hasRequiredRole) return false;
      }

      // Check if user is in hideFromRoles
      if (item.hideFromRoles && item.hideFromRoles.length > 0) {
        const shouldHide = item.hideFromRoles.some(r => userRoles.includes(r));
        if (shouldHide) return false;
      }

      return true;
    });
  };

  const visibleNavigation = filterNavItems(navigation);
  const visibleToolsNav = filterNavItems(toolsNavigation);
  const visibleAdminNav = isBuyer ? [] : filterNavItems(adminNavigation);

  return (
    <div className="flex h-full w-64 flex-col border-r bg-card">
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
        {/* Buyer Portal indicator */}
        {isBuyer && (
          <div className="mb-4 px-3 py-2 text-xs font-semibold uppercase text-primary bg-primary/10 rounded-md text-center">
            Buyer Portal
          </div>
        )}

        {visibleNavigation.map(item => {
          const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.name}
              href={item.href}
              title={item.title}
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

        {/* Tools Section */}
        {visibleToolsNav.length > 0 && (
          <div className="pt-4">
            <div className="px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
              Tools
            </div>
            {visibleToolsNav.map(item => {
              const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.name}
                  href={item.href}
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
          </div>
        )}

        {/* Admin Section - Hidden for BUYER role */}
        {visibleAdminNav.length > 0 && (
          <div className="pt-4">
            <div className="px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
              Admin
            </div>
            {visibleAdminNav.map(item => {
              const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  title={item.title}
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
          </div>
        )}
      </nav>
    </div>
  );
}
