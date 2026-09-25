import {
  AudioLines,
  BarChart3,
  Bot,
  Building2,
  Contact,
  CreditCard,
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
  TrendingUp,
  Trophy,
  UserCog,
  Users,
  Wallet,
} from 'lucide-react';

import { MY_PAYROLL_ENABLED } from '@/lib/feature-flags';

export interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  title?: string;
  pending?: boolean;
  /**
   * An upgrade: shown, never navigable, with a card explaining what it is.
   *
   * Not `pending`. A pending item is a screen that does not exist yet; a locked
   * one exists and this agency does not have it turned on. The sidebar renders
   * the two differently -- "Soon" in grey against an "Upgrade" pill in brand --
   * because they mean different things to the person reading them.
   */
  locked?: { blurb: string };
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
      { name: 'Power Dialer', href: '/call-center', icon: Headphones },
      { name: 'Calls', href: '/calls', icon: AudioLines },
      { name: 'Applications', href: '/applications', icon: FileText },
      {
        name: 'Leaderboard',
        href: '/leaderboard',
        icon: Trophy,
        title: 'The floor ranked over any period: calls, dials, applications, conversion',
      },
      { name: 'CRM', href: '/insurance-leads', icon: Contact },
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
      { name: 'Rate', href: '/rating', icon: TrendingUp },
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
      { name: 'Billing', href: '/billing', icon: CreditCard },
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
        icon: UserCog,
        title: 'Everyone in the agency, and whether each agent can take a call',
      },
      { name: 'Webhooks', href: '/settings/webhooks', icon: FileText },
      { name: 'DNC Lists', href: '/settings/dnc', icon: Shield },
      { name: 'VOIP Carrier Routing', href: '/settings/carriers', icon: PhoneForwarded },
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
 * A PLATFORM_NAV item by href, so an agency entry carries the same icon and
 * tooltip as staff's and cannot drift from it. Throws at module load if the
 * href is not in PLATFORM_NAV -- a typo here is a build failure, not a missing
 * sidebar entry nobody notices.
 */
function platformItem(href: string, overrides: Partial<NavItem> = {}): NavItem {
  const found = PLATFORM_NAV.flatMap(group => group.items).find(item => item.href === href);
  if (!found) throw new Error(`nav-config: ${href} is not in PLATFORM_NAV`);
  // `pending` is PLATFORM_NAV's and never carried across: an agency item is
  // either working or locked.
  const item: NavItem = { ...found, ...overrides };
  delete item.pending;
  return item;
}

/** An upgrade item: the PLATFORM_NAV entry, renamed if asked, and locked. */
function lockedItem(href: string, name: string, blurb: string): NavItem {
  return platformItem(href, { name, locked: { blurb } });
}

/**
 * An agency principal's navigation.
 *
 * ── Written out, not filtered ────────────────────────────────────────────────
 *
 * This used to be PLATFORM_NAV filtered through `isStaffOnlyRoute`, which gave
 * an agency whatever groups survived the filter in whatever order staff's
 * happened to be. It is now its own list, in the order an agency principal
 * works: the floor, selling, money, their own account -- and then, below a
 * divider, what they could turn on.
 *
 * ── The working menu and the upgrade menu ────────────────────────────────────
 *
 * Everything above "Unlock more" is a screen the agency can open. Everything
 * below it is `locked`: rendered, never navigable, with a card saying what it
 * is and who turns it on. Those routes are still in STAFF_ONLY_ROUTES and the
 * dashboard layout still redirects an agency off them by URL -- the nav does
 * not open anything the redirect closes.
 *
 * The one exception is Power Dialer. `/call-center` is where an agency's AGENTS
 * work, it is in AGENT_NAV untouched, and it stays reachable by URL. What is
 * locked is the owner's sidebar entry for running a dialer campaign, not the
 * page.
 *
 * `lib/staff-only-routes.ts` is still the list the redirect reads; the
 * nav-config test checks the two agree item by item.
 */
export const AGENCY_OWNER_NAV: NavGroup[] = [
  { items: [platformItem('/dashboard')] },
  {
    label: 'Floor',
    items: [
      {
        name: 'Live Board',
        href: '/live',
        icon: MonitorPlay,
        title: 'Your agency right now: calls up, delivered and applications so far today',
      },
      platformItem('/calls'),
      platformItem('/applications'),
      platformItem('/leaderboard'),
      platformItem('/insurance-leads'),
    ],
  },
  {
    label: 'Sales',
    items: [
      platformItem('/campaigns'),
      lockedItem(
        '/call-center',
        'Power Dialer',
        'Put your agents on a dialer that paces calls to how many agents are free.'
      ),
    ],
  },
  {
    label: 'Money',
    items: [
      platformItem('/rating'),
      platformItem('/delivery'),
      platformItem('/delivery/team'),
      platformItem('/delivery/settlements'),
      platformItem('/billing'),
    ],
  },
  {
    label: 'Account',
    items: [platformItem('/settings/users'), platformItem('/settings')],
  },
  {
    label: 'Call Network',
    items: [
      lockedItem(
        '/publishers',
        'Publishers',
        'See every source sending your agency calls and how each one converts.'
      ),
      lockedItem(
        '/buyers',
        'Buyers',
        "Route calls your agents can't take to buyers and get paid for the overflow."
      ),
      lockedItem(
        '/numbers',
        'Numbers',
        'Buy and manage your own tracking numbers, with full call history on each.'
      ),
      lockedItem(
        '/settings/carriers',
        'VOIP Carrier Routing',
        'Choose which VOIP carriers carry your calls and set automatic failover between them.'
      ),
    ],
  },
  {
    label: 'AI Voice',
    items: [
      lockedItem(
        '/voice-agents',
        'Voice Agents',
        'AI voice agents that answer, qualify and transfer live callers straight to your agents.'
      ),
      lockedItem(
        '/voice-studio',
        'Voice Studio',
        "Build and fine-tune your voice agents' scripts and voices before they go live."
      ),
    ],
  },
  {
    label: 'Payouts & Payroll',
    items: [
      lockedItem(
        '/payouts',
        'Payouts',
        'Track what you owe every publisher and pay out on schedule.'
      ),
      lockedItem(
        '/admin/payroll',
        'Payroll Admin',
        'Run agent commissions and payroll from the same data as your submitted applications.'
      ),
    ],
  },
  {
    label: 'Agency Network',
    items: [
      lockedItem(
        '/admin/agencies',
        'Agencies',
        'Manage the downline agencies working under your account.'
      ),
      lockedItem(
        '/admin/onboarding',
        'Onboard an Agency',
        'Bring a new agency onto the platform with agreement, payment and portal access in one flow.'
      ),
    ],
  },
];

/**
 * The label of the first group of upgrades, where the sidebar draws its
 * "Unlock more" divider. Everything from here down is locked.
 */
export const FIRST_UPGRADE_GROUP = 'Call Network';

/** A group whose every item is an upgrade gets a lock beside its label. */
export function isLockedGroup(group: NavGroup): boolean {
  return group.items.length > 0 && group.items.every(item => item.locked);
}

export const AGENT_NAV: NavGroup[] = [
  {
    label: 'Live',
    items: [
      {
        name: 'My calls',
        href: '/calls',
        icon: AudioLines,
        title: 'Your calls. Narrowed server-side to the ones you took.',
      },
      { name: 'Power Dialer', href: '/call-center', icon: Headphones },
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
      { name: 'CRM', href: '/insurance-leads', icon: Contact },
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
      // Switched off for now -- see lib/feature-flags.ts.
      ...(MY_PAYROLL_ENABLED
        ? [{ name: 'My payroll', href: '/payroll', icon: Receipt } satisfies NavItem]
        : []),
    ],
  },
  { label: 'Build', items: [{ name: 'Settings', href: '/settings', icon: Settings }] },
];

/** Every item a person can actually open: not pending, not locked. */
export function allNavItems(groups: NavGroup[]): NavItem[] {
  return groups.flatMap(group => group.items).filter(item => !item.pending && !item.locked);
}

/** What decides which navigation a viewer gets. All from `useAuth()`. */
export interface NavViewer {
  isPlatformAdmin: boolean;
  /**
   * A platform operator previewing an agency as one of its roles. The API has
   * replaced their roles with exactly the previewed one, so the role flags
   * below already describe the preview.
   */
  previewing: boolean;
  hasFullAccess: boolean;
  isPublisherOnly: boolean;
  isBuyerOnly: boolean;
  isAgentOnly: boolean;
  isReadonlyOnly: boolean;
  canViewRecordings: boolean;
}

/**
 * Which navigation this viewer gets. The sidebar and the command palette both
 * read it, so the two cannot disagree about who sees what.
 *
 * `isPlatformAdmin` is tested BEFORE `hasFullAccess`: staff inside an agency
 * carry its ADMIN and OWNER, and testing the role first handed them the
 * agency's nav. But it is tested only while NOT previewing. `isPlatformAdmin`
 * stays true for the whole of a role preview -- the banner needs it -- and
 * reading it first meant an operator previewing an agency as OWNER was shown
 * PLATFORM_NAV, which is exactly the screen the preview exists to get away
 * from. Under a preview the roles are the previewed one, so falling through to
 * the role dispatch gives the agency's nav as OWNER and AGENT_NAV as AGENT.
 *
 * Empty means the server answered and named no role this renders a nav for.
 */
export function navFor(viewer: NavViewer): NavGroup[] {
  if (viewer.isPlatformAdmin && !viewer.previewing) return PLATFORM_NAV;
  if (viewer.hasFullAccess) return AGENCY_OWNER_NAV;
  if (viewer.isPublisherOnly) return publisherNav(viewer.canViewRecordings);
  if (viewer.isBuyerOnly) return buyerNav(viewer.canViewRecordings);
  if (viewer.isAgentOnly) return AGENT_NAV;
  if (viewer.isReadonlyOnly) {
    /*
     * Dashboard alone.
     *
     * This used to add /reports when the account held `reports:read`, and that
     * link now goes somewhere they are sent straight back from: /reports is in
     * STAFF_ONLY_ROUTES, and the dashboard layout redirects a read-only account
     * off every route on that list. The capability is untouched; what has gone
     * is a menu item pointing at a screen this principal can no longer open.
     */
    return [{ items: [PLATFORM_NAV[0].items[0]] }];
  }
  return [];
}
