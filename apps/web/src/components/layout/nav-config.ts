import {
  AudioLines,
  BarChart3,
  Bot,
  Building2,
  Disc3,
  FileText,
  Gauge,
  GitBranch,
  Globe,
  Headphones,
  LayoutDashboard,
  Megaphone,
  MonitorPlay,
  PhoneCall,
  PhoneForwarded,
  Receipt,
  Settings,
  Shield,
  Telescope,
  Users,
  Wallet,
} from 'lucide-react';

export interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  title?: string;
  pending?: boolean;
}

export interface NavGroup {
  label?: string;
  items: NavItem[];
}

/**
 * NetEnroll staff navigation. This includes platform-only screens because
 * those endpoints are protected separately by the platform-admin capability.
 */
export const PLATFORM_NAV: NavGroup[] = [
  { items: [{ name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard }] },
  {
    label: 'Live',
    items: [
      { name: 'Live board', href: '/admin/live', icon: MonitorPlay, pending: true },
      { name: 'Call center', href: '/call-center', icon: Headphones },
      { name: 'Calls', href: '/calls', icon: AudioLines },
      { name: 'Applications', href: '/applications', icon: FileText },
      { name: 'CRM', href: '/insurance-leads', icon: Users },
      { name: 'CRM reports', href: '/insurance-leads/reports', icon: BarChart3, title: 'Which leads Ameriquote accepted, which it refused, and why' },
    ],
  },
  {
    label: 'Market',
    items: [
      { name: 'Campaigns', href: '/campaigns', icon: Megaphone },
      { name: 'Publishers', href: '/publishers', icon: Users },
      { name: 'Buyers', href: '/buyers', icon: Users },
      { name: 'Numbers', href: '/numbers', icon: PhoneCall },
    ],
  },
  {
    label: 'Money',
    items: [
      { name: 'Rate', href: '/rating', icon: Gauge },
      { name: 'Delivery', href: '/delivery', icon: Gauge, title: "Today's block, overrun, ceiling and per-agent closing percentages" },
      { name: 'Settlements', href: '/delivery/settlements', icon: Receipt, title: 'One row per settled Delivery Day, downloadable as CSV' },
      { name: 'Billing', href: '/billing', icon: Receipt },
      { name: 'Payouts', href: '/payouts', icon: Wallet, pending: true },
      { name: 'Reports', href: '/reports', icon: BarChart3 },
    ],
  },
  {
    label: 'Build',
    items: [
      { name: 'Flows', href: '/flows', icon: GitBranch },
      { name: 'Voice agents', href: '/voice-agents', icon: Bot },
      { name: 'Voice studio', href: '/voice-studio', icon: AudioLines, title: 'Clone Fish Audio voices, preview scripts, tune delivery' },
      { name: 'Settings', href: '/settings', icon: Settings },
    ],
  },
  {
    label: 'Tools',
    items: [
      { name: 'Recording analyzer', href: '/tools/recording-analyzer', icon: AudioLines },
      { name: 'Campaign map', href: '/tools/campaign-map', icon: Globe },
      { name: 'Industry research', href: '/tools/industry-research', icon: Telescope, title: 'Multi-provider forensic industry-entry research' },
      { name: 'Music console', href: '/music-console', icon: Disc3, title: 'AI-powered direct-to-fan voice console' },
    ],
  },
  {
    label: 'Admin',
    items: [
      { name: 'Users', href: '/settings/users', icon: Users },
      { name: 'Webhooks', href: '/settings/webhooks', icon: FileText },
      { name: 'DNC lists', href: '/settings/dnc', icon: Shield },
      { name: 'Carrier routing', href: '/settings/carriers', icon: PhoneForwarded },
      { name: 'Quotas & budgets', href: '/settings/quotas', icon: Wallet },
      { name: 'Payroll admin', href: '/admin/payroll', icon: Receipt },
      { name: 'Agencies', href: '/admin/agencies', icon: Building2, title: 'Cross-agency delivery, revenue, margin and settlement status' },
      { name: 'Onboard an agency', href: '/admin/onboarding', icon: Building2, title: 'Take an agency from nothing to enrolled, in the runbook order' },
    ],
  },
];

export function publisherNav(canViewRecordings: boolean): NavGroup[] {
  const items: NavItem[] = [
    { name: 'Dashboard', href: '/publisher/dashboard', icon: LayoutDashboard },
    { name: 'Calls', href: '/publisher/calls', icon: AudioLines },
    { name: 'Earnings', href: '/publisher/earnings', icon: Receipt },
    { name: 'Payouts', href: '/publisher/payouts', icon: Wallet },
  ];
  if (canViewRecordings) items.push({ name: 'Recordings', href: '/publisher/calls?hasRecording=true', icon: Disc3 });
  items.push(
    { name: 'API setup', href: '/publisher/api-setup', icon: Shield },
    { name: 'Docs', href: '/publisher/docs', icon: FileText },
  );
  return [{ items }];
}

export function buyerNav(canViewRecordings: boolean): NavGroup[] {
  const items: NavItem[] = [
    { name: 'Dashboard', href: '/buyer/dashboard', icon: LayoutDashboard },
    { name: 'Calls', href: '/buyer/calls', icon: AudioLines },
    { name: 'Spend', href: '/buyer/spend', icon: BarChart3 },
    { name: 'Targeting', href: '/buyer/targeting', icon: Globe },
    { name: 'Billing', href: '/buyer/billing', icon: Receipt },
    { name: 'Disputes', href: '/buyer/disputes', icon: Shield },
  ];
  if (canViewRecordings) items.push({ name: 'Recordings', href: '/buyer/calls?hasRecording=true', icon: Disc3 });
  return [{ items }];
}

/**
 * Every OWNER+ADMIN agency principal gets the complete tenant-admin surface.
 *
 * This deliberately mirrors PLATFORM_NAV for all tenant-scoped functionality:
 * campaigns, publishers, buyers, numbers, billing, reports, flows, voice tools,
 * webhooks, DNC, carrier routing, quotas, etc. The two cross-agency screens
 * remain platform-only because their API endpoints require isPlatformAdmin.
 */
export const AGENCY_OWNER_NAV: NavGroup[] = PLATFORM_NAV.map((group) => ({
  ...group,
  items: group.items.filter(
    (item) => item.href !== '/admin/agencies' && item.href !== '/admin/onboarding',
  ),
}));

export const AGENT_NAV: NavGroup[] = [
  {
    label: 'Live',
    items: [
      { name: 'Call center', href: '/call-center', icon: Headphones },
      { name: 'My calls', href: '/calls', icon: AudioLines, title: 'Your calls. Narrowed server-side to the ones you took.' },
      { name: 'My applications', href: '/applications', icon: FileText, title: 'The applications you wrote' },
      { name: 'CRM', href: '/insurance-leads', icon: Users },
    ],
  },
  {
    label: 'Me',
    items: [
      { name: 'My day', href: '/delivery/me', icon: Gauge, title: 'Your calls, applications and closing percentage against the agency average' },
      { name: 'My payroll', href: '/payroll', icon: Receipt },
    ],
  },
  { label: 'Build', items: [{ name: 'Settings', href: '/settings', icon: Settings }] },
];

export function allNavItems(groups: NavGroup[]): NavItem[] {
  return groups.flatMap((group) => group.items).filter((item) => !item.pending);
}
