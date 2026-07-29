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
  Telescope,
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

interface NavSection {
  label?: string;
  items: NavItem[];
}

/** Portal badges double as an at-a-glance "whose data am I looking at" cue. */
const PORTAL_STYLES = {
  buyer: 'border-sky-500/25 bg-sky-500/10 text-sky-300',
  publisher: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
  agent: 'border-violet-500/25 bg-violet-500/10 text-violet-300',
} as const;

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      title={item.title}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex items-center gap-2.5 rounded-md px-2.5 py-[7px]',
        'text-[13px] font-medium tracking-[-0.005em]',
        'transition-all duration-150 ease-premium',
        active
          ? 'bg-gradient-to-r from-primary/[0.14] to-transparent text-foreground'
          : 'text-muted-foreground hover:bg-white/[0.035] hover:text-foreground'
      )}
    >
      {/* Active marker: a soft glowing rail, not a hard border */}
      <span
        aria-hidden
        className={cn(
          'absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-primary transition-all duration-200 ease-premium',
          active ? 'opacity-100 shadow-[0_0_10px_1px_hsl(var(--primary)/0.6)]' : 'opacity-0'
        )}
      />
      <item.icon
        className={cn(
          'h-[15px] w-[15px] flex-shrink-0 transition-colors',
          active ? 'text-primary' : 'text-muted-foreground/70 group-hover:text-foreground'
        )}
      />
      <span className="truncate">{item.name}</span>
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const auth = useAuth();
  const {
    user,
    tenantName,
    hasFullAccess,
    isBuyerOnly,
    isPublisherOnly,
    isAgentOnly,
    isReadonlyOnly,
    isNewUser,
    canViewRecordings,
    canViewReports,
  } = auth;

  // Build the navigation dynamically based on roles, grouped into sections so
  // a long list reads as a structured product rather than a dump of links.
  let sections: NavSection[] = [];

  if (hasFullAccess) {
    sections = [
      {
        items: [{ name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard }],
      },
      {
        label: 'Operations',
        items: [
          { name: 'Call Center', href: '/call-center', icon: Headphones },
          { name: 'CRM', href: '/insurance-leads', icon: Users },
          { name: 'Numbers', href: '/numbers', icon: PhoneCall },
          { name: 'Campaigns', href: '/campaigns', icon: Megaphone },
          { name: 'Flows', href: '/flows', icon: GitBranch },
          { name: 'Call Logs', href: '/calls', icon: AudioLines },
        ],
      },
      {
        label: 'Network',
        items: [
          { name: 'Publishers', href: '/publishers', icon: Users },
          { name: 'Buyers', href: '/buyers', icon: Users },
        ],
      },
      {
        label: 'Intelligence',
        items: [
          {
            name: 'AI Voice',
            href: '/voice-agents',
            icon: Bot,
            title: 'AI voice agents & outbound campaigns',
          },
          {
            name: 'Music Console',
            href: '/music-console',
            icon: Disc3,
            title: 'AI-Powered Direct-to-Fan Voice Console',
          },
          { name: 'Reports', href: '/reports', icon: BarChart3 },
        ],
      },
      {
        label: 'Tools',
        items: [
          { name: 'Recording Analyzer', href: '/tools/recording-analyzer', icon: AudioLines },
          { name: 'Campaign Map', href: '/tools/campaign-map', icon: Globe },
          {
            name: 'Industry Research',
            href: '/tools/industry-research',
            icon: Telescope,
            title: 'Multi-provider forensic industry-entry research',
          },
        ],
      },
      {
        label: 'Administration',
        items: [
          { name: 'Users', href: '/settings/users', icon: Users },
          { name: 'Webhooks', href: '/settings/webhooks', icon: FileText },
          { name: 'DNC Lists', href: '/settings/dnc', icon: Shield },
          { name: 'Quotas & Budgets', href: '/settings/quotas', icon: DollarSign },
          { name: 'Payroll Admin', href: '/admin/payroll', icon: Receipt },
          { name: 'Billing', href: '/billing', icon: Receipt },
          { name: 'Settings', href: '/settings', icon: Settings },
        ],
      },
    ];
  } else if (isPublisherOnly) {
    const items: NavItem[] = [
      { name: 'Dashboard', href: '/publisher/dashboard', icon: LayoutDashboard },
      { name: 'API Setup', href: '/publisher/api-setup', icon: Shield },
      { name: 'Calls', href: '/publisher/calls', icon: AudioLines },
      { name: 'Earnings', href: '/publisher/earnings', icon: Receipt },
    ];
    if (canViewRecordings) {
      items.push({ name: 'Recordings', href: '/publisher/calls?hasRecording=true', icon: Disc3 });
    }
    items.push(
      { name: 'Payouts', href: '/publisher/payouts', icon: DollarSign },
      { name: 'Support / Docs', href: '/publisher/docs', icon: FileText }
    );
    sections = [{ items }];
  } else if (isBuyerOnly) {
    const items: NavItem[] = [
      { name: 'Dashboard', href: '/buyer/dashboard', icon: LayoutDashboard },
      { name: 'Calls', href: '/buyer/calls', icon: AudioLines },
      { name: 'Costs', href: '/buyer/costs', icon: BarChart3 },
      { name: 'Targets', href: '/buyer/targets', icon: Globe },
      { name: 'Wallet / Billing', href: '/buyer/wallet', icon: Receipt },
      { name: 'Disputes', href: '/buyer/disputes', icon: Shield },
    ];
    if (canViewRecordings) {
      items.push({ name: 'Recordings', href: '/buyer/calls?hasRecording=true', icon: Disc3 });
    }
    sections = [{ items }];
  } else if (isAgentOnly) {
    sections = [
      {
        items: [{ name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard }],
      },
      {
        label: 'Operations',
        items: [
          { name: 'Call Center', href: '/call-center', icon: Headphones },
          { name: 'My Calls', href: '/calls/my', icon: AudioLines },
          { name: 'CRM', href: '/insurance-leads', icon: Users },
          { name: 'Numbers', href: '/numbers', icon: PhoneCall },
          { name: 'Campaigns', href: '/campaigns', icon: Megaphone },
          { name: 'Call Logs', href: '/calls', icon: AudioLines },
        ],
      },
      {
        label: 'Network',
        items: [
          { name: 'Publishers', href: '/publishers', icon: Users },
          { name: 'Buyers', href: '/buyers', icon: Users },
        ],
      },
      {
        label: 'Account',
        items: [
          { name: 'Reports', href: '/reports', icon: BarChart3 },
          { name: 'My Payroll', href: '/payroll', icon: Clock },
          { name: 'Billing', href: '/billing', icon: Receipt },
          { name: 'Settings', href: '/settings', icon: Settings },
        ],
      },
    ];
  } else if (isReadonlyOnly) {
    const items: NavItem[] = [{ name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard }];
    if (canViewReports) {
      items.push({ name: 'Reports', href: '/reports', icon: BarChart3 });
    }
    sections = [{ items }];
  } else if (isNewUser) {
    sections = [{ items: [{ name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard }] }];
  } else {
    sections = [{ items: [{ name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard }] }];
  }

  const portal = isBuyerOnly
    ? { label: 'Buyer Portal', style: PORTAL_STYLES.buyer }
    : isPublisherOnly
      ? { label: 'Publisher Portal', style: PORTAL_STYLES.publisher }
      : isAgentOnly
        ? { label: 'Agent Portal', style: PORTAL_STYLES.agent }
        : null;

  const displayName =
    [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() || user?.email || '';
  const initials =
    (user?.firstName?.[0] || user?.email?.[0] || '?').toUpperCase() +
    (user?.lastName?.[0]?.toUpperCase() || '');

  const isActive = (href: string) => {
    const base = href.split('?')[0];
    return pathname === base || pathname?.startsWith(`${base}/`);
  };

  return (
    <div className="flex h-full w-[228px] flex-shrink-0 flex-col border-r border-border bg-surface/60">
      {/* Brand */}
      <div className="flex h-14 flex-shrink-0 items-center gap-2.5 border-b border-border px-4">
        <Image
          src="/hopwhistle-mark.svg"
          alt="Hopwhistle"
          width={120}
          height={32}
          className="h-6 w-auto"
          priority
        />
      </div>

      {/* Workspace — makes it unambiguous whose data is on screen */}
      <div className="flex-shrink-0 border-b border-border px-3 py-3">
        <div className="flex items-center gap-2.5 rounded-md border border-border bg-card px-2.5 py-2 shadow-inset">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-primary/85 to-primary/50 text-[11px] font-bold text-primary-foreground">
            {(tenantName?.[0] || 'W').toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="eyebrow leading-none">Workspace</div>
            <div className="mt-1 truncate text-xs font-semibold leading-none text-foreground">
              {tenantName || 'Loading…'}
            </div>
          </div>
        </div>

        {portal && (
          <div
            className={cn(
              'mt-2 rounded-md border px-2 py-1 text-center text-[10px] font-bold uppercase tracking-eyebrow',
              portal.style
            )}
          >
            {portal.label}
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="custom-scrollbar flex-1 overflow-y-auto px-2.5 py-3">
        {sections.map((section, i) => (
          <div key={section.label ?? `section-${i}`} className={cn(i > 0 && 'mt-5')}>
            {section.label && <div className="eyebrow mb-1.5 px-2.5">{section.label}</div>}
            <div className="space-y-0.5">
              {section.items.map(item => (
                <NavLink key={item.name} item={item} active={isActive(item.href)} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Signed-in identity */}
      {user && (
        <div className="flex-shrink-0 border-t border-border px-3 py-3">
          <Link
            href="/settings"
            className="flex items-center gap-2.5 rounded-md px-1.5 py-1.5 transition-colors hover:bg-white/[0.035]"
          >
            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-border bg-surface-raised text-[10px] font-bold text-foreground">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold leading-tight text-foreground">
                {displayName}
              </div>
              <div className="truncate text-[11px] leading-tight text-muted-foreground">
                {auth.userRoles[0]
                  ? auth.userRoles[0].charAt(0) + auth.userRoles[0].slice(1).toLowerCase()
                  : 'Member'}
              </div>
            </div>
          </Link>
        </div>
      )}
    </div>
  );
}
