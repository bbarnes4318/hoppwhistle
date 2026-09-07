/**
 * Rating: what an agency is paid per submitted application, and why.
 *
 * ── Two surfaces, and the line between them ──────────────────────────────────
 *
 * `/api/v1/rating/*` is agency-scoped. It answers for the acting tenant and
 * nothing else, through the Phase 1 helper, and there is no parameter anywhere
 * on it that names an agency.
 *
 * `/api/v1/platform/rating/*` is platform-scoped and gated on the capability.
 * It is where the curve is published, where a review flag is cleared, and where
 * an agreed opening rate is recorded. An agency cannot reach any of it — in
 * particular it cannot clear its own review flag, which is the entire reason
 * that state exists.
 *
 * ── Nothing here accepts a price from the browser ────────────────────────────
 *
 * No route below reads a rate, an amount or a closing percentage from a request
 * and stores it as a computed figure. The two places a number does arrive from
 * a caller are both platform-only and both are INPUTS to the pricing rather
 * than outputs of it: the anchor points of a new curve version, and an opening
 * rate that was commercially agreed. Every rate an agency is actually paid is
 * derived server-side from counts the server made itself.
 */

import { FastifyInstance } from 'fastify';

import { requirePlatformAdmin } from '../lib/platform-context.js';
import { getPrismaClient } from '../lib/prisma.js';
import { getActingUserId, resolveTenant } from '../lib/tenant-context.js';
import { authenticate } from '../middleware/auth.js';
import { toNumber } from '../services/rating/rate-curve.js';
import {
  clearReviewFlag,
  loadActiveCurve,
  loadWindowSettings,
  recomputeFromRecord,
  runDailyRating,
} from '../services/rating/rating-engine.js';
import { getRatingSummary } from '../services/rating/rating-summary.js';

interface AnchorInput {
  closingPct: number;
  rate: number;
}

// eslint-disable-next-line @typescript-eslint/require-await -- plugin signature
export async function registerRatingRoutes(fastify: FastifyInstance): Promise<void> {
  const prisma = getPrismaClient();

  // ==========================================================================
  // Agency-scoped
  // ==========================================================================

  /**
   * GET /api/v1/rating/summary
   *
   * The agency portal's rating panel: today's live closing percentage, the
   * trailing window percentage that actually sets the rate, the current rate,
   * and the rate today is tracking toward for tomorrow.
   */
  fastify.get('/api/v1/rating/summary', { preHandler: [authenticate] }, async (request, reply) => {
    const tenantId = resolveTenant(request, reply);
    if (!tenantId) return;

    return reply.send({ data: await getRatingSummary(tenantId, { prisma }) });
  });

  /**
   * GET /api/v1/rating/history
   *
   * The immutable record, newest first. This is what an agency is shown when it
   * disputes a price, so every row carries the counts, the window and the curve
   * version it was priced from.
   */
  fastify.get<{ Querystring: { limit?: string } }>(
    '/api/v1/rating/history',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const tenantId = resolveTenant(request, reply);
      if (!tenantId) return;

      const limit = Math.min(Math.max(Number(request.query.limit ?? 60) || 60, 1), 365);

      const rows = await prisma.rateChange.findMany({
        where: { tenantId },
        orderBy: { effectiveCalendarDay: 'desc' },
        take: limit,
      });

      return reply.send({
        data: rows.map(row => ({
          id: row.id,
          effectiveCalendarDay: row.effectiveCalendarDay,
          // The actual Delivery Days, so a disputing agency can reconstruct the
          // window rather than being told "3 days" and left to guess which.
          windowDayKeys: row.windowDayKeys,
          windowDeliveryDays: row.windowDeliveryDays,
          windowDaysFound: row.windowDaysFound,
          deliveredCalls: row.deliveredCalls,
          submittedApplications: row.submittedApplications,
          closingPct: row.closingPct === null ? null : toNumber(row.closingPct),
          curveVersion: row.curveVersion,
          previousRate: row.previousRate === null ? null : toNumber(row.previousRate),
          newRate: row.newRate === null ? null : toNumber(row.newRate),
          status: row.status,
          computedAt: row.computedAt,
        })),
      });
    }
  );

  /**
   * GET /api/v1/rating/history/:id/recompute
   *
   * Re-derive one decision from its own stored values. The dispute answer: it
   * reads the row and the curve version the row names, and touches no live
   * data. `matchesStoredRate: false` would mean the record is not the record it
   * claims to be.
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/rating/history/:id/recompute',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const tenantId = resolveTenant(request, reply);
      if (!tenantId) return;

      // Scoped before the recompute: the id is a path parameter, and another
      // agency's pricing is not this agency's to read.
      const row = await prisma.rateChange.findFirst({
        where: { id: request.params.id, tenantId },
        select: { id: true },
      });

      if (!row) {
        return reply
          .code(404)
          .send({ error: { code: 'NOT_FOUND', message: 'Rate change not found' } });
      }

      return reply.send({ data: await recomputeFromRecord(row.id, prisma) });
    }
  );

  /**
   * GET /api/v1/rating/curve
   *
   * The curve an agency is priced against. Readable by the agency because
   * being able to check your own price against the published schedule is the
   * point; it names no other agency and carries no per-agency figure.
   */
  fastify.get('/api/v1/rating/curve', { preHandler: [authenticate] }, async (request, reply) => {
    const tenantId = resolveTenant(request, reply);
    if (!tenantId) return;

    const [curve, windowSettings] = await Promise.all([
      loadActiveCurve(prisma),
      loadWindowSettings(prisma),
    ]);

    return reply.send({
      data: {
        version: curve.version,
        minimumClosingPct: curve.minimumClosingPct,
        flatFromClosingPct: curve.flatFromClosingPct,
        introductoryRate: curve.introductoryRate,
        introductoryApplications: curve.introductoryApplications,
        windowDeliveryDays: windowSettings.windowDeliveryDays,
        deliveryDayLookback: windowSettings.deliveryDayLookback,
        anchors: curve.anchors,
      },
    });
  });

  // ==========================================================================
  // Platform-scoped
  // ==========================================================================

  /**
   * GET /api/v1/platform/rating/agencies
   *
   * Every agency's rating state at a glance, for the cross-agency view. This is
   * one of the surfaces a platform operator lands on when they have entered no
   * agency, so it must not require one.
   */
  fastify.get(
    '/api/v1/platform/rating/agencies',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (_request, reply) => {
      const [states, tenants, flags] = await Promise.all([
        prisma.agencyRatingState.findMany(),
        prisma.tenant.findMany({
          where: { status: 'ACTIVE' },
          select: { id: true, name: true, slug: true },
          orderBy: { name: 'asc' },
        }),
        prisma.ratingReviewFlag.findMany({ where: { clearedAt: null } }),
      ]);

      const stateByTenant = new Map(states.map(s => [s.tenantId, s]));
      const flagByTenant = new Map(flags.map(f => [f.tenantId, f]));

      return reply.send({
        data: tenants.map(tenant => {
          const state = stateByTenant.get(tenant.id);
          const flag = flagByTenant.get(tenant.id);
          return {
            tenantId: tenant.id,
            name: tenant.name,
            slug: tenant.slug,
            status: state?.status ?? 'INTRODUCTORY',
            currentRate: state?.currentRate == null ? null : toNumber(state.currentRate),
            currentRateCalendarDay: state?.currentRateCalendarDay ?? null,
            lastRatedCalendarDay: state?.lastRatedCalendarDay ?? null,
            openReviewFlag: flag
              ? {
                  id: flag.id,
                  raisedAt: flag.raisedAt,
                  closingPct: toNumber(flag.closingPct),
                }
              : null,
          };
        }),
      });
    }
  );

  /**
   * POST /api/v1/platform/rating/review-flags/:id/clear
   *
   * Clear a review flag. Platform staff only, and deliberately so: an agency
   * flagged for performing below the curve's minimum must not be able to
   * un-flag itself.
   *
   * Clearing does not set a rate. The next daily run prices the agency from the
   * curve; a price set by a button press is not a price derived from a
   * measurement.
   */
  fastify.post<{ Params: { id: string }; Body: { note?: string } }>(
    '/api/v1/platform/rating/review-flags/:id/clear',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const userId = getActingUserId(request);
      if (!userId) {
        return reply
          .code(401)
          .send({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      }

      const result = await clearReviewFlag({
        flagId: request.params.id,
        clearedByUserId: userId,
        note: typeof request.body?.note === 'string' ? request.body.note : undefined,
        prisma,
      });

      if (!result.cleared) {
        return reply.code(409).send({
          error: {
            code: 'NOT_CLEARABLE',
            message: result.tenantId
              ? 'That review flag is already cleared'
              : 'Review flag not found',
          },
        });
      }

      return reply.send({ data: { cleared: true, tenantId: result.tenantId } });
    }
  );

  /**
   * POST /api/v1/platform/rating/run
   *
   * Run the daily rating by hand, for the calendar day that just closed or a
   * named one.
   * Idempotent: a day already rated writes nothing and reports
   * `alreadyRated: true`.
   */
  fastify.post<{ Body: { closedCalendarDay?: string } }>(
    '/api/v1/platform/rating/run',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const closedCalendarDay = request.body?.closedCalendarDay;

      if (closedCalendarDay !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(closedCalendarDay)) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'closedCalendarDay must be YYYY-MM-DD',
          },
        });
      }

      return reply.send({ data: await runDailyRating({ closedCalendarDay, prisma }) });
    }
  );

  /**
   * POST /api/v1/platform/rating/curve
   *
   * Publish a new curve version. The anchors arrive in the body, which is the
   * one place a number legitimately comes from a caller: they are the pricing
   * schedule being agreed, not a computed amount being asserted.
   *
   * The previous version is retired rather than edited, so every rate already
   * applied still resolves against the curve that priced it.
   */
  fastify.post<{
    Body: {
      anchors?: AnchorInput[];
      minimumClosingPct?: number;
      flatFromClosingPct?: number;
      introductoryRate?: number;
      introductoryApplications?: number;
      label?: string;
      note?: string;
      windowDeliveryDays?: number;
    };
  }>(
    '/api/v1/platform/rating/curve',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const body = request.body ?? {};
      const anchors = Array.isArray(body.anchors) ? body.anchors : [];

      const valid =
        anchors.length >= 2 &&
        anchors.every(
          a =>
            typeof a?.closingPct === 'number' &&
            Number.isFinite(a.closingPct) &&
            typeof a?.rate === 'number' &&
            Number.isFinite(a.rate) &&
            a.rate > 0
        );

      if (!valid) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'anchors must be at least two { closingPct, rate } points with positive rates',
          },
        });
      }

      const sorted = [...anchors].sort((a, b) => a.closingPct - b.closingPct);
      const minimumClosingPct = body.minimumClosingPct ?? sorted[0].closingPct;
      const flatFromClosingPct =
        body.flatFromClosingPct ?? sorted[sorted.length - 1].closingPct;
      const introductoryRate = body.introductoryRate;
      const introductoryApplications = body.introductoryApplications;

      if (typeof introductoryRate !== 'number' || typeof introductoryApplications !== 'number') {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message:
              'introductoryRate and introductoryApplications are required: the opening package ' +
              'is configured separately from the anchors, never inferred from them',
          },
        });
      }

      const userId = getActingUserId(request);

      const created = await prisma.$transaction(async tx => {
        const highest = await tx.rateCurveVersion.findFirst({ orderBy: { version: 'desc' } });
        const version = (highest?.version ?? 0) + 1;

        const curve = await tx.rateCurveVersion.create({
          data: {
            version,
            label: body.label ?? null,
            note: body.note ?? null,
            minimumClosingPct,
            flatFromClosingPct,
            introductoryRate,
            introductoryApplications,
            createdById: userId,
            anchors: {
              create: sorted.map(a => ({ closingPct: a.closingPct, rate: a.rate })),
            },
          },
          include: { anchors: true },
        });

        // Retire the previous active version rather than deleting it: rates
        // already applied must keep resolving against the curve that priced
        // them.
        if (highest) {
          await tx.rateCurveVersion.updateMany({
            where: { id: highest.id, retiredAt: null },
            data: { retiredAt: new Date() },
          });
        }

        await tx.ratingSettings.upsert({
          where: { id: 'global' },
          create: {
            id: 'global',
            activeCurveVersionId: curve.id,
            windowDeliveryDays: body.windowDeliveryDays ?? 3,
          },
          update: {
            activeCurveVersionId: curve.id,
            ...(typeof body.windowDeliveryDays === 'number'
              ? { windowDeliveryDays: body.windowDeliveryDays }
              : {}),
          },
        });

        return curve;
      });

      return reply.code(201).send({
        data: {
          id: created.id,
          version: created.version,
          anchors: created.anchors.map(a => ({
            closingPct: toNumber(a.closingPct),
            rate: toNumber(a.rate),
          })),
        },
      });
    }
  );

  /**
   * PUT /api/v1/platform/rating/agencies/:tenantId/opening
   *
   * Record an agreed opening rate and opening block for one agency. This
   * supersedes the introductory package; daily rating begins from the first
   * settled day.
   *
   * The `:tenantId` names the agency being administered, not the caller's
   * acting tenant — the same shape as `quotas.ts`. Authority comes from the
   * capability.
   */
  fastify.put<{
    Params: { tenantId: string };
    Body: { openingRate?: number; openingBlockApplications?: number; note?: string };
  }>(
    '/api/v1/platform/rating/agencies/:tenantId/opening',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const { openingRate, openingBlockApplications } = request.body ?? {};

      if (typeof openingRate !== 'number' || !Number.isFinite(openingRate) || openingRate <= 0) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'openingRate must be a positive number' },
        });
      }

      const tenant = await prisma.tenant.findUnique({
        where: { id: request.params.tenantId },
        select: { id: true },
      });

      if (!tenant) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Agency not found' } });
      }

      const state = await prisma.agencyRatingState.upsert({
        where: { tenantId: tenant.id },
        create: {
          tenantId: tenant.id,
          status: 'OPENING_BLOCK',
          openingRate,
          openingBlockApplications: openingBlockApplications ?? null,
          openingAgreementNote: request.body?.note ?? null,
        },
        update: {
          status: 'OPENING_BLOCK',
          openingRate,
          openingBlockApplications: openingBlockApplications ?? null,
          openingAgreementNote: request.body?.note ?? null,
        },
      });

      return reply.send({
        data: {
          tenantId: state.tenantId,
          status: state.status,
          openingRate: state.openingRate === null ? null : toNumber(state.openingRate),
          openingBlockApplications: state.openingBlockApplications,
        },
      });
    }
  );
}
