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
  FileSignature,
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
  PhoneOutgoing,
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
  Target,
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
    label: 'Sales',
    items: [
      {
        name: 'Sales CRM',
        href: '/sales-crm',
        icon: Target,
        title: "NetEnroll's own B2B pipeline: agencies, agents and IMOs we are selling to",
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
      {
        name: 'Agreements',
        href: '/admin/agreements',
        icon: FileSignature,
        title: 'Send the MSA and campaign agreements for e-signature',
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
 * work, it is in AGENT_NAV (for an agency with the POWER_DIALER upgrade -- see
 * `agentNav`), and it stays reachable by URL. What is
 * locked is the owner's sidebar entry for running a dialer campaign, not the
 * page.
 *
 * `lib/staff-only-routes.ts` is still the list the redirect reads; the
 * nav-config test checks the two agree item by item.
 */
export const AGENCY_OWNER_NAV: NavGroup[] = [
  { items: [platformItem('/dashboard')] },
  {
    label: 'Workspace',
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
      /*
       * Numbers is a working screen for every agency now: an OWNER or ADMIN
       * buys, assigns and releases their own tracking numbers, within the
       * limit and at the price NetEnroll (or, for a downline, its parent) sets.
       * It sits here rather than in Call Network so that group stays wholly
       * locked and the "Unlock more" divider stays above it.
       */
      platformItem('/numbers'),
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
 * A downline (child) agency principal's navigation: AGENCY_OWNER_NAV without
 * the two things that belong to the parent.
 *
 *   Money           Rate, Delivery, Settlements and Billing are between the
 *                   child and its parent, and the parent runs them. Team (what
 *                   each agent delivered over a period) is the one screen in
 *                   that group about the child's own people, so it moves up to
 *                   the Floor rather than going with the rest.
 *   Agency Network  a downline does not onboard downlines of its own, so the
 *                   locked Agencies and Onboard entries are not offered.
 *
 * And one thing added: Upgrades, under Account. A downline asks for an upgrade
 * there, and the request goes to its parent agency's owners, who turn it on
 * (`CHILD_AGENCY_ROUTES` in lib/staff-only-routes.ts opens the route to it).
 *
 * Built from AGENCY_OWNER_NAV so every other entry stays identical to a
 * normal agency's.
 */
/** The Upgrades page: a white-label owner's, and a downline owner's. */
const UPGRADES_ITEM: NavItem = {
  name: 'Upgrades',
  href: '/upgrades',
  icon: Sparkles,
  title: 'Features you can add',
};

function childAgencyOwnerNav(): NavGroup[] {
  const team = AGENCY_OWNER_NAV.flatMap(group => group.items).find(
    item => item.href === '/delivery/team'
  );
  return AGENCY_OWNER_NAV.filter(
    group => group.label !== 'Money' && group.label !== 'Agency Network'
  ).map(group => {
    if (group.label === 'Workspace' && team) return { ...group, items: [...group.items, team] };
    if (group.label === 'Account') return { ...group, items: [...group.items, UPGRADES_ITEM] };
    return group;
  });
}

export const CHILD_AGENCY_OWNER_NAV: NavGroup[] = childAgencyOwnerNav();

/**
 * A white-label agency principal's navigation.
 *
 * ── An agency that also sells calls, on twelve entries ──────────────────────
 *
 * On the white-label tier the OWNER and ADMIN run a call network of their own
 * as well as a sales floor. Three groups, none of them a single entry: the
 * Workspace (Today, Calls, Applications, CRM, Agents), Call Sales (Buyers,
 * Publishers, Revenue) and Administration (Routing, Agencies, Settings, Upgrades). This nav used to list every screen that involved:
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
    label: 'Workspace',
    items: [
      platformItem('/dashboard', {
        name: 'Today',
        title: 'Your calls, agents, buyers and money right now',
      }),
      platformItem('/calls'),
      platformItem('/applications'),
      // Every agency has the CRM; only the Power Dialer is an upgrade.
      platformItem('/insurance-leads'),
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
    label: 'Administration',
    items: [
      {
        name: 'Routing',
        href: '/routing',
        icon: Waypoints,
        title: 'Campaigns and phone numbers: where every call goes',
      },
      {
        name: 'Agencies',
        href: '/network/agencies',
        icon: Building2,
        title: 'Your agencies: calls, applications and closing percentage',
      },
      platformItem('/settings'),
      UPGRADES_ITEM,
    ],
  },
];

/**
 * The upgrades a white-label agency can have turned on, as `/api/auth/me`
 * names them -- identical to TENANT_UPGRADES in apps/api/src/lib/tenant-upgrades.ts.
 * The `/upgrades` page lists all six; `upgrades` on the session says which of
 * them this agency has.
 */
export const UPGRADE_KEYS = [
  'POWER_DIALER',
  'PREDICTIVE_DIALER',
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
  /** A small tag beside the name, such as "Early access". */
  badge?: string;
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
 * were locked at the foot of this nav, with the blurbs a normal agency reads,
 * and the Predictive Dialer, which has no screen yet.
 */
export const WHITE_LABEL_UPGRADES: Upgrade[] = [
  {
    key: 'POWER_DIALER',
    item: agencyUpgrade('/call-center'),
    note: 'Includes lead lists your agents dial.',
  },
  {
    // Not in AGENCY_OWNER_NAV: it has no screen of its own yet. Turning it on
    // only marks the agency as enrolled.
    key: 'PREDICTIVE_DIALER',
    item: {
      name: 'Predictive Dialer',
      href: '/upgrades',
      icon: PhoneOutgoing,
      locked: {
        blurb:
          'Dials several numbers per agent at once and connects your agents only to calls a live person answers.',
      },
    },
    badge: 'Early access',
  },
  { key: 'CARRIER_ROUTING', item: agencyUpgrade('/settings/carriers') },
  { key: 'VOICE_AGENTS', item: agencyUpgrade('/voice-agents') },
  { key: 'VOICE_STUDIO', item: agencyUpgrade('/voice-studio') },
  { key: 'PAYROLL_ADMIN', item: agencyUpgrade('/admin/payroll') },
];

/**
 * WHITE_LABEL_OWNER_NAV, plus what this agency's upgrades add to it.
 *
 * Nothing, today: the CRM used to be added here with the Power Dialer, and is
 * now in WHITE_LABEL_OWNER_NAV for every agency. The upgrades are opened from
 * `/upgrades`. Kept as the one place an upgrade would add an entry.
 */
export function whiteLabelOwnerNav(_upgrades: readonly string[] = []): NavGroup[] {
  return WHITE_LABEL_OWNER_NAV;
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

/**
 * An agent's navigation: the same product as the owner's, through an agent's
 * lens.
 *
 * ── Same names as the owner's ────────────────────────────────────────────────
 *
 * Today, Calls, Applications, CRM, Leaderboard -- not "My calls", "My
 * customers". The owner's sidebar says Calls, not "Agency calls"; the role
 * and the server-side scoping already say whose calls they are, and each
 * page's description says it again in a sentence. Each entry is the
 * PLATFORM_NAV item, so the icon cannot drift from the owner's.
 *
 *   Floor    Today        /dashboard renders AgentToday for an agent: their
 *                         own production, follow-ups and standing.
 *            Calls        narrowed server-side to calls they answered.
 *            Applications narrowed server-side to applications they wrote.
 *            CRM          narrowed server-side to customers assigned to them.
 *            Leaderboard  the floor's production -- shared inside the agency,
 *                         money is not (see routes/leaderboard.ts).
 *   Work     Power Dialer the fullscreen console, with the POWER_DIALER
 *                         upgrade only (`agentNav`).
 *   Account  Account      their own login and password.
 *            Payroll      while MY_PAYROLL_ENABLED is on.
 *
 * ── What is not here ─────────────────────────────────────────────────────────
 *
 * "My day" (/delivery/me) -- its figures are Today now and the path
 * redirects. Settings -- for an agent it was the agency's DNC lists and legal
 * links under an innocent name, which is the agency's plumbing rather than
 * the agent's; their own account is Account. And nothing about buyers,
 * publishers, revenue, routing, billing, rates or agencies, ever.
 */
export const AGENT_NAV: NavGroup[] = [
  {
    label: 'Workspace',
    items: [
      platformItem('/dashboard', {
        name: 'Today',
        title: 'Your production, follow-ups and pace for the day',
      }),
      platformItem('/calls', { title: 'Every call you handled' }),
      platformItem('/applications', { title: 'Every application you submitted' }),
      platformItem('/insurance-leads', {
        title: 'Your prospects, follow-ups and submitted business',
      }),
      platformItem('/leaderboard', {
        title: 'Where you stand on the floor, and what it would take to move up',
      }),
    ],
  },
  {
    label: 'Work',
    items: [
      platformItem('/call-center', {
        title: 'The dialer console: your queue, script and softphone, fullscreen',
      }),
    ],
  },
  {
    label: 'Account',
    items: [
      { name: 'Account', href: '/account', icon: UserCog, title: 'Your login and password' },
      // Switched off for now -- see lib/feature-flags.ts.
      ...(MY_PAYROLL_ENABLED
        ? [{ name: 'Payroll', href: '/payroll', icon: Receipt } satisfies NavItem]
        : []),
    ],
  },
];

/** AGENT_NAV's entries that exist only with the POWER_DIALER upgrade. */
const AGENT_POWER_DIALER_HREFS: readonly string[] = ['/call-center'];

/** AGENT_NAV's entries a white-label agency's agents are not shown. */
const WHITE_LABEL_AGENT_HIDDEN_HREFS: readonly string[] = ['/leaderboard'];

/**
 * AGENT_NAV, less what this agency's upgrades do not include.
 *
 * The Power Dialer is the POWER_DIALER upgrade: an agent of an agency without
 * it is not shown it (the API answers 403 UPGRADE_REQUIRED), and the Work
 * group, which holds nothing else, goes with it. The CRM is every agent's,
 * upgrade or not.
 *
 * An agent of a white-label agency is not shown the Leaderboard: the agency
 * keeps the board to its owner (the API answers 403 to its agents).
 *
 * With the upgrade, and not white-label, this returns AGENT_NAV itself.
 */
export function agentNav(
  upgrades: readonly string[] = [],
  options: { whiteLabel?: boolean } = {}
): NavGroup[] {
  const hidden = [
    ...(upgrades.includes('POWER_DIALER') ? [] : AGENT_POWER_DIALER_HREFS),
    ...(options.whiteLabel ? WHITE_LABEL_AGENT_HIDDEN_HREFS : []),
  ];
  if (hidden.length === 0) return AGENT_NAV;
  return AGENT_NAV.map(group => ({
    ...group,
    items: group.items.filter(item => !hidden.includes(item.href)),
  })).filter(group => group.items.length > 0);
}

/** Every item a person can actually open: not pending, not locked. */
/**
 * The B2B Sales CRM group: a white-label issuer's own pipeline and agreement
 * suite. Distinct from `CRM` (`/insurance-leads`), the consumer CRM agents
 * work every day. Shown ONLY when the server reports a sales workspace for
 * this principal -- the owner, or somebody the owner granted -- never because
 * of a role name the browser holds.
 */
export const SALES_GROUP: NavGroup = {
  label: 'Sales',
  items: [
    {
      name: 'Sales CRM',
      href: '/sales-crm',
      icon: Target,
      title: 'Your B2B pipeline: agencies, licensed agents and IMOs you are selling to',
    },
    {
      name: 'Agreements',
      href: '/sales-crm/agreements',
      icon: FileSignature,
      title: 'Your MSA and campaign agreements, sent for e-signature',
    },
  ],
};

/** `groups` with the Sales group after the first (Workspace) group. */
export function withSalesGroup(groups: NavGroup[]): NavGroup[] {
  if (
    groups.some(
      group => group.label === SALES_GROUP.label && group.items.some(i => i.href === '/sales-crm')
    )
  ) {
    return groups;
  }
  const at = groups.findIndex(group => group.label === 'Workspace');
  const index = at >= 0 ? at + 1 : Math.min(1, groups.length);
  return [...groups.slice(0, index), SALES_GROUP, ...groups.slice(index)];
}

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
  /** The upgrades turned on for this agency. See `whiteLabelOwnerNav` and `agentNav`. */
  upgrades?: readonly string[];
  /** The agency is a white-label agency's downline. See `CHILD_AGENCY_OWNER_NAV`. */
  isChild?: boolean;
  /** An agent of a white-label agency (`useAuth().isWhiteLabelAgent`). See `agentNav`. */
  isWhiteLabelAgent?: boolean;
  /**
   * From `/api/auth/me`: the Sales CRM this principal may use, or null. The
   * server's answer, from the resolver the /api/v1/sales routes enforce with --
   * so an agent the owner granted sees the Sales group and every other agent
   * does not.
   */
  salesWorkspace?: { scope: 'PLATFORM' | 'TENANT' } | null;
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
  // Staff's nav carries its own Sales group (PLATFORM_NAV). Everybody else gets
  // one only when the server says they have a sales workspace.
  if (viewer.isPlatformAdmin && !viewer.previewing) return PLATFORM_NAV;
  const base = baseNavFor(viewer);
  return viewer.salesWorkspace && base.length > 0 ? withSalesGroup(base) : base;
}

function baseNavFor(viewer: NavViewer): NavGroup[] {
  if (viewer.isPlatformAdmin && !viewer.previewing) return PLATFORM_NAV;
  if (viewer.hasFullAccess) {
    if (viewer.isWhiteLabel) return whiteLabelOwnerNav(viewer.upgrades);
    return viewer.isChild ? CHILD_AGENCY_OWNER_NAV : AGENCY_OWNER_NAV;
  }
  if (viewer.isPublisherOnly) return publisherNav(viewer.canViewRecordings);
  if (viewer.isBuyerOnly) return buyerNav(viewer.canViewRecordings);
  if (viewer.isAgentOnly) {
    return agentNav(viewer.upgrades, { whiteLabel: viewer.isWhiteLabelAgent });
  }
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
