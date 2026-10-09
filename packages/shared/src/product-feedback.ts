/**
 * Product feedback: the vocabulary both sides speak.
 *
 * Agents and agency principals submit feedback from Feedback & Roadmap; the
 * product team triages it from Admin -> Product feedback. The API validates
 * against these lists and the web app labels them from the same file, so a
 * status cannot exist on one side and not the other. The Prisma enums in
 * apps/api/prisma/schema.prisma carry the same values.
 */

export const FEEDBACK_CATEGORIES = [
  'IDEA',
  'IMPROVEMENT',
  'PROBLEM',
  'WORKFLOW',
  'COMPLAINT',
  'OTHER',
] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const FEEDBACK_STATUSES = [
  'NEW',
  'UNDER_REVIEW',
  'NEEDS_INFO',
  'CONSIDERING',
  'PLANNED',
  'IN_PROGRESS',
  'TESTING',
  'SHIPPED',
  'NOT_PLANNED',
  'MERGED',
] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const FEEDBACK_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'] as const;
export type FeedbackPriority = (typeof FEEDBACK_PRIORITIES)[number];

/**
 * Who may read a piece of feedback, besides the product team.
 *
 *   PRIVATE  the person who sent it, and their agency's owners and admins.
 *            Every submission starts here: a complaint is not an agency-wide
 *            announcement.
 *   TENANT   everybody in the agency that sent it.
 *   PUBLIC   the roadmap: every agency on the platform. Readers outside the
 *            submitting agency see the public title and summary only.
 */
export const FEEDBACK_VISIBILITIES = ['PRIVATE', 'TENANT', 'PUBLIC'] as const;
export type FeedbackVisibility = (typeof FEEDBACK_VISIBILITIES)[number];

/** How much the problem gets in the way, as the submitter sees it. */
export const FEEDBACK_URGENCIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type FeedbackUrgency = (typeof FEEDBACK_URGENCIES)[number];

/**
 * How a target is expressed. Stored as a kind and the date the period starts,
 * never as text: "Next week" written in October is wrong by November, while a
 * WEEK starting 2026-10-12 reads "Next week", then "This week", then "Week of
 * Oct 12" on its own.
 */
export const FEEDBACK_TARGET_KINDS = ['NONE', 'WEEK', 'MONTH', 'QUARTER', 'DATE'] as const;
export type FeedbackTargetKind = (typeof FEEDBACK_TARGET_KINDS)[number];

export const FEEDBACK_COMMENT_KINDS = [
  'PUBLIC_UPDATE',
  'QUESTION',
  'USER_REPLY',
  'INTERNAL_NOTE',
] as const;
export type FeedbackCommentKind = (typeof FEEDBACK_COMMENT_KINDS)[number];

/** The road an accepted idea travels, in order. The timeline draws these. */
export const FEEDBACK_MAIN_PATH: readonly FeedbackStatus[] = [
  'NEW',
  'UNDER_REVIEW',
  'PLANNED',
  'IN_PROGRESS',
  'TESTING',
  'SHIPPED',
];

/** What an agent reads for each status. */
export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  NEW: 'Submitted',
  UNDER_REVIEW: 'Under Review',
  NEEDS_INFO: 'Need More Information',
  CONSIDERING: 'Considering',
  PLANNED: 'Planned',
  IN_PROGRESS: 'In Progress',
  TESTING: 'Testing',
  SHIPPED: 'Shipped',
  NOT_PLANNED: 'Not Planned',
  MERGED: 'Merged',
};

/** The product team's wording, where it differs: a NEW item is unread work. */
export const FEEDBACK_STAFF_STATUS_LABELS: Record<FeedbackStatus, string> = {
  ...FEEDBACK_STATUS_LABELS,
  NEW: 'New',
  NEEDS_INFO: 'Needs info',
};

/** The timeline's sentence for arriving at each status. */
export const FEEDBACK_TIMELINE_LABELS: Record<FeedbackStatus, string> = {
  NEW: 'Submitted',
  UNDER_REVIEW: 'Reviewed by the product team',
  NEEDS_INFO: 'More information requested',
  CONSIDERING: 'Being considered',
  PLANNED: 'Planned',
  IN_PROGRESS: 'Development started',
  TESTING: 'Testing',
  SHIPPED: 'Released',
  NOT_PLANNED: 'Not planned',
  MERGED: 'Merged with a similar request',
};

export const FEEDBACK_CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  IDEA: 'Idea',
  IMPROVEMENT: 'Improvement',
  PROBLEM: 'Problem',
  WORKFLOW: 'Workflow',
  COMPLAINT: 'Complaint',
  OTHER: 'Other',
};

export const FEEDBACK_PRIORITY_LABELS: Record<FeedbackPriority, string> = {
  LOW: 'Low',
  NORMAL: 'Normal',
  HIGH: 'High',
  CRITICAL: 'Critical',
};

export const FEEDBACK_VISIBILITY_LABELS: Record<FeedbackVisibility, string> = {
  PRIVATE: 'Private to submitter',
  TENANT: 'Visible to their agency',
  PUBLIC: 'Public roadmap',
};

export const FEEDBACK_URGENCY_LABELS: Record<FeedbackUrgency, string> = {
  LOW: 'Minor annoyance',
  MEDIUM: 'Slows me down',
  HIGH: 'Blocks my work',
};

/**
 * Where a status sits on the main path, 0..1, for the progress bar on a card.
 * Off-path statuses answer null: a request waiting on its submitter is not
 * "half way" to anything.
 */
export function feedbackProgress(status: FeedbackStatus): number | null {
  const at = FEEDBACK_MAIN_PATH.indexOf(status);
  if (at < 0) return status === 'CONSIDERING' ? 1 / (FEEDBACK_MAIN_PATH.length - 1) : null;
  return at / (FEEDBACK_MAIN_PATH.length - 1);
}

/** Statuses that are finished: nothing more will happen to them. */
export const FEEDBACK_CLOSED_STATUSES: readonly FeedbackStatus[] = [
  'SHIPPED',
  'NOT_PLANNED',
  'MERGED',
];

export function isFeedbackStatus(value: unknown): value is FeedbackStatus {
  return typeof value === 'string' && (FEEDBACK_STATUSES as readonly string[]).includes(value);
}
export function isFeedbackCategory(value: unknown): value is FeedbackCategory {
  return typeof value === 'string' && (FEEDBACK_CATEGORIES as readonly string[]).includes(value);
}
export function isFeedbackPriority(value: unknown): value is FeedbackPriority {
  return typeof value === 'string' && (FEEDBACK_PRIORITIES as readonly string[]).includes(value);
}
export function isFeedbackVisibility(value: unknown): value is FeedbackVisibility {
  return typeof value === 'string' && (FEEDBACK_VISIBILITIES as readonly string[]).includes(value);
}
export function isFeedbackUrgency(value: unknown): value is FeedbackUrgency {
  return typeof value === 'string' && (FEEDBACK_URGENCIES as readonly string[]).includes(value);
}
export function isFeedbackTargetKind(value: unknown): value is FeedbackTargetKind {
  return typeof value === 'string' && (FEEDBACK_TARGET_KINDS as readonly string[]).includes(value);
}

// ── Targets ─────────────────────────────────────────────────────────────────
//
// Pure date arithmetic on 'YYYY-MM-DD' strings, in UTC, so the API (for
// emails) and the browser (for cards) produce the same words for the same day.

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseIso(date: string): Date | null {
  const m = ISO_DATE.exec(date);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date ? null : d;
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && parseIso(value) !== null;
}

/** The Monday on or before this day. */
export function weekStart(date: string): string {
  const d = parseIso(date);
  if (!d) return date;
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return iso(d);
}

/** The first of this day's month. */
export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** The first day of this day's quarter. */
export function quarterStart(date: string): string {
  const month = Number(date.slice(5, 7));
  const first = Math.floor((month - 1) / 3) * 3 + 1;
  return `${date.slice(0, 4)}-${String(first).padStart(2, '0')}-01`;
}

/** The date a target's period starts: what is stored for a kind and a day in it. */
export function normaliseTargetDate(kind: FeedbackTargetKind, date: string): string | null {
  if (kind === 'NONE') return null;
  if (!parseIso(date)) return null;
  if (kind === 'WEEK') return weekStart(date);
  if (kind === 'MONTH') return monthStart(date);
  if (kind === 'QUARTER') return quarterStart(date);
  return date;
}

function addDays(date: string, days: number): string {
  const d = parseIso(date) as Date;
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
}

function addMonths(date: string, months: number): string {
  const d = parseIso(monthStart(date)) as Date;
  d.setUTCMonth(d.getUTCMonth() + months);
  return iso(d);
}

/**
 * "Next week", "Q4 2026", "January 2027", "No timeline yet".
 *
 * `today` is the reader's calendar day, 'YYYY-MM-DD'. Always prefixed with
 * "Target:" by the caller where a prefix is wanted: this is a target, never a
 * guaranteed completion date.
 */
export function feedbackTargetLabel(
  kind: FeedbackTargetKind | null | undefined,
  date: string | null | undefined,
  today: string
): string {
  if (!kind || kind === 'NONE' || !date || !parseIso(date) || !parseIso(today)) {
    return 'No timeline yet';
  }
  const d = parseIso(date) as Date;
  const monthName = MONTHS[d.getUTCMonth()];
  const year = d.getUTCFullYear();

  if (kind === 'WEEK') {
    const thisWeek = weekStart(today);
    if (date === thisWeek) return 'This week';
    if (date === addDays(thisWeek, 7)) return 'Next week';
    return `Week of ${monthName.slice(0, 3)} ${d.getUTCDate()}`;
  }
  if (kind === 'MONTH') {
    const thisMonth = monthStart(today);
    if (date === thisMonth) return 'This month';
    if (date === addMonths(thisMonth, 1)) return 'Next month';
    return `${monthName} ${year}`;
  }
  if (kind === 'QUARTER') {
    return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${year}`;
  }
  const sameYear = year === Number(today.slice(0, 4));
  return `${monthName.slice(0, 3)} ${d.getUTCDate()}${sameYear ? '' : `, ${year}`}`;
}
