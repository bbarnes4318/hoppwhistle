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
 *
 * ── There are three full-access navs, not one ────────────────────────────────
 *
 * `hasFullAccess` in `use-auth.tsx` is ADMIN-or-OWNER, and for as long as one
 * nav served it an agency owner was shown NetEnroll's own platform nav:
 * Publishers, Buyers, Campaigns, Numbers, Carrier routing, DNC lists, Webhooks,
 * Quotas, Flows, Voice agents, Voice studio, Payroll admin, Music console,
 * Industry research, Agencies, Onboard an agency. Two of those the server
 * refuses them outright (`requirePlatformAdmin`); the rest are tenant-scoped and
 * genuinely work, which is worse — an agency owner who came to run a call floor
 * was handed a call-marketplace console and left to work out which half was for
 * them.
 *
 * So the split is by WHO IS ASKING, not by what the server will tolerate:
 *
 *   PLATFORM_NAV       NetEnroll staff. Everything, unchanged.
 *   AGENCY_OWNER_NAV   An agency principal. The floor, the money, the team.
 *   AGENT_NAV          One agent. Their calls, their applications, their pay.
 *
 * ── A dead link is worse than a missing one ──────────────────────────────────
 *
 * `AGENT_NAV` had twelve items and seven of them went nowhere: `/calls/my` has
 * no route at all, and Campaigns, Publishers, Buyers, Numbers and Billing are
 * each wrapped in a RoleGuard for ADMIN/OWNER that bounces an agent straight
 * back to /call-center. Reports needed `reports:read`, which AGENT does not get.
 * An agent clicking seven of twelve items and being thrown back where they
 * started learns not to trust the nav.
 *
 * `__tests__/nav-config.test.tsx` resolves every href here against the files
 * under `src/app`, which is what stops them coming back.
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

/* --------------------------------- platform ------------------------------- */

/**
 * NetEnroll staff. Everything the product has, including the two screens the
 * server gates on the platform capability.
 *
 * Previously `ADMIN_NAV`, and the rename is the point: it was being rendered for
 * every ADMIN and OWNER, which is every agency principal on the platform.
 */
export const PLATFORM_NAV: NavGroup[] = [
  {
    items: [{ name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard }],
  },
  {
    label: 'Live',
    items: [
      // Not built yet. Shown disabled so the group reads correctly now.
      { name: 'Live board', href: '/admin/live', icon: MonitorPlay, pending: true },
      { name: 'Call center', href: '/call-center', icon: Headphones },
      { name: 'Calls', href: '/calls', icon: AudioLines },
      // The business the agency wrote, both the automation's rows and the ones
      // agents logged. Under LIVE beside Calls because it is the other half of
      // the closing percentage, read the same day it is written.
      { name: 'Applications', href: '/applications', icon: FileText },
      // Judgement call: CRM sits here rather than in MARKET because it is
      // worked in real time by the same agents who live in the call center.
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
      // What the agency is paid per submitted application, and the measurements
      // behind it. Under Money because it is a price, not a report.
      { name: 'Rate', href: '/rating', icon: Gauge },
      // What is left on the block, what today's overrun will cost tonight, how
      // far the agency is from the ceiling, and who is closing. Above Billing
      // because it is the screen a principal watches during the day.
      {
        name: 'Delivery',
        href: '/delivery',
        icon: Gauge,
        title: "Today's block, overrun, ceiling and per-agent closing percentages",
      },
      {
        name: 'Settlements',
        href: '/delivery/settlements',
        icon: Receipt,
        title: 'One row per settled Delivery Day, downloadable as CSV',
      },
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
      {
        name: 'Voice studio',
        href: '/voice-studio',
        icon: AudioLines,
        title: 'Clone Fish Audio voices, preview scripts, tune delivery',
      },
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
      { name: 'Carrier routing', href: '/settings/carriers', icon: PhoneForwarded },
      { name: 'Quotas & budgets', href: '/settings/quotas', icon: Wallet },
      { name: 'Payroll admin', href: '/admin/payroll', icon: Receipt },
      // NetEnroll staff only. The endpoints behind it are gated on the platform
      // capability, so an agency admin who reaches the URL is refused by the
      // server rather than by the page.
      {
        name: 'Agencies',
        href: '/admin/agencies',
        icon: Building2,
        title: 'Cross-agency delivery, revenue, margin and settlement status',
      },
      // Also NetEnroll staff only. There is no self-serve path: every agency is
      // onboarded here, after a conversation and a signed agreement.
      {
        name: 'Onboard an agency',
        href: '/admin/onboarding',
        icon: Building2,
        title: 'Take an agency from nothing to enrolled, in the runbook order',
      },
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
 * Wallet / Billing -> Billing. The routes now match the labels; the old paths
 * redirect (see next.config.js), so existing links and bookmarks still land.
 */
export function buyerNav(canViewRecordings: boolean): NavGroup[] {
  const items: NavItem[] = [
    { name: 'Dashboard', href: '/buyer/dashboard', icon: LayoutDashboard },
    { name: 'Calls', href: '/buyer/calls', icon: AudioLines },
    { name: 'Spend', href: '/buyer/spend', icon: BarChart3 },
    { name: 'Targeting', href: '/buyer/targeting', icon: Globe },
    { name: 'Billing', href: '/buyer/billing', icon: Receipt },
    { name: 'Disputes', href: '/buyer/disputes', icon: Shield },
  ];
  if (canViewRecordings) {
    items.push({ name: 'Recordings', href: '/buyer/calls?hasRecording=true', icon: Disc3 });
  }
  return [{ items }];
}

/* ------------------------------- agency owner ----------------------------- */

/**
 * An agency principal: the person who owns the floor and is charged for it.
 *
 * Twelve items, and every one of them is something they do. The floor and what
 * it wrote (LIVE), what they are paid and what they owe (MONEY), who works for
 * them and what they are paid (TEAM), and their own settings (BUILD).
 *
 * ── What is deliberately absent ──────────────────────────────────────────────
 *
 * Publishers, Buyers, Campaigns, Numbers, Carrier routing, DNC lists, Webhooks,
 * Quotas, Flows, Voice agents, Voice studio, Music console, Industry research,
 * Billing, Reports, Agencies and Onboarding. Agencies and Onboarding the server
 * refuses them. The rest are NetEnroll's own machinery: an agency owner does not
 * buy numbers, route carriers or publish flows, and listing sixteen screens they
 * have no use for is what made the nav unreadable rather than merely long.
 *
 * Rate and Delivery stay, because an agency principal absolutely does need to
 * see what they are paid per application and what tonight's debit will be.
 */
export const AGENCY_OWNER_NAV: NavGroup[] = [
  {
    items: [{ name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard }],
  },
  {
    label: 'Live',
    items: [
      { name: 'Call center', href: '/call-center', icon: Headphones },
      { name: 'Calls', href: '/calls', icon: AudioLines },
      { name: 'Applications', href: '/applications', icon: FileText },
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
    label: 'Money',
    items: [
      {
        name: 'Rate',
        href: '/rating',
        icon: Gauge,
        title: 'What this agency is paid per submitted application, and why',
      },
      {
        name: 'Delivery',
        href: '/delivery',
        icon: Gauge,
        title: "Today's block, overrun, ceiling and per-agent closing percentages",
      },
      {
        name: 'Settlements',
        href: '/delivery/settlements',
        icon: Receipt,
        title: 'One row per settled Delivery Day, downloadable as CSV',
      },
    ],
  },
  {
    label: 'Team',
    items: [
      { name: 'Agents', href: '/settings/users', icon: Users },
      { name: 'Payroll', href: '/admin/payroll', icon: Receipt },
    ],
  },
  {
    label: 'Build',
    items: [{ name: 'Settings', href: '/settings', icon: Settings }],
  },
];

/* ----------------------------------- agent -------------------------------- */

/**
 * One agent: their calls, their applications, their day and their pay.
 *
 * Seven items, all of which work. The previous twelve included `/calls/my`,
 * which has no route, and five screens guarded for ADMIN/OWNER that bounced the
 * agent back to /call-center the moment they were clicked.
 *
 * Calls and Applications are labelled "My" because that is what they show: the
 * narrowing is server-side — `buildCallWhere` in `apps/api/src/routes/index.ts`
 * scopes /calls to the agent's own rows — so these are the same pages an
 * administrator opens, carrying only this agent's work. There is no separate
 * route to build, which is why the dead `/calls/my` entry is simply gone.
 *
 * No Dashboard entry: `/dashboard` is the tenant-wide admin dashboard, and the
 * page now redirects an agent to /call-center rather than show it to them.
 */
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
      { name: 'CRM', href: '/insurance-leads', icon: Users },
    ],
  },
  {
    label: 'Me',
    items: [
      // An agent's own calls, applications and closing percentage against the
      // agency average. No pricing and no money: the endpoint behind it loads
      // no rate, balance, overrun or charge at all.
      {
        name: 'My day',
        href: '/delivery/me',
        icon: Gauge,
        title: 'Your calls, applications and closing percentage against the agency average',
      },
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
