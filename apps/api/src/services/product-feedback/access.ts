/**
 * Who may read which feedback, and what each reader is shown of it.
 *
 * ── Every agency-side query goes through `visibleWhere` ──────────────────────
 *
 * The routes never look a request up by id alone. They ask for `id AND
 * visibleWhere(viewer)`, so a request this viewer may not read answers 404
 * exactly as one that does not exist would -- changing the id in the URL
 * learns nothing. The viewer is built from the authenticated principal
 * (`request.user`), never from anything the browser sent.
 *
 *   PUBLIC   every agency (the roadmap)
 *   TENANT   everybody in the submitting agency
 *   PRIVATE  the submitter, and their agency's OWNER and ADMIN
 *
 * ── And through the serialisers here ────────────────────────────────────────
 *
 * A reader outside the submitting agency gets the public title and summary and
 * nothing else of the submitter's words, and nobody's name. Internal notes are
 * not filtered out of a response: the agency-side queries never select them
 * (`agencyCommentWhere`). Priority, owner, the submitter's browser context and
 * the internal thread exist only in the staff serialiser.
 */

import {
  FEEDBACK_CLOSED_STATUSES,
  feedbackTargetLabel,
  type FeedbackStatus,
  type FeedbackTargetKind,
} from '@hopwhistle/shared';
import type { Prisma } from '@prisma/client';

/** The roles that may give feedback and follow the roadmap. */
export const FEEDBACK_PARTICIPANT_ROLES: readonly string[] = ['OWNER', 'ADMIN', 'MANAGER', 'AGENT'];

/** The roles that see every request their agency sent, private ones included. */
export const FEEDBACK_ORG_ADMIN_ROLES: readonly string[] = ['OWNER', 'ADMIN'];

export interface FeedbackViewer {
  userId: string;
  tenantId: string;
  roles: readonly string[];
  /** An OWNER or ADMIN of `tenantId`. */
  orgAdmin: boolean;
}

export function buildViewer(
  userId: string,
  tenantId: string,
  roles: readonly string[] | undefined
): FeedbackViewer | null {
  const held = roles ?? [];
  if (!held.some(role => FEEDBACK_PARTICIPANT_ROLES.includes(role))) return null;
  return {
    userId,
    tenantId,
    roles: held,
    orgAdmin: held.some(role => FEEDBACK_ORG_ADMIN_ROLES.includes(role)),
  };
}

/** The requests this viewer may read. */
export function visibleWhere(viewer: FeedbackViewer): Prisma.ProductFeedbackWhereInput {
  const or: Prisma.ProductFeedbackWhereInput[] = [
    { visibility: 'PUBLIC' },
    { tenantId: viewer.tenantId, visibility: 'TENANT' },
    { tenantId: viewer.tenantId, submittedByUserId: viewer.userId },
  ];
  if (viewer.orgAdmin) or.push({ tenantId: viewer.tenantId });
  return { OR: or };
}

/**
 * The thread entries this viewer may read on a request they can already see.
 *
 * Public updates go to every reader. A question and the replies to it are a
 * conversation with the submitting agency, so only its submitter and its
 * OWNER/ADMIN see them. INTERNAL_NOTE is in no branch.
 */
export function agencyCommentWhere(
  viewer: FeedbackViewer,
  item: { tenantId: string | null; submittedByUserId: string | null }
): Prisma.ProductFeedbackCommentWhereInput {
  const inConversation =
    item.tenantId === viewer.tenantId &&
    (item.submittedByUserId === viewer.userId || viewer.orgAdmin);
  return {
    kind: { in: inConversation ? ['PUBLIC_UPDATE', 'QUESTION', 'USER_REPLY'] : ['PUBLIC_UPDATE'] },
  };
}

/** Whether this viewer may answer on this request: its submitter or their agency's admins. */
export function canReply(
  viewer: FeedbackViewer,
  item: { tenantId: string | null; submittedByUserId: string | null; status: string }
): boolean {
  if (item.status === 'MERGED') return false;
  return (
    item.tenantId === viewer.tenantId &&
    (item.submittedByUserId === viewer.userId || viewer.orgAdmin)
  );
}

export function isClosedStatus(status: string): boolean {
  return (FEEDBACK_CLOSED_STATUSES as readonly string[]).includes(status);
}

/** A free-text search over what this viewer can actually read of a request. */
export function searchWhere(viewer: FeedbackViewer, q: string): Prisma.ProductFeedbackWhereInput {
  const contains = { contains: q, mode: 'insensitive' as const };
  return {
    OR: [
      { publicTitle: contains },
      { publicTitle: null, title: contains },
      { publicSummary: contains },
      // The submitter's own words are searchable only inside their agency.
      { tenantId: viewer.tenantId, OR: [{ title: contains }, { description: contains }] },
      { comments: { some: { kind: 'PUBLIC_UPDATE', body: contains } } },
    ],
  };
}

// ── Shapes ──────────────────────────────────────────────────────────────────

export function personName(
  user: { firstName: string | null; lastName: string | null; email: string } | null | undefined
): string | null {
  if (!user) return null;
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return name || user.email;
}

/** Today in New York, 'YYYY-MM-DD': the calendar the product is run on. */
export function todayIso(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function targetView(kind: FeedbackTargetKind, date: Date | null, today = todayIso()) {
  const iso = date ? date.toISOString().slice(0, 10) : null;
  return { kind, date: iso, label: feedbackTargetLabel(kind, iso, today) };
}

function excerpt(text: string | null | undefined, max: number): string | null {
  if (!text) return null;
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** What the agency-side list queries include for each row. */
export function agencyListInclude(viewer: FeedbackViewer) {
  return {
    _count: { select: { votes: true } },
    votes: { where: { userId: viewer.userId }, select: { id: true } },
    reads: { where: { userId: viewer.userId }, select: { lastReadAt: true } },
    comments: {
      where: { kind: 'PUBLIC_UPDATE' as const },
      orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
      take: 1,
      select: { headline: true, body: true, createdAt: true },
    },
    mergedInto: { select: { id: true, number: true, title: true, publicTitle: true } },
    submittedBy: { select: { firstName: true, lastName: true, email: true } },
  } satisfies Prisma.ProductFeedbackInclude;
}

export type AgencyListRow = Prisma.ProductFeedbackGetPayload<{
  include: ReturnType<typeof agencyListInclude>;
}>;

/** One request as a card or a row, for this viewer. */
export function agencyItemView(viewer: FeedbackViewer, row: AgencyListRow, today = todayIso()) {
  const ownTenant = row.tenantId !== null && row.tenantId === viewer.tenantId;
  const isMine = ownTenant && row.submittedByUserId === viewer.userId;
  const interested = row.votes.length > 0;
  const lastRead = row.reads[0]?.lastReadAt ?? null;
  const follows = isMine || interested;
  const unread =
    follows &&
    (lastRead
      ? row.lastPublicActivityAt.getTime() > lastRead.getTime()
      : row.lastPublicActivityAt.getTime() > row.createdAt.getTime() + 1000);
  const update = row.comments[0] ?? null;

  return {
    id: row.id,
    number: row.number,
    title: row.publicTitle ?? row.title,
    summary: excerpt(ownTenant ? (row.publicSummary ?? row.description) : row.publicSummary, 280),
    category: row.category,
    productArea: row.productArea,
    status: row.status as FeedbackStatus,
    visibility: row.visibility,
    target: targetView(row.targetKind as FeedbackTargetKind, row.targetDate, today),
    interestCount: row._count.votes,
    viewerInterested: interested,
    isMine,
    ownTenant,
    fromProductTeam: row.tenantId === null,
    submittedBy: isMine ? 'You' : ownTenant && viewer.orgAdmin ? personName(row.submittedBy) : null,
    unread,
    needsReply:
      row.status === 'NEEDS_INFO' &&
      ownTenant &&
      (isMine || viewer.orgAdmin) &&
      (!row.lastUserReplyAt ||
        (row.lastStaffReplyAt !== null && row.lastStaffReplyAt > row.lastUserReplyAt)),
    latestUpdate: update
      ? {
          headline: update.headline,
          body: excerpt(update.body, 240),
          createdAt: update.createdAt.toISOString(),
        }
      : null,
    mergedInto: row.mergedInto
      ? {
          id: row.mergedInto.id,
          number: row.mergedInto.number,
          title: row.mergedInto.publicTitle ?? row.mergedInto.title,
        }
      : null,
    shippedAt: row.shippedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastPublicActivityAt: row.lastPublicActivityAt.toISOString(),
  };
}

export type AgencyItemView = ReturnType<typeof agencyItemView>;
