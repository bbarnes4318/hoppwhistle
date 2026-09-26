import {
  AudioWaveform,
  BadgeDollarSign,
  BarChart3,
  Bot,
  Briefcase,
  Building2,
  Contact,
  CreditCard,
  Disc3,
  FileBarChart,
  FileCheck2,
  FileText,
  Gauge,
  GitBranch,
  Globe,
  HandCoins,
  Handshake,
  Hash,
  Headphones,
  LayoutDashboard,
  Megaphone,
  Mic,
  MonitorPlay,
  PhoneCall,
  PhoneForwarded,
  PieChart,
  Radio,
  Receipt,
  ReceiptText,
  Settings,
  Shield,
  ShieldBan,
  Telescope,
  TrendingUp,
  Trophy,
  Sparkles,
  UserCog,
  Users,
  UsersRound,
  Wallet,
  Waypoints,
  Webhook,
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
      { name: 'Calls', href: '/calls', icon: PhoneCall },
      { name: 'Applications', href: '/applications', icon: FileCheck2 },
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
        icon: PieChart,
        title: 'Which leads Ameriquote accepted, which it refused, and why',
      },
    ],
  },
  {
    label: 'Market',
    items: [
      { name: 'Campaigns', href: '/campaigns', icon: Megaphone },
      { name: 'Publishers', href: '/publishers', icon: Radio },
      { name: 'Buyers', href: '/buyers', icon: Briefcase },
      { name: 'Numbers', href: '/numbers', icon: Hash },
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
        icon: UsersRound,
        title: 'What the team produced over a week, a month, a pay period',
      },
      {
        name: 'Settlements',
        href: '/delivery/settlements',
        icon: ReceiptText,
        title: 'One row per settled Delivery Day, downloadable as CSV',
      },
      { name: 'Billing', href: '/billing', icon: CreditCard },
      { name: 'Payouts', href: '/payouts', icon: HandCoins, pending: true },
      { name: 'Reports', href: '/reports', icon: FileBarChart },
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
        icon: Mic,
        title: 'Clone Fish Audio voices, preview scripts, tune delivery',
      },
    ],
  },
  {
    label: 'Tools',
    items: [
      { name: 'Recording analyzer', href: '/tools/recording-analyzer', icon: AudioWaveform },
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
      { name: 'Webhooks', href: '/settings/webhooks', icon: Webhook },
      { name: 'DNC Lists', href: '/settings/dnc', icon: ShieldBan },
      { name: 'VOIP Carrier Routing', href: '/settings/carriers', icon: PhoneForwarded },
      { name: 'Quotas & Budgets', href: '/settings/quotas', icon: Wallet },
      { name: 'Payroll Admin', href: '/admin/payroll', icon: BadgeDollarSign },
      {
        name: 'Agencies',
        href: '/admin/agencies',
        icon: Building2,
        title: 'Cross-agency delivery, revenue, margin and settlement status',
      },
      {
        name: 'Onboard an agency',
        href: '/admin/onboarding',
        icon: Handshake,
        title: 'Take an agency from nothing to enrolled, in the runbook order',
      },
    ],
  },
];

export function publisherNav(canViewRecordings: boolean): NavGroup[] {
  const items: NavItem[] = [
    { name: 'Dashboard', href: '/publisher/dashboard', icon: LayoutDashboard },
    { name: 'Calls', href: '/publisher/calls', icon: PhoneCall },
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
    { name: 'Calls', href: '/buyer/calls', icon: PhoneCall },
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
 * A white-label agency principal's navigation.
 *
 * ── An agency that also sells calls, on eleven entries ───────────────────────
 *
 * On the white-label tier the OWNER and ADMIN run a call network of their own
 * as well as a sales floor. This nav used to list every screen that involved:
 * twenty-seven entries, five of them locked, with the same person's buyers in
 * one group, what those buyers owed in another and the portal logins in a
 * third. It is now one entry per job, and the screens that used to be separate
 * entries are tabs on the entry they belong to:
 *
 *   Today       what is happening now, and what needs a decision
 *   Agents      Leaderboard, Agents today, Team and Team Members
 *   Buyers      buyers, their balances (was Billing) and Returns
 *   Publishers  publishers and what they are owed (was Payouts)
 *   Revenue     Sales and Reports
 *   Routing     Campaigns and Numbers
 *   Settings    settings, and Rate, Delivery and Settlements as Plan & Billing
 *   Upgrades    what used to be the five locked items, as one page
 *
 * The old URLs still resolve: the dashboard layout sends a white-label viewer
 * from each one to its tab (`WHITE_LABEL_REDIRECTS` in
 * `lib/staff-only-routes.ts`), and everybody else gets the page they always
 * got. Nothing here is locked, so there is no "Unlock more" divider.
 *
 * The screens here that a normal agency does not have are opened by
 * `WHITE_LABEL_ROUTES`, for this viewer only; a normal agency is still
 * redirected off every one of them.
 */
export const WHITE_LABEL_OWNER_NAV: NavGroup[] = [
  {
    items: [
      platformItem('/dashboard', {
        name: 'Today',
        title: 'Your calls, agents, buyers and money right now',
      }),
    ],
  },
  {
    label: 'Floor',
    items: [
      platformItem('/calls'),
      platformItem('/applications'),
      {
        name: 'Agents',
        href: '/agents',
        icon: Users,
        title: 'How your agents are doing, and who can take a call',
      },
    ],
  },
  {
    label: 'Call Sales',
    items: [
      platformItem('/buyers', {
        title: 'Your buyers: routing caps, balances, portal logins and returns',
      }),
      platformItem('/publishers', {
        title: 'Your publishers: payouts, portal logins and performance',
      }),
      {
        name: 'Revenue',
        href: '/revenue',
        icon: BadgeDollarSign,
        title: 'What your calls sold for, by buyer, publisher, campaign and day',
      },
    ],
  },
  {
    label: 'Routing',
    items: [
      {
        name: 'Routing',
        href: '/routing',
        icon: Waypoints,
        title: 'Campaigns and phone numbers: where every call goes',
      },
    ],
  },
  {
    label: 'Network',
    items: [
      {
        name: 'Agencies',
        href: '/network/agencies',
        icon: Building2,
        title: 'Your agencies: calls, applications and closing percentage',
      },
    ],
  },
  {
    label: 'Account',
    items: [
      platformItem('/settings'),
      { name: 'Upgrades', href: '/upgrades', icon: Sparkles, title: 'Features you can add' },
    ],
  },
];

/**
 * The upgrades a white-label agency can have turned on, as `/api/auth/me`
 * names them. The `/upgrades` page lists all five; `upgrades` on the session
 * says which of them this agency has.
 */
export const UPGRADE_KEYS = [
  'POWER_DIALER',
  'CARRIER_ROUTING',
  'VOICE_AGENTS',
  'VOICE_STUDIO',
  'PAYROLL_ADMIN',
] as const;

export type UpgradeKey = (typeof UPGRADE_KEYS)[number];

export interface Upgrade {
  key: UpgradeKey;
  /** The locked entry a normal agency is shown for it: name, icon and blurb. */
  item: NavItem;
  /** One more line under the blurb, where the blurb does not say it all. */
  note?: string;
}

/** The locked AGENCY_OWNER_NAV entry for this href, so the blurbs cannot drift. */
function agencyUpgrade(href: string): NavItem {
  const found = AGENCY_OWNER_NAV.flatMap(group => group.items).find(
    item => item.href === href && item.locked
  );
  if (!found) throw new Error(`nav-config: ${href} is not an upgrade in AGENCY_OWNER_NAV`);
  return found;
}

/**
 * What the white-label `/upgrades` page lists, in order: the five items that
 * were locked at the foot of this nav, with the blurbs a normal agency reads.
 */
export const WHITE_LABEL_UPGRADES: Upgrade[] = [
  {
    key: 'POWER_DIALER',
    item: agencyUpgrade('/call-center'),
    note: 'Includes the CRM and lead lists your agents dial.',
  },
  { key: 'CARRIER_ROUTING', item: agencyUpgrade('/settings/carriers') },
  { key: 'VOICE_AGENTS', item: agencyUpgrade('/voice-agents') },
  { key: 'VOICE_STUDIO', item: agencyUpgrade('/voice-studio') },
  { key: 'PAYROLL_ADMIN', item: agencyUpgrade('/admin/payroll') },
];

/**
 * WHITE_LABEL_OWNER_NAV, plus what this agency's upgrades add to it.
 *
 * Today that is one entry: the CRM, which holds the lead lists the Power
 * Dialer dials and means nothing without it. Until Power Dialer is on, the
 * CRM is not in this nav. Without an upgrade that adds an entry, this returns
 * WHITE_LABEL_OWNER_NAV itself.
 */
export function whiteLabelOwnerNav(upgrades: readonly string[] = []): NavGroup[] {
  if (!upgrades.includes('POWER_DIALER')) return WHITE_LABEL_OWNER_NAV;
  return WHITE_LABEL_OWNER_NAV.map(group =>
    group.label === 'Floor'
      ? { ...group, items: [...group.items, platformItem('/insurance-leads')] }
      : group
  );
}

/**
 * The label of AGENCY_OWNER_NAV's first group of upgrades, where the sidebar
 * draws its "Unlock more" divider. Everything from here down is locked.
 */
export const FIRST_UPGRADE_GROUP = 'Call Network';

/** A group whose every item is an upgrade gets a lock beside its label. */
export function isLockedGroup(group: NavGroup): boolean {
  return group.items.length > 0 && group.items.every(item => item.locked);
}

/**
 * Where this nav's "Unlock more" divider goes: the label of the first group
 * whose every item is locked, or null for a nav with no upgrades.
 *
 * Read off the groups rather than named, because the same label means
 * different things in different navs. It answers FIRST_UPGRADE_GROUP for
 * AGENCY_OWNER_NAV, and null for WHITE_LABEL_OWNER_NAV, which locks nothing:
 * its upgrades are a page of their own, `/upgrades`.
 */
export function firstUpgradeGroupOf(groups: NavGroup[]): string | null {
  return groups.find(group => isLockedGroup(group))?.label ?? null;
}

export const AGENT_NAV: NavGroup[] = [
  {
    label: 'Live',
    items: [
      {
        name: 'My calls',
        href: '/calls',
        icon: PhoneCall,
        title: 'Your calls. Narrowed server-side to the ones you took.',
      },
      { name: 'Power Dialer', href: '/call-center', icon: Headphones },
      {
        name: 'My applications',
        href: '/applications',
        icon: FileCheck2,
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
  /**
   * A white-label agency's OWNER or ADMIN (`useAuth().isWhiteLabel`). Only
   * read alongside `hasFullAccess`, which it implies.
   */
  isWhiteLabel: boolean;
  isPublisherOnly: boolean;
  isBuyerOnly: boolean;
  isAgentOnly: boolean;
  isReadonlyOnly: boolean;
  canViewRecordings: boolean;
  /** The upgrades turned on for this agency. See `whiteLabelOwnerNav`. */
  upgrades?: readonly string[];
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
  if (viewer.hasFullAccess) {
    return viewer.isWhiteLabel ? whiteLabelOwnerNav(viewer.upgrades) : AGENCY_OWNER_NAV;
  }
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
