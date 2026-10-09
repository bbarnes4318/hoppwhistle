/**
 * Feedback & Roadmap: an agency's people tell the product team what would make
 * the platform better, and follow each request from review to release.
 *
 * ── The agency's side (any OWNER, ADMIN, MANAGER or AGENT of the acting agency)
 *
 *   GET    /api/v1/feedback                  list, filtered and paged
 *   GET    /api/v1/feedback/roadmap          the overview: columns, shipped, mine
 *   GET    /api/v1/feedback/similar?q=       existing requests like a draft title
 *   GET    /api/v1/feedback/:id              one request, its timeline and thread
 *   POST   /api/v1/feedback                  submit
 *   POST   /api/v1/feedback/:id/vote         "I want this too"   (409 if already)
 *   DELETE /api/v1/feedback/:id/vote         take it back
 *   POST   /api/v1/feedback/:id/replies      answer the product team
 *   POST   /api/v1/feedback/:id/read         mark the latest update seen
 *
 * ── The product team's side (platform admins only) ──────────────────────────
 *
 *   GET    /api/v1/admin/product-feedback             the queue, every agency
 *   GET    /api/v1/admin/product-feedback/summary     counts, agencies, owners
 *   GET    /api/v1/admin/product-feedback/:id         everything, internal notes too
 *   POST   /api/v1/admin/product-feedback             put an item on the roadmap
 *   PATCH  /api/v1/admin/product-feedback/:id         triage: status, priority, target...
 *   POST   /api/v1/admin/product-feedback/:id/comments  public update or internal note
 *   POST   /api/v1/admin/product-feedback/:id/merge     fold a duplicate into another
 *
 * ── Isolation ────────────────────────────────────────────────────────────────
 *
 * The agency routes take the tenant from the authenticated principal
 * (`resolveTenant`) and look every request up as `id AND visibleWhere(viewer)`
 * (services/product-feedback/access.ts), so another agency's private request
 * is a 404, not a 403: its existence is not confirmed. The serialisers there
 * decide what of a visible request each reader is shown; internal notes,
 * priority and the owner are never selected by an agency route at all.
 *
 * Every product-team change is audited with who, when, and the before and
 * after of each field (`product_feedback.*` in audit_logs), and every status a
 * request reaches is a `product_feedback_status_events` row: the timeline.
 */

import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_PRIORITIES,
  FEEDBACK_STATUSES,
  FEEDBACK_TARGET_KINDS,
  FEEDBACK_URGENCIES,
  FEEDBACK_VISIBILITIES,
  isFeedbackStatus,
  isIsoDate,
  normaliseTargetDate,
  type FeedbackStatus,
  type FeedbackTargetKind,
} from '@hopwhistle/shared';
import { Prisma } from '@prisma/client';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { requirePlatformAdmin } from '../lib/platform-context.js';
import { getPrismaClient } from '../lib/prisma.js';
import { getActingUserId, resolveTenant } from '../lib/tenant-context.js';
import { authenticate } from '../middleware/auth.js';
import { auditLog } from '../services/audit.js';
import {
  agencyCommentWhere,
  agencyItemView,
  agencyListInclude,
  buildViewer,
  canReply,
  isClosedStatus,
  personName,
  searchWhere,
  targetView,
  todayIso,
  visibleWhere,
  type FeedbackViewer,
} from '../services/product-feedback/access.js';
import { NOTIFY_STATUSES, notifyFeedbackFollowers } from '../services/product-feedback/notify.js';

// ── Validation ──────────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A nav entry's href ('/quote', '/insurance-leads') or 'other'. */
const PRODUCT_AREA = z
  .string()
  .max(64)
  .regex(/^(\/[a-z0-9-]+(\/[a-z0-9-]+)*|other)$/, 'productArea must be a product path or "other"');

const trimmed = (min: number, max: number, name: string) =>
  z
    .string()
    .trim()
    .min(min, `${name} must be at least ${min} characters`)
    .max(max, `${name} must be at most ${max} characters`);

/** What the browser may say about itself. Everything else it sends is dropped. */
const CLIENT_CONTEXT = z
  .object({
    viewport: z.string().max(20).optional(),
    timezone: z.string().max(64).optional(),
    userAgent: z.string().max(300).optional(),
    appVersion: z.string().max(64).optional(),
  })
  .strip();

const SubmitSchema = z.object({
  category: z.enum(FEEDBACK_CATEGORIES),
  title: trimmed(3, 140, 'title'),
  description: trimmed(10, 5000, 'description'),
  productArea: PRODUCT_AREA.nullish(),
  urgency: z.enum(FEEDBACK_URGENCIES).nullish(),
  sourceRoute: z
    .string()
    .max(200)
    .regex(/^\/[^\s]*$/, 'sourceRoute must be a path')
    .nullish(),
  clientContext: CLIENT_CONTEXT.nullish(),
});

const ReplySchema = z.object({ body: trimmed(1, 5000, 'body') });

const TargetSchema = z
  .object({ kind: z.enum(FEEDBACK_TARGET_KINDS), date: z.string().nullish() })
  .refine(t => t.kind === 'NONE' || isIsoDate(t.date), {
    message: 'target.date must be YYYY-MM-DD unless target.kind is NONE',
  });

const MessageSchema = z.object({
  headline: z.string().trim().max(80).nullish(),
  body: trimmed(1, 5000, 'message.body'),
});

const PatchSchema = z
  .object({
    status: z.enum(FEEDBACK_STATUSES).refine(s => s !== 'MERGED', {
      message: 'Merging is POST /merge, which moves the interest across',
    }),
    priority: z.enum(FEEDBACK_PRIORITIES),
    visibility: z.enum(FEEDBACK_VISIBILITIES),
    category: z.enum(FEEDBACK_CATEGORIES),
    productArea: PRODUCT_AREA.nullable(),
    publicTitle: z.string().trim().max(140).nullable(),
    publicSummary: z.string().trim().max(5000).nullable(),
    target: TargetSchema,
    assignedToUserId: z.string().max(64).nullable(),
    /** Said to the agency with this change: a question, an explanation, an update. */
    message: MessageSchema.nullable(),
  })
  .partial();

const StaffCommentSchema = z.object({
  kind: z.enum(['PUBLIC_UPDATE', 'INTERNAL_NOTE']),
  headline: z.string().trim().max(80).nullish(),
  body: trimmed(1, 5000, 'body'),
});

const StaffCreateSchema = z.object({
  title: trimmed(3, 140, 'title'),
  description: trimmed(10, 5000, 'description'),
  category: z.enum(FEEDBACK_CATEGORIES),
  productArea: PRODUCT_AREA.nullish(),
  status: z
    .enum(FEEDBACK_STATUSES)
    .refine(s => s !== 'MERGED', { message: 'A new item cannot start merged' })
    .default('PLANNED'),
  visibility: z.enum(FEEDBACK_VISIBILITIES).default('PUBLIC'),
  tenantId: z.string().max(64).nullish(),
  publicSummary: z.string().trim().max(5000).nullish(),
  target: TargetSchema.nullish(),
});

const MergeSchema = z.object({ targetId: z.string().regex(UUID, 'targetId must be an id') });

function validationError(reply: FastifyReply, error: z.ZodError) {
  const problems = error.issues.map(issue =>
    issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message
  );
  return reply.code(400).send({
    error: { code: 'VALIDATION_ERROR', message: problems.join('; '), problems },
  });
}

function notFound(reply: FastifyReply) {
  return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Feedback not found' } });
}

function conflict(reply: FastifyReply, code: string, message: string) {
  return reply.code(409).send({ error: { code, message } });
}

/** Statuses from a comma list, ignoring anything that is not one. */
function parseStatuses(raw: unknown): FeedbackStatus[] {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  return raw
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(isFeedbackStatus);
}

function parsePage(query: Record<string, unknown>, maxSize: number) {
  const page = Math.max(1, Math.floor(Number(query.page) || 1));
  const pageSize = Math.min(maxSize, Math.max(1, Math.floor(Number(query.pageSize) || 25)));
  return { page, pageSize, skip: (page - 1) * pageSize };
}

/** One person may send this many in a day; more is a script, not a person. */
const DAILY_SUBMISSION_LIMIT = 20;

/** How long a release stays under "Recently shipped". */
const RECENTLY_SHIPPED_DAYS = 90;

// ── The agency's viewer ─────────────────────────────────────────────────────

/**
 * The person asking, from the authenticated principal: their user, their
 * acting agency (`resolveTenant`, which refuses for itself) and their roles.
 * A buyer, a publisher or a read-only account is refused 403.
 */
function resolveViewer(request: FastifyRequest, reply: FastifyReply): FeedbackViewer | null {
  const tenantId = resolveTenant(request, reply);
  if (!tenantId) return null;
  const userId = getActingUserId(request);
  const roles = (request.user as { roles?: string[] } | undefined)?.roles;
  const viewer = userId ? buildViewer(userId, tenantId, roles) : null;
  if (!viewer) {
    void reply.code(403).send({
      error: {
        code: 'FORBIDDEN',
        message: "Feedback & Roadmap is for your agency's agents, managers and administrators.",
      },
    });
    return null;
  }
  return viewer;
}

async function markRead(userId: string, feedbackId: string): Promise<void> {
  await getPrismaClient().productFeedbackRead.upsert({
    where: { userId_feedbackId: { userId, feedbackId } },
    create: { userId, feedbackId, lastReadAt: new Date() },
    update: { lastReadAt: new Date() },
  });
}

// eslint-disable-next-line @typescript-eslint/require-await -- plugin signature
export async function registerProductFeedbackRoutes(fastify: FastifyInstance): Promise<void> {
  const prisma = getPrismaClient();

  /** One visible request as the agency detail view, or null when not visible. */
  async function agencyDetail(viewer: FeedbackViewer, id: string) {
    if (!UUID.test(id)) return null;
    const row = await prisma.productFeedback.findFirst({
      where: { AND: [{ id }, visibleWhere(viewer)] },
      include: {
        ...agencyListInclude(viewer),
        statusEvents: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { toStatus: true, createdAt: true },
        },
      },
    });
    if (!row) return null;

    const thread = await prisma.productFeedbackComment.findMany({
      where: { feedbackId: row.id, ...agencyCommentWhere(viewer, row) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        kind: true,
        headline: true,
        body: true,
        createdAt: true,
        authorUserId: true,
        author: { select: { firstName: true, lastName: true, email: true } },
      },
    });

    const view = agencyItemView(viewer, row);
    return {
      ...view,
      description: view.ownTenant ? row.description : (row.publicSummary ?? null),
      originalTitle: view.ownTenant && row.publicTitle ? row.title : null,
      urgency: view.ownTenant ? row.urgency : null,
      timeline: row.statusEvents.map(event => ({
        status: event.toStatus,
        at: event.createdAt.toISOString(),
      })),
      thread: thread.map(entry => ({
        id: entry.id,
        kind: entry.kind,
        headline: entry.headline,
        body: entry.body,
        createdAt: entry.createdAt.toISOString(),
        author:
          entry.kind !== 'USER_REPLY'
            ? 'Product Team'
            : entry.authorUserId === viewer.userId
              ? 'You'
              : viewer.orgAdmin
                ? (personName(entry.author) ?? 'Your agency')
                : 'Your agency',
      })),
      canReply: canReply(viewer, row),
      canVote: !isClosedStatus(row.status) && !view.isMine,
    };
  }

  // ── GET /api/v1/feedback ──────────────────────────────────────────────────
  fastify.get<{ Querystring: Record<string, unknown> }>(
    '/api/v1/feedback',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const viewer = resolveViewer(request, reply);
      if (!viewer) return;

      const query = request.query ?? {};
      const view = typeof query.view === 'string' ? query.view : 'all';
      if (!['all', 'mine', 'organization'].includes(view)) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'view must be all, mine or organization' },
        });
      }
      if (view === 'organization' && !viewer.orgAdmin) {
        return reply.code(403).send({
          error: { code: 'FORBIDDEN', message: "Only your agency's owner and admins see this." },
        });
      }
      const statuses = parseStatuses(query.status);
      const category =
        typeof query.category === 'string' &&
        (FEEDBACK_CATEGORIES as readonly string[]).includes(query.category)
          ? (query.category as (typeof FEEDBACK_CATEGORIES)[number])
          : undefined;
      const q = typeof query.q === 'string' ? query.q.trim().slice(0, 100) : '';
      const { page, pageSize, skip } = parsePage(query, 50);

      const and: Prisma.ProductFeedbackWhereInput[] = [visibleWhere(viewer)];
      if (view === 'mine')
        and.push({ tenantId: viewer.tenantId, submittedByUserId: viewer.userId });
      if (view === 'organization') and.push({ tenantId: viewer.tenantId });
      if (statuses.length > 0) and.push({ status: { in: statuses } });
      // A merged request lives on in its submitter's own list, pointing at the
      // one it joined; everywhere else it is the other request.
      else if (view !== 'mine') and.push({ status: { not: 'MERGED' } });
      if (category) and.push({ category });
      if (q) and.push(searchWhere(viewer, q));
      const where: Prisma.ProductFeedbackWhereInput = { AND: and };

      const shippedOnly = statuses.length > 0 && statuses.every(s => s === 'SHIPPED');
      const orderBy: Prisma.ProductFeedbackOrderByWithRelationInput[] =
        view === 'mine'
          ? [{ lastPublicActivityAt: 'desc' }, { id: 'asc' }]
          : shippedOnly
            ? [{ shippedAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }]
            : [{ lastPublicActivityAt: 'desc' }, { id: 'asc' }];

      const [rows, total] = await Promise.all([
        prisma.productFeedback.findMany({
          where,
          include: agencyListInclude(viewer),
          orderBy,
          skip,
          take: pageSize,
        }),
        prisma.productFeedback.count({ where }),
      ]);
      const today = todayIso();
      return reply.send({
        data: rows.map(row => agencyItemView(viewer, row, today)),
        meta: { page, pageSize, total },
      });
    }
  );

  // ── GET /api/v1/feedback/roadmap ──────────────────────────────────────────
  /**
   * The page's first screen in one request: what is in progress, planned and
   * under review, what shipped lately, and the viewer's own requests with how
   * many of them carry an update they have not opened.
   */
  fastify.get(
    '/api/v1/feedback/roadmap',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const viewer = resolveViewer(request, reply);
      if (!viewer) return;

      const visible = visibleWhere(viewer);
      const include = agencyListInclude(viewer);
      const shippedSince = new Date(Date.now() - RECENTLY_SHIPPED_DAYS * 86_400_000);
      const section = (
        statuses: FeedbackStatus[],
        extra: Prisma.ProductFeedbackWhereInput = {}
      ) => ({
        AND: [visible, { status: { in: statuses } }, extra],
      });
      const REVIEW: FeedbackStatus[] = ['NEW', 'UNDER_REVIEW', 'NEEDS_INFO', 'CONSIDERING'];
      const mineWhere: Prisma.ProductFeedbackWhereInput = {
        AND: [visible, { tenantId: viewer.tenantId, submittedByUserId: viewer.userId }],
      };
      const shippedWhere = section(['SHIPPED'], { shippedAt: { gte: shippedSince } });

      const [inProgress, planned, review, shipped, mine, counts, followed] = await Promise.all([
        prisma.productFeedback.findMany({
          where: section(['IN_PROGRESS', 'TESTING']),
          include,
          orderBy: [{ lastPublicActivityAt: 'desc' }, { id: 'asc' }],
          take: 12,
        }),
        prisma.productFeedback.findMany({
          where: section(['PLANNED']),
          include,
          orderBy: [
            { targetDate: { sort: 'asc', nulls: 'last' } },
            { lastPublicActivityAt: 'desc' },
            { id: 'asc' },
          ],
          take: 12,
        }),
        prisma.productFeedback.findMany({
          where: section(REVIEW),
          include,
          orderBy: [{ lastPublicActivityAt: 'desc' }, { id: 'asc' }],
          take: 12,
        }),
        prisma.productFeedback.findMany({
          where: shippedWhere,
          include,
          orderBy: [{ shippedAt: 'desc' }, { id: 'asc' }],
          take: 6,
        }),
        prisma.productFeedback.findMany({
          where: mineWhere,
          include,
          orderBy: [{ lastPublicActivityAt: 'desc' }, { id: 'asc' }],
          take: 6,
        }),
        Promise.all([
          prisma.productFeedback.count({ where: section(REVIEW) }),
          prisma.productFeedback.count({ where: section(['PLANNED']) }),
          prisma.productFeedback.count({ where: section(['IN_PROGRESS', 'TESTING']) }),
          prisma.productFeedback.count({ where: shippedWhere }),
          prisma.productFeedback.count({ where: mineWhere }),
        ]),
        // What the viewer follows -- sent, or said "I want this too" -- for the
        // unread count. The most recent 500 is every real person's whole list.
        prisma.productFeedback.findMany({
          where: {
            AND: [
              visible,
              {
                OR: [
                  { tenantId: viewer.tenantId, submittedByUserId: viewer.userId },
                  { votes: { some: { userId: viewer.userId } } },
                ],
              },
            ],
          },
          include,
          orderBy: [{ lastPublicActivityAt: 'desc' }, { id: 'asc' }],
          take: 500,
        }),
      ]);

      const today = todayIso();
      const view = (rows: typeof inProgress) => rows.map(row => agencyItemView(viewer, row, today));
      const [reviewCount, plannedCount, inProgressCount, shippedCount, mineCount] = counts;
      const followedViews = view(followed);
      return reply.send({
        data: {
          sections: {
            inProgress: { count: inProgressCount, items: view(inProgress) },
            planned: { count: plannedCount, items: view(planned) },
            underReview: { count: reviewCount, items: view(review) },
            recentlyShipped: { count: shippedCount, items: view(shipped) },
          },
          mine: { count: mineCount, items: view(mine) },
          unreadCount: followedViews.filter(item => item.unread).length,
          /** Of those, the viewer's own requests: the My Feedback badge. */
          mineUnreadCount: followedViews.filter(
            item => item.isMine && (item.unread || item.needsReply)
          ).length,
          needsReplyCount: followedViews.filter(item => item.needsReply).length,
          recentlyShippedDays: RECENTLY_SHIPPED_DAYS,
          viewer: { orgAdmin: viewer.orgAdmin },
        },
      });
    }
  );

  // ── GET /api/v1/feedback/similar ──────────────────────────────────────────
  /**
   * Requests this viewer can see whose title shares words with a draft title,
   * best first, at most three. Words of two letters or fewer, and the words
   * every request has ("the", "when", "would"), carry no signal and are dropped.
   */
  fastify.get<{ Querystring: { q?: string } }>(
    '/api/v1/feedback/similar',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const viewer = resolveViewer(request, reply);
      if (!viewer) return;

      const words = significantWords(String(request.query?.q ?? '').slice(0, 140));
      if (words.length === 0) return reply.send({ data: [] });

      const titleMatches = (word: string): Prisma.ProductFeedbackWhereInput => {
        const contains = { contains: word, mode: 'insensitive' as const };
        return {
          OR: [
            { publicTitle: contains },
            { publicTitle: null, title: contains },
            { tenantId: viewer.tenantId, title: contains },
          ],
        };
      };
      const rows = await prisma.productFeedback.findMany({
        where: {
          AND: [
            visibleWhere(viewer),
            { status: { notIn: ['MERGED', 'NOT_PLANNED'] } },
            { OR: words.map(titleMatches) },
          ],
        },
        include: agencyListInclude(viewer),
        orderBy: [{ lastPublicActivityAt: 'desc' }, { id: 'asc' }],
        take: 50,
      });

      const today = todayIso();
      const scored = rows
        .map(row => {
          const view = agencyItemView(viewer, row, today);
          const own = view.ownTenant ? row.title : '';
          const haystack = new Set(significantWords(`${view.title} ${own}`));
          const hits = words.filter(word => haystack.has(word)).length;
          return { view, score: hits / words.length, hits };
        })
        .filter(entry => entry.hits >= 2 || entry.score >= 0.5)
        .sort((a, b) => b.score - a.score || b.view.interestCount - a.view.interestCount)
        .slice(0, 3);
      return reply.send({ data: scored.map(entry => entry.view) });
    }
  );

  // ── GET /api/v1/feedback/:id ──────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/feedback/:id',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const viewer = resolveViewer(request, reply);
      if (!viewer) return;
      const detail = await agencyDetail(viewer, request.params.id);
      if (!detail) return notFound(reply);
      return reply.send({ data: detail });
    }
  );

  // ── POST /api/v1/feedback ─────────────────────────────────────────────────
  /**
   * 201 with the new request. The agency and the submitter come from the
   * session; a `tenantId` in the body is not read. It starts NEW and PRIVATE,
   * with the submitter as its first interested person.
   */
  fastify.post<{ Body: unknown }>(
    '/api/v1/feedback',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const viewer = resolveViewer(request, reply);
      if (!viewer) return;

      const parsed = SubmitSchema.safeParse(request.body ?? {});
      if (!parsed.success) return validationError(reply, parsed.error);
      const body = parsed.data;

      const since = new Date(Date.now() - 86_400_000);
      const recent = await prisma.productFeedback.count({
        where: { submittedByUserId: viewer.userId, createdAt: { gte: since } },
      });
      if (recent >= DAILY_SUBMISSION_LIMIT) {
        return reply.code(429).send({
          error: {
            code: 'TOO_MANY_SUBMISSIONS',
            message: `You have sent ${DAILY_SUBMISSION_LIMIT} pieces of feedback today. Please try again tomorrow.`,
          },
        });
      }

      const created = await prisma.$transaction(async tx => {
        const item = await tx.productFeedback.create({
          data: {
            tenantId: viewer.tenantId,
            submittedByUserId: viewer.userId,
            submittedByRole: [...viewer.roles].sort().join(',') || null,
            title: body.title,
            description: body.description,
            category: body.category,
            productArea: body.productArea ?? null,
            urgency: body.urgency ?? null,
            sourceRoute: body.sourceRoute ?? null,
            clientContext: body.clientContext
              ? (body.clientContext as Prisma.InputJsonValue)
              : Prisma.JsonNull,
          },
        });
        await tx.productFeedbackStatusEvent.create({
          data: { feedbackId: item.id, toStatus: 'NEW', actorUserId: viewer.userId },
        });
        await tx.productFeedbackVote.create({
          data: { feedbackId: item.id, userId: viewer.userId, tenantId: viewer.tenantId },
        });
        await tx.productFeedbackRead.create({
          data: { feedbackId: item.id, userId: viewer.userId },
        });
        return item;
      });

      await auditLog({
        tenantId: viewer.tenantId,
        userId: viewer.userId,
        action: 'product_feedback.submitted',
        entityType: 'product_feedback',
        entityId: created.id,
        changes: { category: created.category, productArea: created.productArea },
      });

      const detail = await agencyDetail(viewer, created.id);
      return reply.code(201).send({ data: detail });
    }
  );

  // ── POST /api/v1/feedback/:id/vote ────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>(
    '/api/v1/feedback/:id/vote',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const viewer = resolveViewer(request, reply);
      if (!viewer) return;
      const id = request.params.id;
      if (!UUID.test(id)) return notFound(reply);
      const item = await prisma.productFeedback.findFirst({
        where: { AND: [{ id }, visibleWhere(viewer)] },
        select: { id: true, status: true },
      });
      if (!item) return notFound(reply);
      if (isClosedStatus(item.status)) {
        return conflict(reply, 'CLOSED', 'This request is closed, so it is not taking interest.');
      }

      const already = await prisma.productFeedbackVote.findUnique({
        where: { feedbackId_userId: { feedbackId: id, userId: viewer.userId } },
        select: { id: true },
      });
      if (already) return conflict(reply, 'ALREADY_INTERESTED', 'You already want this.');
      try {
        await prisma.productFeedbackVote.create({
          data: { feedbackId: id, userId: viewer.userId, tenantId: viewer.tenantId },
        });
      } catch (error) {
        // Two presses at once: the unique (feedbackId, userId) key lets one in.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          return conflict(reply, 'ALREADY_INTERESTED', 'You already want this.');
        }
        throw error;
      }
      await markRead(viewer.userId, id);
      const interestCount = await prisma.productFeedbackVote.count({ where: { feedbackId: id } });
      return reply.code(201).send({ data: { interestCount, viewerInterested: true } });
    }
  );

  // ── DELETE /api/v1/feedback/:id/vote ──────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>(
    '/api/v1/feedback/:id/vote',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const viewer = resolveViewer(request, reply);
      if (!viewer) return;
      const id = request.params.id;
      if (!UUID.test(id)) return notFound(reply);
      const item = await prisma.productFeedback.findFirst({
        where: { AND: [{ id }, visibleWhere(viewer)] },
        select: { id: true, submittedByUserId: true, tenantId: true },
      });
      if (!item) return notFound(reply);
      if (item.tenantId === viewer.tenantId && item.submittedByUserId === viewer.userId) {
        return conflict(reply, 'SUBMITTER', 'You sent this one, so you are always following it.');
      }
      const { count } = await prisma.productFeedbackVote.deleteMany({
        where: { feedbackId: id, userId: viewer.userId },
      });
      if (count === 0) {
        return reply.code(404).send({
          error: { code: 'NOT_INTERESTED', message: 'You had not said you want this.' },
        });
      }
      const interestCount = await prisma.productFeedbackVote.count({ where: { feedbackId: id } });
      return reply.send({ data: { interestCount, viewerInterested: false } });
    }
  );

  // ── POST /api/v1/feedback/:id/replies ─────────────────────────────────────
  /** The submitter, or their agency's OWNER/ADMIN, answering the product team. */
  fastify.post<{ Params: { id: string }; Body: unknown }>(
    '/api/v1/feedback/:id/replies',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const viewer = resolveViewer(request, reply);
      if (!viewer) return;
      const id = request.params.id;
      if (!UUID.test(id)) return notFound(reply);
      const item = await prisma.productFeedback.findFirst({
        where: { AND: [{ id }, visibleWhere(viewer)] },
        select: { id: true, tenantId: true, submittedByUserId: true, status: true },
      });
      if (!item) return notFound(reply);
      if (!canReply(viewer, item)) {
        return reply.code(403).send({
          error: {
            code: 'FORBIDDEN',
            message: 'Only the person who sent this, or their agency administrators, can reply.',
          },
        });
      }
      const parsed = ReplySchema.safeParse(request.body ?? {});
      if (!parsed.success) return validationError(reply, parsed.error);

      const now = new Date();
      await prisma.$transaction([
        prisma.productFeedbackComment.create({
          data: {
            feedbackId: id,
            kind: 'USER_REPLY',
            authorUserId: viewer.userId,
            tenantId: viewer.tenantId,
            body: parsed.data.body,
          },
        }),
        prisma.productFeedback.update({ where: { id }, data: { lastUserReplyAt: now } }),
      ]);
      await markRead(viewer.userId, id);
      await auditLog({
        tenantId: viewer.tenantId,
        userId: viewer.userId,
        action: 'product_feedback.replied',
        entityType: 'product_feedback',
        entityId: id,
      });
      return reply.code(201).send({ data: await agencyDetail(viewer, id) });
    }
  );

  // ── POST /api/v1/feedback/:id/read ────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>(
    '/api/v1/feedback/:id/read',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const viewer = resolveViewer(request, reply);
      if (!viewer) return;
      const id = request.params.id;
      if (!UUID.test(id)) return notFound(reply);
      const item = await prisma.productFeedback.findFirst({
        where: { AND: [{ id }, visibleWhere(viewer)] },
        select: { id: true },
      });
      if (!item) return notFound(reply);
      await markRead(viewer.userId, id);
      return reply.send({ data: { read: true } });
    }
  );

  // ══ The product team ═════════════════════════════════════════════════════

  const staffInclude = {
    _count: { select: { votes: true } },
    tenant: { select: { id: true, name: true } },
    submittedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
    assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
    comments: {
      where: { kind: { in: ['PUBLIC_UPDATE', 'QUESTION'] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 1,
      select: { kind: true, headline: true, body: true, createdAt: true },
    },
  } satisfies Prisma.ProductFeedbackInclude;
  type StaffRow = Prisma.ProductFeedbackGetPayload<{ include: typeof staffInclude }>;

  function awaitingResponse(row: {
    lastUserReplyAt: Date | null;
    lastStaffReplyAt: Date | null;
    status: string;
  }) {
    if (!row.lastUserReplyAt || isClosedStatus(row.status)) return false;
    return !row.lastStaffReplyAt || row.lastUserReplyAt > row.lastStaffReplyAt;
  }

  function staffRowView(row: StaffRow, today = todayIso()) {
    const update = row.comments[0] ?? null;
    return {
      id: row.id,
      number: row.number,
      title: row.title,
      publicTitle: row.publicTitle,
      category: row.category,
      productArea: row.productArea,
      urgency: row.urgency,
      status: row.status,
      priority: row.priority,
      visibility: row.visibility,
      tenant: row.tenant,
      submittedBy: row.submittedBy
        ? {
            id: row.submittedBy.id,
            name: personName(row.submittedBy),
            email: row.submittedBy.email,
          }
        : null,
      submittedByRole: row.submittedByRole,
      assignedTo: row.assignedTo
        ? { id: row.assignedTo.id, name: personName(row.assignedTo) }
        : null,
      interestCount: row._count.votes,
      target: targetView(row.targetKind as FeedbackTargetKind, row.targetDate, today),
      awaitingResponse: awaitingResponse(row),
      latestUpdate: update
        ? {
            kind: update.kind,
            headline: update.headline,
            body: update.body.length > 200 ? `${update.body.slice(0, 199)}…` : update.body,
            createdAt: update.createdAt.toISOString(),
          }
        : null,
      mergedIntoId: row.mergedIntoId,
      shippedAt: row.shippedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      lastPublicActivityAt: row.lastPublicActivityAt.toISOString(),
      lastUserReplyAt: row.lastUserReplyAt?.toISOString() ?? null,
    };
  }

  async function staffDetail(id: string) {
    if (!UUID.test(id)) return null;
    const row = await prisma.productFeedback.findUnique({ where: { id }, include: staffInclude });
    if (!row) return null;
    const [extra, thread, events, votesByTenant] = await Promise.all([
      prisma.productFeedback.findUnique({
        where: { id },
        select: {
          description: true,
          publicSummary: true,
          sourceRoute: true,
          clientContext: true,
          mergedInto: { select: { id: true, number: true, title: true, publicTitle: true } },
          mergedFrom: {
            select: { id: true, number: true, title: true, tenant: { select: { name: true } } },
            orderBy: { createdAt: 'asc' },
          },
        },
      }),
      prisma.productFeedbackComment.findMany({
        where: { feedbackId: id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include: { author: { select: { firstName: true, lastName: true, email: true } } },
      }),
      prisma.productFeedbackStatusEvent.findMany({
        where: { feedbackId: id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include: { actor: { select: { firstName: true, lastName: true, email: true } } },
      }),
      prisma.productFeedbackVote.groupBy({
        by: ['tenantId'],
        where: { feedbackId: id },
        _count: { _all: true },
      }),
    ]);
    const tenantNames = new Map(
      (
        await prisma.tenant.findMany({
          where: { id: { in: votesByTenant.map(v => v.tenantId) } },
          select: { id: true, name: true },
        })
      ).map(t => [t.id, t.name])
    );
    return {
      ...staffRowView(row),
      description: extra?.description ?? '',
      publicSummary: extra?.publicSummary ?? null,
      sourceRoute: extra?.sourceRoute ?? null,
      clientContext: extra?.clientContext ?? null,
      mergedInto: extra?.mergedInto
        ? {
            id: extra.mergedInto.id,
            number: extra.mergedInto.number,
            title: extra.mergedInto.publicTitle ?? extra.mergedInto.title,
          }
        : null,
      mergedFrom: (extra?.mergedFrom ?? []).map(m => ({
        id: m.id,
        number: m.number,
        title: m.title,
        tenantName: m.tenant?.name ?? null,
      })),
      interestByTenant: votesByTenant
        .map(v => ({
          tenantId: v.tenantId,
          tenantName: tenantNames.get(v.tenantId) ?? 'Unknown agency',
          count: v._count._all,
        }))
        .sort((a, b) => b.count - a.count),
      thread: thread.map(entry => ({
        id: entry.id,
        kind: entry.kind,
        headline: entry.headline,
        body: entry.body,
        createdAt: entry.createdAt.toISOString(),
        author: personName(entry.author),
      })),
      timeline: events.map(event => ({
        from: event.fromStatus,
        status: event.toStatus,
        at: event.createdAt.toISOString(),
        actor: personName(event.actor),
      })),
    };
  }

  // ── GET /api/v1/admin/product-feedback ────────────────────────────────────
  fastify.get<{ Querystring: Record<string, unknown> }>(
    '/api/v1/admin/product-feedback',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const query = request.query ?? {};
      const str = (key: string) =>
        typeof query[key] === 'string' && query[key].trim() !== '' ? query[key].trim() : null;
      const and: Prisma.ProductFeedbackWhereInput[] = [];

      const statuses = parseStatuses(query.status);
      if (statuses.length > 0) and.push({ status: { in: statuses } });
      else and.push({ status: { not: 'MERGED' } });

      const tenantId = str('tenantId');
      if (tenantId === 'none') and.push({ tenantId: null });
      else if (tenantId) and.push({ tenantId });

      const category = str('category');
      if (category && (FEEDBACK_CATEGORIES as readonly string[]).includes(category)) {
        and.push({ category: category as (typeof FEEDBACK_CATEGORIES)[number] });
      }
      const priority = str('priority');
      if (priority && (FEEDBACK_PRIORITIES as readonly string[]).includes(priority)) {
        and.push({ priority: priority as (typeof FEEDBACK_PRIORITIES)[number] });
      }
      const visibility = str('visibility');
      if (visibility && (FEEDBACK_VISIBILITIES as readonly string[]).includes(visibility)) {
        and.push({ visibility: visibility as (typeof FEEDBACK_VISIBILITIES)[number] });
      }
      const area = str('productArea');
      if (area) and.push({ productArea: area === 'none' ? null : area });
      const owner = str('assignedToUserId');
      if (owner) and.push({ assignedToUserId: owner === 'none' ? null : owner });
      const from = str('from');
      if (from && isIsoDate(from)) and.push({ createdAt: { gte: new Date(`${from}T00:00:00Z`) } });
      const to = str('to');
      if (to && isIsoDate(to))
        and.push({
          createdAt: { lt: new Date(new Date(`${to}T00:00:00Z`).getTime() + 86_400_000) },
        });
      if (query.awaiting === '1' || query.awaiting === 'true') {
        and.push({
          status: { notIn: ['SHIPPED', 'NOT_PLANNED', 'MERGED'] },
          OR: [
            { lastUserReplyAt: { not: null }, lastStaffReplyAt: null },
            { lastUserReplyAt: { gt: prisma.productFeedback.fields.lastStaffReplyAt } },
          ],
        });
      }
      const q = str('q')?.slice(0, 100);
      if (q) {
        const contains = { contains: q, mode: 'insensitive' as const };
        const asNumber = /^#?\d+$/.test(q) ? Number(q.replace('#', '')) : null;
        and.push({
          OR: [
            { title: contains },
            { publicTitle: contains },
            { description: contains },
            { tenant: { name: contains } },
            { submittedBy: { email: contains } },
            ...(asNumber !== null && asNumber <= 2_147_483_647 ? [{ number: asNumber }] : []),
          ],
        });
      }

      const sort = str('sort') ?? 'recent';
      const orderBy: Prisma.ProductFeedbackOrderByWithRelationInput[] =
        sort === 'oldest'
          ? [{ createdAt: 'asc' }, { id: 'asc' }]
          : sort === 'newest'
            ? [{ createdAt: 'desc' }, { id: 'asc' }]
            : sort === 'interest'
              ? [{ votes: { _count: 'desc' } }, { updatedAt: 'desc' }, { id: 'asc' }]
              : sort === 'priority'
                ? [{ priority: 'desc' }, { updatedAt: 'desc' }, { id: 'asc' }]
                : [{ updatedAt: 'desc' }, { id: 'asc' }];
      const { page, pageSize, skip } = parsePage(query, 100);
      const where: Prisma.ProductFeedbackWhereInput = { AND: and };
      const [rows, total] = await Promise.all([
        prisma.productFeedback.findMany({
          where,
          include: staffInclude,
          orderBy,
          skip,
          take: pageSize,
        }),
        prisma.productFeedback.count({ where }),
      ]);
      const today = todayIso();
      return reply.send({
        data: rows.map(row => staffRowView(row, today)),
        meta: { page, pageSize, total },
      });
    }
  );

  // ── GET /api/v1/admin/product-feedback/summary ────────────────────────────
  fastify.get(
    '/api/v1/admin/product-feedback/summary',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (_request, reply) => {
      const today = todayIso();
      const monthStart = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
      const count = (where: Prisma.ProductFeedbackWhereInput) =>
        prisma.productFeedback.count({ where });
      const [
        fresh,
        review,
        needsInfo,
        planned,
        inProgress,
        awaiting,
        shippedThisMonth,
        byTenant,
        owners,
        areas,
      ] = await Promise.all([
        count({ status: 'NEW' }),
        count({ status: { in: ['UNDER_REVIEW', 'CONSIDERING'] } }),
        count({ status: 'NEEDS_INFO' }),
        count({ status: 'PLANNED' }),
        count({ status: { in: ['IN_PROGRESS', 'TESTING'] } }),
        count({
          status: { notIn: ['SHIPPED', 'NOT_PLANNED', 'MERGED'] },
          OR: [
            { lastUserReplyAt: { not: null }, lastStaffReplyAt: null },
            { lastUserReplyAt: { gt: prisma.productFeedback.fields.lastStaffReplyAt } },
          ],
        }),
        count({ status: 'SHIPPED', shippedAt: { gte: monthStart } }),
        prisma.productFeedback.groupBy({
          by: ['tenantId'],
          where: { tenantId: { not: null } },
          _count: { _all: true },
        }),
        prisma.platformAdmin.findMany({
          where: { user: { status: 'ACTIVE' } },
          select: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
        }),
        prisma.productFeedback.groupBy({
          by: ['productArea'],
          where: { productArea: { not: null } },
          _count: { _all: true },
        }),
      ]);
      const tenants = await prisma.tenant.findMany({
        where: { id: { in: byTenant.map(t => t.tenantId as string) } },
        select: { id: true, name: true, brandName: true },
      });
      const counts = new Map(byTenant.map(t => [t.tenantId, t._count._all]));
      return reply.send({
        data: {
          counts: {
            new: fresh,
            underReview: review,
            needsInfo,
            planned,
            inProgress,
            awaitingResponse: awaiting,
            shippedThisMonth,
          },
          tenants: tenants
            .map(t => ({ id: t.id, name: t.brandName || t.name, count: counts.get(t.id) ?? 0 }))
            .sort((a, b) => a.name.localeCompare(b.name)),
          owners: owners
            .map(o => ({ id: o.user.id, name: personName(o.user) ?? o.user.email }))
            .sort((a, b) => a.name.localeCompare(b.name)),
          productAreas: areas.map(a => a.productArea as string).sort(),
        },
      });
    }
  );

  // ── GET /api/v1/admin/product-feedback/:id ────────────────────────────────
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/admin/product-feedback/:id',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const detail = await staffDetail(request.params.id);
      if (!detail) return notFound(reply);
      return reply.send({ data: detail });
    }
  );

  // ── POST /api/v1/admin/product-feedback ───────────────────────────────────
  /** The product team putting something on the roadmap themselves. */
  fastify.post<{ Body: unknown }>(
    '/api/v1/admin/product-feedback',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const parsed = StaffCreateSchema.safeParse(request.body ?? {});
      if (!parsed.success) return validationError(reply, parsed.error);
      const body = parsed.data;
      const userId = getActingUserId(request);

      if (body.tenantId) {
        const tenant = await prisma.tenant.findUnique({
          where: { id: body.tenantId },
          select: { id: true },
        });
        if (!tenant) {
          return reply
            .code(400)
            .send({ error: { code: 'VALIDATION_ERROR', message: 'tenantId names no agency' } });
        }
      } else if (body.visibility !== 'PUBLIC') {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message:
              'An item that belongs to no agency must be on the public roadmap, or nobody could see it.',
          },
        });
      }
      const targetKind = (body.target?.kind ?? 'NONE') as FeedbackTargetKind;
      const targetIso = body.target
        ? normaliseTargetDate(targetKind, body.target.date ?? '')
        : null;

      const created = await prisma.$transaction(async tx => {
        const item = await tx.productFeedback.create({
          data: {
            tenantId: body.tenantId ?? null,
            submittedByUserId: null,
            title: body.title,
            description: body.description,
            publicSummary: body.publicSummary || null,
            category: body.category,
            productArea: body.productArea ?? null,
            status: body.status,
            visibility: body.visibility,
            targetKind,
            targetDate: targetIso ? new Date(`${targetIso}T00:00:00Z`) : null,
            shippedAt: body.status === 'SHIPPED' ? new Date() : null,
          },
        });
        await tx.productFeedbackStatusEvent.create({
          data: { feedbackId: item.id, toStatus: body.status, actorUserId: userId },
        });
        return item;
      });

      await auditLog({
        tenantId: created.tenantId,
        userId: userId ?? undefined,
        action: 'product_feedback.created_by_staff',
        entityType: 'product_feedback',
        entityId: created.id,
        changes: { status: created.status, visibility: created.visibility },
      });
      return reply.code(201).send({ data: await staffDetail(created.id) });
    }
  );

  // ── PATCH /api/v1/admin/product-feedback/:id ──────────────────────────────
  /**
   * Triage. Every field is optional; what is sent changes, what is not stays.
   *
   * `message` is said to the agency with the change. Moving to NEEDS_INFO
   * requires one -- it is the question -- and it is posted as a QUESTION the
   * submitter answers in the thread. With any other change it is posted as a
   * public update ("Why this isn't planned", "Released", or its own headline).
   */
  fastify.patch<{ Params: { id: string }; Body: unknown }>(
    '/api/v1/admin/product-feedback/:id',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const id = request.params.id;
      if (!UUID.test(id)) return notFound(reply);
      const parsed = PatchSchema.safeParse(request.body ?? {});
      if (!parsed.success) return validationError(reply, parsed.error);
      const body = parsed.data;

      const existing = await prisma.productFeedback.findUnique({ where: { id } });
      if (!existing) return notFound(reply);
      if (existing.status === 'MERGED') {
        return conflict(reply, 'MERGED', 'This request was merged into another; triage that one.');
      }

      const nextStatus = body.status ?? existing.status;
      const statusChanged = body.status !== undefined && body.status !== existing.status;
      if (statusChanged && nextStatus === 'NEEDS_INFO' && !body.message) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Asking for more information needs the question: send it as message.body.',
          },
        });
      }
      const nextVisibility = body.visibility ?? existing.visibility;
      if (existing.tenantId === null && nextVisibility !== 'PUBLIC') {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'An item that belongs to no agency must stay on the public roadmap.',
          },
        });
      }
      /*
       * Every agency reads a public request by its roadmap title, and the
       * submitter's own words stay inside their agency. So an agency's request
       * goes on the public roadmap only with a title the product team chose --
       * even if they chose the submitter's words.
       */
      const nextPublicTitle =
        body.publicTitle !== undefined ? body.publicTitle || null : existing.publicTitle;
      if (existing.tenantId !== null && nextVisibility === 'PUBLIC' && !nextPublicTitle) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message:
              'Give it a roadmap title before putting it on the public roadmap: every agency reads that title, never the submitter’s own.',
          },
        });
      }
      if (body.assignedToUserId) {
        const admin = await prisma.platformAdmin.findUnique({
          where: { userId: body.assignedToUserId },
          select: { id: true },
        });
        if (!admin) {
          return reply.code(400).send({
            error: { code: 'VALIDATION_ERROR', message: 'An owner must be on the product team.' },
          });
        }
      }

      const data: Prisma.ProductFeedbackUncheckedUpdateInput = {};
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      const track = (field: string, from: unknown, to: unknown) => {
        if (JSON.stringify(from) === JSON.stringify(to)) return false;
        before[field] = from;
        after[field] = to;
        return true;
      };

      if (statusChanged) {
        track('status', existing.status, nextStatus);
        data.status = nextStatus;
        if (nextStatus === 'SHIPPED') data.shippedAt = new Date();
        else if (existing.status === 'SHIPPED') data.shippedAt = null;
      }
      if (body.priority !== undefined && track('priority', existing.priority, body.priority)) {
        data.priority = body.priority;
      }
      if (
        body.visibility !== undefined &&
        track('visibility', existing.visibility, body.visibility)
      ) {
        data.visibility = body.visibility;
      }
      if (body.category !== undefined && track('category', existing.category, body.category)) {
        data.category = body.category;
      }
      if (
        body.productArea !== undefined &&
        track('productArea', existing.productArea, body.productArea)
      ) {
        data.productArea = body.productArea;
      }
      if (body.publicTitle !== undefined) {
        const value = body.publicTitle || null;
        if (track('publicTitle', existing.publicTitle, value)) data.publicTitle = value;
      }
      if (body.publicSummary !== undefined) {
        const value = body.publicSummary || null;
        if (track('publicSummary', existing.publicSummary, value)) data.publicSummary = value;
      }
      let targetChanged = false;
      if (body.target !== undefined) {
        const kind = body.target.kind as FeedbackTargetKind;
        const iso = normaliseTargetDate(kind, body.target.date ?? '');
        const existingIso = existing.targetDate?.toISOString().slice(0, 10) ?? null;
        targetChanged = track(
          'target',
          { kind: existing.targetKind, date: existingIso },
          { kind, date: iso }
        );
        if (targetChanged) {
          data.targetKind = kind;
          data.targetDate = iso ? new Date(`${iso}T00:00:00Z`) : null;
        }
      }
      if (
        body.assignedToUserId !== undefined &&
        track('assignedToUserId', existing.assignedToUserId, body.assignedToUserId)
      ) {
        data.assignedToUserId = body.assignedToUserId;
      }

      const message = body.message ?? null;
      if (Object.keys(after).length === 0 && !message) {
        return reply.send({ data: await staffDetail(id) });
      }

      const now = new Date();
      if (statusChanged || targetChanged || message) data.lastPublicActivityAt = now;
      if (message) data.lastStaffReplyAt = now;

      const userId = getActingUserId(request);
      await prisma.$transaction(async tx => {
        await tx.productFeedback.update({ where: { id }, data });
        if (statusChanged) {
          await tx.productFeedbackStatusEvent.create({
            data: {
              feedbackId: id,
              fromStatus: existing.status,
              toStatus: nextStatus,
              actorUserId: userId,
            },
          });
        }
        if (message) {
          const asks = statusChanged && nextStatus === 'NEEDS_INFO';
          await tx.productFeedbackComment.create({
            data: {
              feedbackId: id,
              kind: asks ? 'QUESTION' : 'PUBLIC_UPDATE',
              authorUserId: userId,
              headline:
                message.headline ||
                (asks
                  ? 'Question from the product team'
                  : statusChanged && nextStatus === 'NOT_PLANNED'
                    ? "Why this isn't planned"
                    : statusChanged && nextStatus === 'SHIPPED'
                      ? 'Released'
                      : null),
              body: message.body,
            },
          });
        }
      });

      await auditLog({
        tenantId: existing.tenantId,
        userId: userId ?? undefined,
        action: statusChanged ? 'product_feedback.status_changed' : 'product_feedback.updated',
        entityType: 'product_feedback',
        entityId: id,
        changes: { before, after, ...(message ? { message: true } : {}) },
      });

      if (statusChanged && NOTIFY_STATUSES.includes(nextStatus)) {
        await notifyFeedbackFollowers(id, {
          kind: 'STATUS',
          status: nextStatus,
          message: message?.body ?? null,
        });
      } else if (message) {
        await notifyFeedbackFollowers(id, {
          kind: 'UPDATE',
          headline: message.headline ?? null,
          body: message.body,
        });
      }

      return reply.send({ data: await staffDetail(id) });
    }
  );

  // ── POST /api/v1/admin/product-feedback/:id/comments ──────────────────────
  fastify.post<{ Params: { id: string }; Body: unknown }>(
    '/api/v1/admin/product-feedback/:id/comments',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const id = request.params.id;
      if (!UUID.test(id)) return notFound(reply);
      const parsed = StaffCommentSchema.safeParse(request.body ?? {});
      if (!parsed.success) return validationError(reply, parsed.error);
      const body = parsed.data;

      const existing = await prisma.productFeedback.findUnique({
        where: { id },
        select: { id: true, tenantId: true, status: true },
      });
      if (!existing) return notFound(reply);
      if (existing.status === 'MERGED' && body.kind === 'PUBLIC_UPDATE') {
        return conflict(
          reply,
          'MERGED',
          'Post public updates on the request this was merged into.'
        );
      }

      const userId = getActingUserId(request);
      const now = new Date();
      await prisma.$transaction([
        prisma.productFeedbackComment.create({
          data: {
            feedbackId: id,
            kind: body.kind,
            authorUserId: userId,
            headline: body.headline || null,
            body: body.body,
          },
        }),
        ...(body.kind === 'PUBLIC_UPDATE'
          ? [
              prisma.productFeedback.update({
                where: { id },
                data: { lastPublicActivityAt: now, lastStaffReplyAt: now },
              }),
            ]
          : [prisma.productFeedback.update({ where: { id }, data: { updatedAt: now } })]),
      ]);

      await auditLog({
        tenantId: existing.tenantId,
        userId: userId ?? undefined,
        action:
          body.kind === 'PUBLIC_UPDATE'
            ? 'product_feedback.public_update_posted'
            : 'product_feedback.internal_note_added',
        entityType: 'product_feedback',
        entityId: id,
      });
      if (body.kind === 'PUBLIC_UPDATE') {
        await notifyFeedbackFollowers(id, {
          kind: 'UPDATE',
          headline: body.headline ?? null,
          body: body.body,
        });
      }
      return reply.code(201).send({ data: await staffDetail(id) });
    }
  );

  // ── POST /api/v1/admin/product-feedback/:id/merge ─────────────────────────
  /**
   * Fold a duplicate into another request. Everybody interested in the
   * duplicate -- its submitter included -- becomes interested in the target,
   * so they follow it from now on, and the duplicate closes as MERGED,
   * pointing at it. The target must be one the duplicate's agency can read:
   * the same agency's, or on the public roadmap.
   */
  fastify.post<{ Params: { id: string }; Body: unknown }>(
    '/api/v1/admin/product-feedback/:id/merge',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const id = request.params.id;
      if (!UUID.test(id)) return notFound(reply);
      const parsed = MergeSchema.safeParse(request.body ?? {});
      if (!parsed.success) return validationError(reply, parsed.error);
      const targetId = parsed.data.targetId;
      if (targetId === id) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'A request cannot be merged into itself.' },
        });
      }

      const [source, target] = await Promise.all([
        prisma.productFeedback.findUnique({ where: { id } }),
        prisma.productFeedback.findUnique({ where: { id: targetId } }),
      ]);
      if (!source || !target) return notFound(reply);
      if (source.status === 'MERGED')
        return conflict(reply, 'MERGED', 'This request is already merged.');
      if (target.status === 'MERGED') {
        return conflict(
          reply,
          'TARGET_MERGED',
          'That request was itself merged; merge into the one it joined.'
        );
      }
      if (target.visibility !== 'PUBLIC' && target.tenantId !== source.tenantId) {
        return conflict(
          reply,
          'TARGET_NOT_VISIBLE',
          "The submitter's agency cannot see that request. Put it on the public roadmap first."
        );
      }

      const userId = getActingUserId(request);
      const now = new Date();
      await prisma.$transaction(async tx => {
        const votes = await tx.productFeedbackVote.findMany({
          where: { feedbackId: id },
          select: { userId: true, tenantId: true },
        });
        if (votes.length > 0) {
          await tx.productFeedbackVote.createMany({
            data: votes.map(v => ({
              feedbackId: targetId,
              userId: v.userId,
              tenantId: v.tenantId,
            })),
            skipDuplicates: true,
          });
        }
        await tx.productFeedback.update({
          where: { id },
          data: { status: 'MERGED', mergedIntoId: targetId, lastPublicActivityAt: now },
        });
        await tx.productFeedbackStatusEvent.create({
          data: {
            feedbackId: id,
            fromStatus: source.status,
            toStatus: 'MERGED',
            actorUserId: userId,
          },
        });
        await tx.productFeedback.update({ where: { id: targetId }, data: { updatedAt: now } });
      });

      await auditLog({
        tenantId: source.tenantId,
        userId: userId ?? undefined,
        action: 'product_feedback.merged',
        entityType: 'product_feedback',
        entityId: id,
        changes: {
          before: { status: source.status },
          after: { status: 'MERGED', mergedIntoId: targetId },
        },
      });
      await notifyFeedbackFollowers(id, {
        kind: 'MERGED',
        intoTitle: target.publicTitle ?? target.title,
      });
      return reply.send({ data: await staffDetail(id) });
    }
  );
}

// ── Similar-title matching ──────────────────────────────────────────────────

const STOPWORDS = new Set(
  (
    'the and for are but not you all any can had her was one our out has have this that with ' +
    'from they will would there their what when make like just into than then them some could ' +
    'should does doing very much more most also been being about after before over under where ' +
    'which while want need able get gets getting its it’s cant can’t dont don’t way ways thing things ' +
    'please add better improve new page ' +
    // How people describe friction, whatever the friction is: "takes too many
    // steps", "every time", "really hard". Matching on these matched everything.
    'too many take step click time long every one really always never hard difficult easy easier ' +
    'faster quick quicker issue problem work working doesn doesnt isn isnt see show'
  ).split(' ')
);

export function significantWords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    // Plurals match their singular: "reminders" finds "reminder" and back.
    .map(word => word.replace(/([^s])s$/, '$1'))
    .filter(word => word.length > 2 && !STOPWORDS.has(word));
  return [...new Set(words)];
}
