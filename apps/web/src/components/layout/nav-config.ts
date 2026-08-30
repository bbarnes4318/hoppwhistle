import {
  AudioLines,
  BarChart3,
  Bot,
  Disc3,
  FileText,
  GitBranch,
  Globe,
  Headphones,
  LayoutDashboard,
  Megaphone,
  MonitorPlay,
  PhoneCall,
  Receipt,
  Settings,
  Shield,
  Telescope,
  Users,
  Wallet,
} from 'lucide-react';

/**
 * Navigation, as data.
 *
 * Admin's flat list of 14 becomes the four groups from the brief — LIVE,
 * MARKET, MONEY, BUILD — plus a standalone Dashboard and two groups for the
 * secondary surfaces the brief does not cover but which must stay reachable.
 * Group headers are labels, not collapsible sections: collapsing hides the
 * shape of the product, which is the thing the grouping exists to show.
 *
 * Publisher and buyer navs keep their structure and only get better labels.
 */

export interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  title?: string;
  /**
   * The route does not exist yet. Rendered as disabled rather than as a link,
   * so the information architecture is visible without shipping a 404. Clear
   * the flag in the prompt that builds the page.
   */
  pending?: boolean;
}

export interface NavGroup {
  /** Omit for a group that renders without a header — the top of the list. */
  label?: string;
  items: NavItem[];
}

/* ----------------------------------- admin -------------------------------- */

export const ADMIN_NAV: NavGroup[] = [
  {
    items: [{ name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard }],
  },
  {
    label: 'Live',
    items: [
      // Built in prompt 6. Shown disabled so the group reads correctly now.
      { name: 'Live board', href: '/admin/live', icon: MonitorPlay, pending: true },
      { name: 'Call center', href: '/call-center', icon: Headphones },
      { name: 'Calls', href: '/calls', icon: AudioLines },
      // Judgement call: CRM sits here rather than in MARKET because it is
      // worked in real time by the same agents who live in the call center.
      { name: 'CRM', href: '/insurance-leads', icon: Users },
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
      { name: 'Billing', href: '/billing', icon: Receipt },
      // No admin payouts page exists yet; /admin/payroll is staff pay, which is
      // a different thing and lives under Admin below.
      { name: 'Payouts', href: '/payouts', icon: Wallet, pending: true },
      { name: 'Reports', href: '/reports', icon: BarChart3 },
    ],
  },
  {
    label: 'Build',
    items: [
      { name: 'Flows', href: '/flows', icon: GitBranch },
      { name: 'Voice agents', href: '/voice-agents', icon: Bot },
      { name: 'Settings', href: '/settings', icon: Settings },
    ],
  },
  {
    label: 'Tools',
    items: [
      { name: 'Recording analyzer', href: '/tools/recording-analyzer', icon: AudioLines },
      { name: 'Campaign map', href: '/tools/campaign-map', icon: Globe },
      {
        name: 'Industry research',
        href: '/tools/industry-research',
        icon: Telescope,
        title: 'Multi-provider forensic industry-entry research',
      },
      {
        name: 'Music console',
        href: '/music-console',
        icon: Disc3,
        title: 'AI-powered direct-to-fan voice console',
      },
    ],
  },
  {
    label: 'Admin',
    items: [
      { name: 'Users', href: '/settings/users', icon: Users },
      { name: 'Webhooks', href: '/settings/webhooks', icon: FileText },
      { name: 'DNC lists', href: '/settings/dnc', icon: Shield },
      { name: 'Quotas & budgets', href: '/settings/quotas', icon: Wallet },
      { name: 'Payroll admin', href: '/admin/payroll', icon: Receipt },
    ],
  },
];

/* --------------------------------- publisher ------------------------------ */

/**
 * Structure unchanged from what shipped; labels tightened. "Publisher
 * Dashboard" inside the publisher portal was saying the word twice.
 */
export function publisherNav(canViewRecordings: boolean): NavGroup[] {
  const items: NavItem[] = [
    { name: 'Dashboard', href: '/publisher/dashboard', icon: LayoutDashboard },
    { name: 'Calls', href: '/publisher/calls', icon: AudioLines },
    { name: 'Earnings', href: '/publisher/earnings', icon: Receipt },
    { name: 'Payouts', href: '/publisher/payouts', icon: Wallet },
  ];
  if (canViewRecordings) {
    items.push({ name: 'Recordings', href: '/publisher/calls?hasRecording=true', icon: Disc3 });
  }
  items.push(
    { name: 'API setup', href: '/publisher/api-setup', icon: Shield },
    { name: 'Docs', href: '/publisher/docs', icon: FileText }
  );
  return [{ items }];
}

/* ----------------------------------- buyer -------------------------------- */

/**
 * Relabelled per the brief: Costs -> Spend, Targets -> Targeting,
 * Wallet / Billing -> Billing. The HREFS ARE UNCHANGED — prompt 4 moves the
 * routes themselves. Renaming the label before the route keeps the nav honest
 * without breaking every existing link and bookmark in the same commit.
 */
export function buyerNav(canViewRecordings: boolean): NavGroup[] {
  const items: NavItem[] = [
    { name: 'Dashboard', href: '/buyer/dashboard', icon: LayoutDashboard },
    { name: 'Calls', href: '/buyer/calls', icon: AudioLines },
    { name: 'Spend', href: '/buyer/costs', icon: BarChart3 },
    { name: 'Targeting', href: '/buyer/targets', icon: Globe },
    { name: 'Billing', href: '/buyer/wallet', icon: Receipt },
    { name: 'Disputes', href: '/buyer/disputes', icon: Shield },
  ];
  if (canViewRecordings) {
    items.push({ name: 'Recordings', href: '/buyer/calls?hasRecording=true', icon: Disc3 });
  }
  return [{ items }];
}

/* ----------------------------------- agent -------------------------------- */

export const AGENT_NAV: NavGroup[] = [
  {
    items: [{ name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard }],
  },
  {
    label: 'Live',
    items: [
      { name: 'Call center', href: '/call-center', icon: Headphones },
      { name: 'My calls', href: '/calls/my', icon: AudioLines },
      { name: 'Calls', href: '/calls', icon: AudioLines },
      { name: 'CRM', href: '/insurance-leads', icon: Users },
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
      { name: 'Billing', href: '/billing', icon: Receipt },
      { name: 'Reports', href: '/reports', icon: BarChart3 },
      { name: 'My payroll', href: '/payroll', icon: Receipt },
    ],
  },
  {
    label: 'Build',
    items: [{ name: 'Settings', href: '/settings', icon: Settings }],
  },
];

/** Every nav item across every role, for the command palette's page jumps. */
export function allNavItems(groups: NavGroup[]): NavItem[] {
  return groups.flatMap(g => g.items).filter(i => !i.pending);
}
