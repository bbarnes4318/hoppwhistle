/**
 * Feedback & Roadmap, on the web side: the response shapes of
 * `apps/api/src/routes/product-feedback.ts`, and the words the screens use.
 *
 * The vocabulary -- statuses, categories, targets -- is `@hopwhistle/shared`,
 * the same file the API validates against.
 */

import {
  FEEDBACK_CATEGORY_LABELS,
  FEEDBACK_STAFF_STATUS_LABELS,
  FEEDBACK_STATUS_LABELS,
  type FeedbackCategory,
  type FeedbackCommentKind,
  type FeedbackPriority,
  type FeedbackStatus,
  type FeedbackTargetKind,
  type FeedbackUrgency,
  type FeedbackVisibility,
} from '@hopwhistle/shared';

import {
  AGENT_NAV,
  PLATFORM_NAV,
  WHITE_LABEL_OWNER_NAV,
  allNavItems,
  type NavGroup,
} from '@/components/layout/nav-config';

export interface FeedbackTarget {
  kind: FeedbackTargetKind;
  date: string | null;
  label: string;
}

/** One request as a card, from the agency's side. */
export interface FeedbackItem {
  id: string;
  number: number;
  title: string;
  summary: string | null;
  category: FeedbackCategory;
  productArea: string | null;
  status: FeedbackStatus;
  visibility: FeedbackVisibility;
  target: FeedbackTarget;
  interestCount: number;
  viewerInterested: boolean;
  isMine: boolean;
  ownTenant: boolean;
  fromProductTeam: boolean;
  submittedBy: string | null;
  unread: boolean;
  needsReply: boolean;
  latestUpdate: { headline: string | null; body: string | null; createdAt: string } | null;
  mergedInto: { id: string; number: number; title: string } | null;
  shippedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastPublicActivityAt: string;
}

export interface FeedbackThreadEntry {
  id: string;
  kind: FeedbackCommentKind;
  headline: string | null;
  body: string;
  createdAt: string;
  author: string | null;
}

export interface FeedbackDetail extends FeedbackItem {
  description: string | null;
  originalTitle: string | null;
  urgency: FeedbackUrgency | null;
  timeline: Array<{ status: FeedbackStatus; at: string }>;
  thread: FeedbackThreadEntry[];
  canReply: boolean;
  canVote: boolean;
}

export interface RoadmapSection {
  count: number;
  items: FeedbackItem[];
}

export interface RoadmapOverview {
  sections: {
    inProgress: RoadmapSection;
    planned: RoadmapSection;
    underReview: RoadmapSection;
    recentlyShipped: RoadmapSection;
  };
  mine: RoadmapSection;
  unreadCount: number;
  /** The viewer's own requests with an unread update or an open question. */
  mineUnreadCount: number;
  needsReplyCount: number;
  recentlyShippedDays: number;
  viewer: { orgAdmin: boolean };
}

export interface ListMeta {
  page: number;
  pageSize: number;
  total: number;
}

// ── The product team's side ────────────────────────────────────────────────

export interface StaffFeedbackRow {
  id: string;
  number: number;
  title: string;
  publicTitle: string | null;
  category: FeedbackCategory;
  productArea: string | null;
  urgency: FeedbackUrgency | null;
  status: FeedbackStatus;
  priority: FeedbackPriority;
  visibility: FeedbackVisibility;
  tenant: { id: string; name: string } | null;
  submittedBy: { id: string; name: string | null; email: string } | null;
  submittedByRole: string | null;
  assignedTo: { id: string; name: string | null } | null;
  interestCount: number;
  target: FeedbackTarget;
  awaitingResponse: boolean;
  latestUpdate: {
    kind: FeedbackCommentKind;
    headline: string | null;
    body: string;
    createdAt: string;
  } | null;
  mergedIntoId: string | null;
  shippedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastPublicActivityAt: string;
  lastUserReplyAt: string | null;
}

export interface StaffFeedbackDetail extends StaffFeedbackRow {
  description: string;
  publicSummary: string | null;
  sourceRoute: string | null;
  clientContext: Record<string, string> | null;
  mergedInto: { id: string; number: number; title: string } | null;
  mergedFrom: Array<{ id: string; number: number; title: string; tenantName: string | null }>;
  interestByTenant: Array<{ tenantId: string; tenantName: string; count: number }>;
  thread: FeedbackThreadEntry[];
  timeline: Array<{
    from: FeedbackStatus | null;
    status: FeedbackStatus;
    at: string;
    actor: string | null;
  }>;
}

export interface StaffSummary {
  counts: {
    new: number;
    underReview: number;
    needsInfo: number;
    planned: number;
    inProgress: number;
    awaitingResponse: number;
    shippedThisMonth: number;
  };
  tenants: Array<{ id: string; name: string; count: number }>;
  owners: Array<{ id: string; name: string }>;
  productAreas: string[];
}

// ── Words ───────────────────────────────────────────────────────────────────

export function statusLabel(status: FeedbackStatus, staff = false): string {
  return (staff ? FEEDBACK_STAFF_STATUS_LABELS : FEEDBACK_STATUS_LABELS)[status] ?? status;
}

export function categoryLabel(category: FeedbackCategory): string {
  return FEEDBACK_CATEGORY_LABELS[category] ?? category;
}

/**
 * The filters across the top of the agency page. Each maps to the statuses the
 * API is asked for; "mine" is the viewer's own.
 */
export const AGENCY_FILTERS = [
  { key: 'all', label: 'All', statuses: [] as FeedbackStatus[] },
  { key: 'mine', label: 'My Feedback', statuses: [] as FeedbackStatus[] },
  {
    key: 'review',
    label: 'Under Review',
    statuses: ['NEW', 'UNDER_REVIEW', 'NEEDS_INFO', 'CONSIDERING'] as FeedbackStatus[],
  },
  { key: 'planned', label: 'Planned', statuses: ['PLANNED'] as FeedbackStatus[] },
  {
    key: 'progress',
    label: 'In Progress',
    statuses: ['IN_PROGRESS', 'TESTING'] as FeedbackStatus[],
  },
  { key: 'shipped', label: 'Shipped', statuses: ['SHIPPED'] as FeedbackStatus[] },
] as const;
export type AgencyFilterKey = (typeof AGENCY_FILTERS)[number]['key'];

/**
 * The status chip's look. Brand for what is moving, green for what shipped,
 * amber for something waiting on the reader, grey for the rest.
 */
export const STATUS_CHIP_CLASS: Record<FeedbackStatus, string> = {
  NEW: 'bg-sunken text-ink-2',
  UNDER_REVIEW: 'bg-sunken text-ink-2',
  NEEDS_INFO: 'bg-ringing-tint text-ringing-ink',
  CONSIDERING: 'bg-sunken text-ink-2',
  PLANNED: 'bg-brand-tint text-brand-ink',
  IN_PROGRESS: 'bg-brand-tint text-brand-ink',
  TESTING: 'bg-brand-tint text-brand-ink',
  SHIPPED: 'bg-live-tint text-live-ink',
  NOT_PLANNED: 'bg-sunken text-ink-3',
  MERGED: 'bg-sunken text-ink-3',
};

export const STATUS_DOT_CLASS: Record<FeedbackStatus, string> = {
  NEW: 'bg-ink-3',
  UNDER_REVIEW: 'bg-ink-3',
  NEEDS_INFO: 'bg-ringing',
  CONSIDERING: 'bg-ink-3',
  PLANNED: 'bg-brand',
  IN_PROGRESS: 'bg-brand',
  TESTING: 'bg-brand',
  SHIPPED: 'bg-live',
  NOT_PLANNED: 'bg-ink-3',
  MERGED: 'bg-ink-3',
};

// ── Product areas ───────────────────────────────────────────────────────────

/** Screens that are not a part of the product someone would give feedback on. */
const NOT_AN_AREA = new Set(['/feedback', '/admin/product-feedback']);

export interface ProductArea {
  value: string;
  label: string;
}

/**
 * The areas a viewer can say their feedback is about: the screens in their own
 * navigation, named as their sidebar names them, then "Something else". The
 * nav is the product's own list of what it is made of, so nothing here goes
 * stale when a screen is added or renamed.
 */
export function productAreasFor(groups: NavGroup[]): ProductArea[] {
  const seen = new Set<string>();
  const areas: ProductArea[] = [];
  for (const item of allNavItems(groups)) {
    const path = item.href.split('?')[0];
    if (NOT_AN_AREA.has(path) || seen.has(path)) continue;
    seen.add(path);
    areas.push({ value: path, label: item.name });
  }
  areas.push({ value: 'other', label: 'Something else' });
  return areas;
}

const AREA_NAMES: Map<string, string> = (() => {
  const names = new Map<string, string>();
  // The agency's own wording first ("Today", not "Dashboard"), then staff's.
  for (const groups of [AGENT_NAV, WHITE_LABEL_OWNER_NAV, PLATFORM_NAV]) {
    for (const item of allNavItems(groups)) {
      const path = item.href.split('?')[0];
      if (!names.has(path)) names.set(path, item.name);
    }
  }
  return names;
})();

/** A stored product area's name, wherever it came from. */
export function productAreaLabel(area: string | null | undefined): string | null {
  if (!area) return null;
  if (area === 'other') return 'Other';
  const known = AREA_NAMES.get(area);
  if (known) return known;
  const last = area.split('/').filter(Boolean).pop() ?? area;
  return last.charAt(0).toUpperCase() + last.slice(1).replace(/-/g, ' ');
}

/**
 * The area a path belongs to: the longest area whose path is it or a parent of
 * it, so `/insurance-leads/abc/quote` is the CRM.
 */
export function areaForRoute(route: string | null, areas: ProductArea[]): string | null {
  if (!route) return null;
  const path = route.split('?')[0];
  let best: ProductArea | null = null;
  for (const area of areas) {
    if (area.value === 'other') continue;
    if (path === area.value || path.startsWith(`${area.value}/`)) {
      if (!best || area.value.length > best.value.length) best = area;
    }
  }
  return best?.value ?? null;
}

// ── Where the person was ────────────────────────────────────────────────────

const LAST_ROUTE_KEY = 'feedback:lastRoute';

/**
 * Remember the last page someone was on before Feedback & Roadmap, so their
 * feedback can say where it came from without asking. Session-only, and
 * storage that refuses is simply no context.
 */
export function rememberRoute(pathname: string | null | undefined): void {
  if (!pathname || pathname === '/feedback' || pathname.startsWith('/feedback/')) return;
  try {
    window.sessionStorage.setItem(LAST_ROUTE_KEY, pathname);
  } catch {
    // Storage blocked: no source route, which is allowed.
  }
}

export function lastRoute(): string | null {
  try {
    return window.sessionStorage.getItem(LAST_ROUTE_KEY);
  } catch {
    return null;
  }
}

/** What the browser may tell the product team about itself. */
export function clientContext(): Record<string, string> {
  const context: Record<string, string> = {};
  try {
    context.viewport = `${window.innerWidth}x${window.innerHeight}`;
    context.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    context.userAgent = navigator.userAgent.slice(0, 300);
  } catch {
    // Whatever was readable is enough.
  }
  return context;
}

// ── Dates ───────────────────────────────────────────────────────────────────

const SHORT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const SHORT_YEAR = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const LONG = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric' });

/** "Oct 8", or "Oct 8, 2025" outside this year. */
export function shortDate(iso: string, now = new Date()): string {
  const date = new Date(iso);
  return date.getFullYear() === now.getFullYear() ? SHORT.format(date) : SHORT_YEAR.format(date);
}

/** "October 21". */
export function longDate(iso: string): string {
  return LONG.format(new Date(iso));
}

/** "just now", "3 hours ago", "2 days ago", then the date. */
export function relativeTime(iso: string, now = new Date()): string {
  const seconds = Math.max(0, (now.getTime() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days} day${days === 1 ? '' : 's'} ago`;
  return shortDate(iso, now);
}

/** "now", "12m ago", "3h ago", "2d ago", then the date: for a narrow column. */
export function compactRelativeTime(iso: string, now = new Date()): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h ago`;
  if (minutes < 60 * 24 * 14) return `${Math.floor(minutes / (60 * 24))}d ago`;
  return shortDate(iso, now);
}

/** Whole days since, for the staff queue's Age column. */
export function ageInDays(iso: string, now = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000));
}

/** "1 person", "14 people": interest, said plainly. */
export function interestPhrase(count: number): string {
  return `${count} ${count === 1 ? 'person' : 'people'}`;
}

/** "1 person wants this", "14 people want this". */
export function wantPhrase(count: number): string {
  return `${interestPhrase(count)} ${count === 1 ? 'wants' : 'want'} this`;
}
