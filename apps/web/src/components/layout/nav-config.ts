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
  Trophy,
  Users,
  Wallet,
} from 'lucide-react';

import { isStaffOnlyRoute } from '@/lib/staff-only-routes';

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
      {
        name: 'Live board',
        href: '/admin/live',
        icon: MonitorPlay,
        title: 'Every agency right now: calls up, delivered and applications so far today',
      },
      { name: 'Call center', href: '/call-center', icon: Headphones },
      { name: 'Calls', href: '/calls', icon: AudioLines },
      { name: 'Applications', href: '/applications', icon: FileText },
      {
        name: 'Leaderboard',
        href: '/leaderboard',
        icon: Trophy,
        title: 'The floor ranked over any period: calls, dials, applications, conversion',
      },
      { name: 'CRM', href: '/insurance-leads', icon: Users },
      {
        name: 'CRM reports',
        href: '/insurance-leads/reports',
        icon: BarChart3,
        title: 'Which leads Ameriquote accepted, which it refused, and why',
      },
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
      {
        name: 'Delivery',
        href: '/delivery',
        icon: Gauge,
        title: "Today's block, overrun, ceiling and per-agent closing percentages",
      },
      {
        name: 'Team',
        href: '/delivery/team',
        icon: BarChart3,
        title: 'What the team produced over a week, a month, a pay period',
      },
      {
        name: 'Settlements',
        href: '/delivery/settlements',
        icon: Receipt,
        title: 'One row per settled Delivery Day, downloadable as CSV',
      },
      { name: 'Billing', href: '/billing', icon: Receipt },
      { name: 'Payouts', href: '/payouts', icon: Wallet, pending: true },
      { name: 'Reports', href: '/reports', icon: BarChart3 },
    ],
  },
  {
    /*
     * Authoring: the flow engine and the voice-AI tooling.
     *
     * `Settings` used to sit here, and it is the parent of four entries in
     * Admin below -- /settings/users, /settings/webhooks, /settings/dnc and
     * /settings/quotas. Nothing noticed while Build had three other items, but
     * an agency principal reaches none of those three, so the filter in
     * AGENCY_OWNER_NAV left them a group labelled "Build" containing only
     * Settings, with its own children under a different heading. It belongs
     * with them.
     */
    label: 'Build',
    items: [
      { name: 'Flows', href: '/flows', icon: GitBranch },
      { name: 'Voice agents', href: '/voice-agents', icon: Bot },
      {
        name: 'Voice studio',
        href: '/voice-studio',
        icon: AudioLines,
        title: 'Clone Fish Audio voices, preview scripts, tune delivery',
      },
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
      // First, and before its own sub-pages: /settings is the page the four
      // /settings/* entries below are reached from.
      { name: 'Settings', href: '/settings', icon: Settings },
      /*
       * One entry, because there is one page. "Agents" pointed at a roster that
       * listed the same people as this does, with the four settings that decide
       * whether one of them ever rings; those are on an agent's row here now.
       * `/settings/agents` still resolves and redirects.
       */
      {
        name: 'Team Members',
        href: '/settings/users',
        icon: Users,
        title: 'Everyone in the agency, and whether each agent can take a call',
      },
      { name: 'Webhooks', href: '/settings/webhooks', icon: FileText },
      { name: 'DNC Lists', href: '/settings/dnc', icon: Shield },
      { name: 'Carrier routing', href: '/settings/carriers', icon: PhoneForwarded },
      { name: 'Quotas & Budgets', href: '/settings/quotas', icon: Wallet },
      { name: 'Payroll Admin', href: '/admin/payroll', icon: Receipt },
      {
        name: 'Agencies',
        href: '/admin/agencies',
        icon: Building2,
        title: 'Cross-agency delivery, revenue, margin and settlement status',
      },
      {
        name: 'Onboard an agency',
        href: '/admin/onboarding',
        icon: Building2,
        title: 'Take an agency from nothing to enrolled, in the runbook order',
      },
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
  if (canViewRecordings)
    items.push({ name: 'Recordings', href: '/publisher/calls?hasRecording=true', icon: Disc3 });
  items.push(
    { name: 'API setup', href: '/publisher/api-setup', icon: Shield },
    { name: 'Docs', href: '/publisher/docs', icon: FileText }
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
  if (canViewRecordings)
    items.push({ name: 'Recordings', href: '/buyer/calls?hasRecording=true', icon: Disc3 });
  return [{ items }];
}

/**
 * An agency principal's navigation: PLATFORM_NAV minus NetEnroll's own screens.
 *
 * ── What an agency is and is not shown ───────────────────────────────────────
 *
 * This used to mirror PLATFORM_NAV for everything except the two cross-agency
 * admin screens, on the reasoning that anything tenant-scoped belongs to the
 * tenant. That put NetEnroll's side of the business in an agency principal's
 * sidebar: the call marketplace they buy from (campaigns, publishers, buyers,
 * DID inventory), the routing and voice-AI authoring that configures the
 * platform, and a Tools group whose four entries included a WebGL campaign map
 * and an AI direct-to-fan music console.
 *
 * What an agency keeps is what an agency runs: the floor (call centre, calls,
 * applications, CRM), its money (rate, delivery, settlements, billing,
 * reports), and its own administration (users, webhooks, DNC, quotas,
 * payroll).
 *
 * ── The list is not here ─────────────────────────────────────────────────────
 *
 * `lib/staff-only-routes.ts` holds it, because a filter in this file only ever
 * hid links — `app/(dashboard)/layout.tsx` and `components/auth/staff-only-guard.tsx`
 * read the same list to stop the URLs, and the command palette reads this nav
 * to stop the search results. One list, four readers, no drift.
 *
 * Groups left with no items are dropped. Removing all four Tools entries would
 * otherwise render a "Tools" header with nothing under it.
 */
export const AGENCY_OWNER_NAV: NavGroup[] = PLATFORM_NAV.map(group => ({
  ...group,
  items: group.items.filter(item => !isStaffOnlyRoute(item.href)),
})).filter(group => group.items.length > 0);

export const AGENT_NAV: NavGroup[] = [
  {
    label: 'Live',
    items: [
      { name: 'Call center', href: '/call-center', icon: Headphones },
      {
        name: 'My calls',
        href: '/calls',
        icon: AudioLines,
        title: 'Your calls. Narrowed server-side to the ones you took.',
      },
      {
        name: 'My applications',
        href: '/applications',
        icon: FileText,
        title: 'The applications you wrote',
      },
      {
        /*
         * An agent's screen as much as a principal's, and the one agency view
         * an agent sees colleagues' numbers on. It carries no rate, balance or
         * charge -- see the header of routes/leaderboard.ts -- so the reason
         * /delivery is kept off this list does not apply to it.
         */
        name: 'Leaderboard',
        href: '/leaderboard',
        icon: Trophy,
        title: 'Where you stand on the floor, and what it would take to move up',
      },
      { name: 'CRM', href: '/insurance-leads', icon: Users },
    ],
  },
  {
    label: 'Me',
    items: [
      {
        name: 'My day',
        href: '/delivery/me',
        icon: Gauge,
        title: 'Your calls, applications and closing percentage against the agency average',
      },
      { name: 'My payroll', href: '/payroll', icon: Receipt },
    ],
  },
  { label: 'Build', items: [{ name: 'Settings', href: '/settings', icon: Settings }] },
];

export function allNavItems(groups: NavGroup[]): NavItem[] {
  return groups.flatMap(group => group.items).filter(item => !item.pending);
}
