/**
 * Phase 3: what an agency is charged, what it has left, and why delivery
 * stopped.
 *
 * ── Two surfaces, and the line between them ──────────────────────────────────
 *
 * `/api/v1/delivery/*` is agency-scoped. It answers for the acting tenant and
 * nothing else, through the Phase 1 helper, and no route on it takes a
 * parameter naming an agency.
 *
 * `/api/v1/platform/delivery/*` is platform-scoped and gated on the capability.
 * It is where a Daily Block, a maximum daily debit and an Overrun ceiling are
 * set, where an account is suspended and resumed, and where the settlement run
 * is triggered by hand. An agency cannot reach any of it -- in particular it
 * cannot raise its own ceiling or its own maximum debit, which is the entire
 * reason those live here.
 *
 * ── Nothing here accepts an amount from the browser ──────────────────────────
 *
 * No route below reads a rate, a charge or a quantity of credits from a request
 * and treats it as money owed. Every figure an agency is charged is derived
 * server-side from the ledger and the rating engine.
 *
 * Four numbers DO arrive from a caller, all four platform-only and all four
 * INPUTS to the pricing rather than assertions about it: an agency's Daily
 * Block quantity, its maximum daily debit, its Overrun ceiling percentage, and
 * the quantity and rate of an opening purchase that was commercially agreed.
 * Each of them can only ever make an agency cheaper to serve or limit what it
 * can be charged -- and each is written by a platform admin, audited, and
 * refused to an agency OWNER.
 *
 * ── The agent's own view has no money on it ──────────────────────────────────
 *
 * `GET /api/v1/delivery/me` returns an agent's calls, applications and closing
 * percentage against the agency average, and loads no rate, balance, overrun or
 * charge at all. That is a property of the query, not of the rendering.
 */

import { AchMandateStatus, Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

import { auditLog } from '../services/audit.js';
import { requirePlatformAdmin } from '../lib/platform-context.js';
import { getPrismaClient } from '../lib/prisma.js';
import { getActingUserId, resolveTenant } from '../lib/tenant-context.js';
import { authenticate } from '../middleware/auth.js';
import { paymentGateway } from '../services/billing/ach.js';
import { creditBalance, recordPurchase } from '../services/billing/credit-ledger.js';
import {
  getAgentBreakdown,
  getAgentSelfView,
  getDeliveryToday,
  getPlatformOverview,
} from '../services/billing/delivery-view.js';
import { runDailySettlement } from '../services/billing/settlement.js';
import { loadAgencyTerms, maxDailyDebitFor, overrunCeilingApplications } from '../services/billing/terms.js';
import { calendarDayOf, currentCalendarDay } from '../services/rating/calendar-day.js';
import { toNumber } from '../services/rating/rate-curve.js';

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A CSV cell that cannot be read as a formula by a spreadsheet. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  // A leading =, +, - or @ makes Excel and Sheets evaluate the cell. A
  // settlement export is a file a finance team opens, so it is quoted and
  // prefixed rather than trusted.
  const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
}

// eslint-disable-next-line @typescript-eslint/require-await -- plugin signature
export async function registerDeliveryBillingRoutes(fastify: FastifyInstance): Promise<void> {
  const prisma = getPrismaClient();

  // ==========================================================================
  // Agency-scoped
  // ==========================================================================

  /**
   * GET /api/v1/delivery/today
   *
   * The agency principal's live panel. Both closing percentages, both rates,
   * what is left on the block, the overrun and what it will cost tonight, the
   * distance to the ceiling, and the projected charge at settlement.
   */
  fastify.get('/api/v1/delivery/today', { preHandler: [authenticate] }, async (request, reply) => {
    const tenantId = resolveTenant(request, reply);
    if (!tenantId) return;

    return reply.send({ data: await getDeliveryToday(tenantId, { prisma }) });
  });

  /**
   * GET /api/v1/delivery/agents
   *
   * The per-agent table. Sorted by closing percentage; the client can re-sort,
   * but the default is the order a principal is looking for.
   */
  fastify.get<{ Querystring: { day?: string } }>(
    '/api/v1/delivery/agents',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const tenantId = resolveTenant(request, reply);
      if (!tenantId) return;

      const day = request.query.day;
      if (day !== undefined && !DAY_PATTERN.test(day)) {
        return reply
          .code(400)
          .send({ error: { code: 'VALIDATION_ERROR', message: 'day must be YYYY-MM-DD' } });
      }

      return reply.send({ data: await getAgentBreakdown(tenantId, { prisma, day }) });
    }
  );

  /**
   * GET /api/v1/delivery/me
   *
   * An agent's own numbers against the agency average. No pricing, no money.
   */
  fastify.get<{ Querystring: { day?: string } }>(
    '/api/v1/delivery/me',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const tenantId = resolveTenant(request, reply);
      if (!tenantId) return;

      const userId = getActingUserId(request);
      if (!userId) {
        return reply.code(401).send({
          error: { code: 'UNAUTHORIZED', message: 'This view is for a signed-in agent' },
        });
      }

      const day = request.query.day;
      if (day !== undefined && !DAY_PATTERN.test(day)) {
        return reply
          .code(400)
          .send({ error: { code: 'VALIDATION_ERROR', message: 'day must be YYYY-MM-DD' } });
      }

      return reply.send({ data: await getAgentSelfView(tenantId, userId, { prisma, day }) });
    }
  );

  /**
   * GET /api/v1/delivery/settlements
   *
   * One row per settled Delivery Day, newest first, carrying every figure from
   * the settlement record. This is what an agency disputing a charge is shown,
   * so nothing is summarised away.
   */
  fastify.get<{ Querystring: { limit?: string } }>(
    '/api/v1/delivery/settlements',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const tenantId = resolveTenant(request, reply);
      if (!tenantId) return;

      const limit = Math.min(Math.max(Number(request.query.limit ?? 90) || 90, 1), 400);

      const rows = await prisma.dailySettlement.findMany({
        where: { tenantId },
        orderBy: { deliveryDay: 'desc' },
        take: limit,
      });

      return reply.send({ data: rows.map(serialiseSettlement) });
    }
  );

  /**
   * GET /api/v1/delivery/settlements.csv
   *
   * The same rows, as a file. Every figure from the record, one row per settled
   * Delivery Day, so a finance team can reconcile without reading a screen.
   */
  fastify.get(
    '/api/v1/delivery/settlements.csv',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const tenantId = resolveTenant(request, reply);
      if (!tenantId) return;

      const rows = await prisma.dailySettlement.findMany({
        where: { tenantId },
        orderBy: { deliveryDay: 'desc' },
      });

      const header = [
        'delivery_day',
        'delivered_calls',
        'submitted_applications',
        'window_closing_pct',
        'window_delivery_days',
        'window_days_found',
        'window_day_keys',
        'rate',
        'curve_version',
        'overrun_quantity',
        'overrun_amount',
        'configured_block_quantity',
        'unused_paid_applications',
        'next_block_quantity',
        'next_block_amount',
        'total_charged',
        'max_daily_debit',
        'payment_status',
        'stripe_payment_intent_id',
        'paid_at',
        'grace_period_ends_on',
        'computed_at',
      ];

      const body = rows.map(row =>
        [
          row.deliveryDay,
          row.deliveredCalls,
          row.submittedApplications,
          row.windowClosingPct === null ? '' : toNumber(row.windowClosingPct),
          row.windowDeliveryDays,
          row.windowDaysFound,
          row.windowDayKeys.join(' '),
          row.rate === null ? '' : toNumber(row.rate),
          row.curveVersion ?? '',
          row.overrunQuantity,
          toNumber(row.overrunAmount),
          row.configuredBlockQuantity,
          row.unusedPaidApplications,
          row.nextBlockQuantity,
          toNumber(row.nextBlockAmount),
          toNumber(row.totalCharged),
          toNumber(row.maxDailyDebit),
          row.paymentStatus,
          row.stripePaymentIntentId ?? '',
          row.paidAt?.toISOString() ?? '',
          row.gracePeriodEndsOn ?? '',
          row.computedAt.toISOString(),
        ]
          .map(csvCell)
          .join(',')
      );

      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', 'attachment; filename="settlements.csv"')
        .send([header.map(csvCell).join(','), ...body].join('\n'));
    }
  );

  /**
   * GET /api/v1/delivery/ledger
   *
   * The agency's own credit ledger, newest first, and the balance derived from
   * it. An agency that cannot see the rows cannot check its own balance.
   */
  fastify.get<{ Querystring: { limit?: string } }>(
    '/api/v1/delivery/ledger',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const tenantId = resolveTenant(request, reply);
      if (!tenantId) return;

      const limit = Math.min(Math.max(Number(request.query.limit ?? 200) || 200, 1), 1000);

      const [rows, balance] = await Promise.all([
        prisma.applicationCreditLedgerEntry.findMany({
          where: { tenantId },
          orderBy: { createdAt: 'desc' },
          take: limit,
        }),
        creditBalance(prisma, tenantId),
      ]);

      return reply.send({
        data: {
          balance,
          entries: rows.map(row => ({
            id: row.id,
            entryType: row.entryType,
            quantity: row.quantity,
            deliveryDay: row.deliveryDay,
            unitRate: row.unitRate === null ? null : toNumber(row.unitRate),
            amount: row.amount === null ? null : toNumber(row.amount),
            curveVersion: row.curveVersion,
            applicationId: row.applicationId,
            stripePaymentIntentId: row.stripePaymentIntentId,
            settlementId: row.settlementId,
            createdAt: row.createdAt,
          })),
        },
      });
    }
  );

  /**
   * GET /api/v1/delivery/mandate
   *
   * Whether this agency has a usable ACH mandate. No mandate, no delivery, so
   * an agency has to be able to see the state of its own.
   */
  fastify.get('/api/v1/delivery/mandate', { preHandler: [authenticate] }, async (request, reply) => {
    const tenantId = resolveTenant(request, reply);
    if (!tenantId) return;

    const terms = await loadAgencyTerms(tenantId, { prisma });

    return reply.send({
      data: {
        status: terms.mandateStatus,
        valid: terms.hasValidMandate,
        bankName: terms.profile?.achBankName ?? null,
        last4: terms.profile?.achLast4 ?? null,
        verifiedAt: terms.profile?.achMandateVerifiedAt ?? null,
      },
    });
  });

  /**
   * POST /api/v1/delivery/mandate/setup-intent
   *
   * Begin collecting an ACH mandate. Returns a Stripe SetupIntent client secret
   * for the agency's browser to complete.
   *
   * The client secret authorises attaching a bank account to this agency's
   * customer and nothing else -- it cannot move money, and no amount is named
   * here or accepted from the caller.
   */
  fastify.post(
    '/api/v1/delivery/mandate/setup-intent',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const tenantId = resolveTenant(request, reply);
      if (!tenantId) return;

      const gateway = paymentGateway();
      if (!gateway.isEnabled()) {
        return reply.code(503).send({
          error: { code: 'STRIPE_DISABLED', message: 'Payments are not configured' },
        });
      }

      const [tenant, profile] = await Promise.all([
        prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
        prisma.agencyBillingProfile.findUnique({ where: { tenantId } }),
      ]);

      const customerId = await gateway.ensureCustomer({
        existingCustomerId: profile?.stripeCustomerId ?? null,
        name: tenant?.name ?? tenantId,
        metadata: { tenantId },
      });

      if (!customerId) {
        return reply.code(502).send({
          error: { code: 'STRIPE_ERROR', message: 'Could not create a Stripe customer' },
        });
      }

      const intent = await gateway.createAchSetupIntent(customerId);
      if (!intent) {
        return reply.code(502).send({
          error: { code: 'STRIPE_ERROR', message: 'Could not start bank verification' },
        });
      }

      await prisma.agencyBillingProfile.updateMany({
        where: { tenantId },
        data: { stripeCustomerId: customerId },
      });

      return reply.send({ data: { setupIntentId: intent.id, clientSecret: intent.clientSecret } });
    }
  );

  /**
   * POST /api/v1/delivery/mandate/confirm
   *
   * Record the mandate the agency just completed.
   *
   * The body names a SetupIntent and nothing else. Every fact written -- the
   * payment method id, the bank, the last four, whether it is usable at all --
   * is read back from Stripe by the server. A browser saying "I attached bank
   * account X" is a browser choosing which bank account a five-figure daily
   * debit comes out of, and it is not believed.
   */
  fastify.post<{ Body: { setupIntentId?: string } }>(
    '/api/v1/delivery/mandate/confirm',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const tenantId = resolveTenant(request, reply);
      if (!tenantId) return;

      const setupIntentId = request.body?.setupIntentId;
      if (typeof setupIntentId !== 'string' || setupIntentId.length === 0) {
        return reply
          .code(400)
          .send({ error: { code: 'VALIDATION_ERROR', message: 'setupIntentId is required' } });
      }

      const facts = await paymentGateway().describeAchMandate(setupIntentId);
      if (!facts) {
        return reply.code(502).send({
          error: { code: 'STRIPE_ERROR', message: 'Could not read the bank verification result' },
        });
      }

      const profile = await prisma.agencyBillingProfile.findUnique({ where: { tenantId } });
      if (!profile) {
        return reply.code(409).send({
          error: {
            code: 'NO_BILLING_PROFILE',
            message: 'This agency has no agreed terms yet. NetEnroll records those first.',
          },
        });
      }

      /*
       * The SetupIntent must belong to THIS agency's customer. Without this
       * check, an agency could confirm a SetupIntent id belonging to another
       * agency and attach that agency's bank account to its own profile.
       */
      if (facts.customerId && profile.stripeCustomerId && facts.customerId !== profile.stripeCustomerId) {
        return reply.code(403).send({
          error: {
            code: 'FORBIDDEN',
            message: 'That bank verification does not belong to this agency',
          },
        });
      }

      const updated = await prisma.agencyBillingProfile.update({
        where: { tenantId },
        data: {
          achPaymentMethodId: facts.paymentMethodId,
          achMandateStatus: facts.usable
            ? AchMandateStatus.ACTIVE
            : AchMandateStatus.PENDING_VERIFICATION,
          achMandateVerifiedAt: facts.usable ? new Date() : null,
          achBankName: facts.bankName,
          achLast4: facts.last4,
          stripeCustomerId: facts.customerId ?? profile.stripeCustomerId,
        },
      });

      return reply.send({
        data: {
          status: updated.achMandateStatus,
          valid: updated.achMandateStatus === AchMandateStatus.ACTIVE,
          bankName: updated.achBankName,
          last4: updated.achLast4,
        },
      });
    }
  );

  // ==========================================================================
  // Platform-scoped
  // ==========================================================================

  /**
   * GET /api/v1/platform/delivery/overview
   *
   * Every agency for one Delivery Day: calls, applications, closing percentage,
   * rate, revenue, call cost, margin, per-call figures, the flags that need
   * somebody to act, and where the settlement run got to.
   */
  fastify.get<{ Querystring: { day?: string } }>(
    '/api/v1/platform/delivery/overview',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const day = request.query.day;
      if (day !== undefined && !DAY_PATTERN.test(day)) {
        return reply
          .code(400)
          .send({ error: { code: 'VALIDATION_ERROR', message: 'day must be YYYY-MM-DD' } });
      }

      return reply.send({ data: await getPlatformOverview({ prisma, day }) });
    }
  );

  /**
   * GET /api/v1/platform/delivery/agencies/:tenantId/terms
   *
   * One agency's commercial terms, and the arithmetic behind them, so an
   * operator can see the Insertion Order figure the platform would compute
   * beside the one that was actually signed.
   */
  fastify.get<{ Params: { tenantId: string }; Querystring: { rate?: string } }>(
    '/api/v1/platform/delivery/agencies/:tenantId/terms',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const terms = await loadAgencyTerms(request.params.tenantId, { prisma });
      const rate = Number(request.query.rate);

      return reply.send({
        data: {
          tenantId: terms.tenantId,
          dailyBlockApplications: terms.dailyBlockApplications,
          ceilingPct: terms.ceilingPct,
          ceilingSource: terms.ceilingSource,
          ceilingApplications: terms.ceilingApplications,
          consecutiveCleanSettlements: terms.consecutiveCleanSettlements,
          maxDailyDebit: terms.maxDailyDebit,
          mandateStatus: terms.mandateStatus,
          hasValidMandate: terms.hasValidMandate,
          suspended: terms.suspended,
          suspensionReason: terms.suspensionReason,
          // What the maximum daily debit WOULD be at the rate asked about.
          // Offered so the contract figure and the platform figure come from
          // one arithmetic; it never overwrites the stored commitment.
          computedMaxDailyDebitAtRate: Number.isFinite(rate) && rate > 0
            ? maxDailyDebitFor(terms.dailyBlockApplications, terms.ceilingPct, rate)
            : null,
        },
      });
    }
  );

  /**
   * PUT /api/v1/platform/delivery/agencies/:tenantId/terms
   *
   * Record an agency's Daily Block, maximum daily debit and ceiling schedule.
   *
   * The `:tenantId` names the agency being administered, not the caller's
   * acting tenant -- the same shape as `quotas.ts`. Authority comes from the
   * capability.
   */
  fastify.put<{
    Params: { tenantId: string };
    Body: {
      dailyBlockApplications?: number;
      maxDailyDebit?: number;
      ceilingPctBelowThreshold?: number;
      ceilingPctAtThreshold?: number;
      ceilingCleanSettlementThreshold?: number;
    };
  }>(
    '/api/v1/platform/delivery/agencies/:tenantId/terms',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const body = request.body ?? {};
      const { tenantId } = request.params;

      const block = body.dailyBlockApplications;
      const maxDebit = body.maxDailyDebit;

      if (!Number.isInteger(block) || (block as number) < 0) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'dailyBlockApplications must be a whole number of applications, zero or more',
          },
        });
      }

      if (typeof maxDebit !== 'number' || !Number.isFinite(maxDebit) || maxDebit <= 0) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message:
              'maxDailyDebit must be a positive number of dollars. It is the figure on the ' +
              'Insertion Order, and a settlement above it halts rather than being clamped to it.',
          },
        });
      }

      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true },
      });
      if (!tenant) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Agency not found' } });
      }

      const fields = {
        dailyBlockApplications: block as number,
        maxDailyDebit: new Prisma.Decimal((maxDebit as number).toFixed(2)),
        ...(typeof body.ceilingPctBelowThreshold === 'number'
          ? { ceilingPctBelowThreshold: new Prisma.Decimal(body.ceilingPctBelowThreshold) }
          : {}),
        ...(typeof body.ceilingPctAtThreshold === 'number'
          ? { ceilingPctAtThreshold: new Prisma.Decimal(body.ceilingPctAtThreshold) }
          : {}),
        ...(Number.isInteger(body.ceilingCleanSettlementThreshold)
          ? { ceilingCleanSettlementThreshold: body.ceilingCleanSettlementThreshold as number }
          : {}),
      };

      const profile = await prisma.agencyBillingProfile.upsert({
        where: { tenantId },
        create: { tenantId, ...fields },
        update: fields,
      });

      await auditLog({
        tenantId,
        userId: getActingUserId(request) ?? undefined,
        action: 'platform.delivery.terms.updated',
        entityType: 'agency_billing_profile',
        entityId: profile.id,
        changes: {
          dailyBlockApplications: profile.dailyBlockApplications,
          maxDailyDebit: toNumber(profile.maxDailyDebit),
        },
      });

      return reply.send({
        data: {
          tenantId: profile.tenantId,
          dailyBlockApplications: profile.dailyBlockApplications,
          maxDailyDebit: toNumber(profile.maxDailyDebit),
          ceilingPctBelowThreshold: toNumber(profile.ceilingPctBelowThreshold),
          ceilingPctAtThreshold: toNumber(profile.ceilingPctAtThreshold),
          ceilingCleanSettlementThreshold: profile.ceilingCleanSettlementThreshold,
          overrunCeilingApplicationsBelowThreshold: overrunCeilingApplications(
            profile.dailyBlockApplications,
            toNumber(profile.ceilingPctBelowThreshold)
          ),
        },
      });
    }
  );

  /**
   * PUT /api/v1/platform/delivery/agencies/:tenantId/ceiling
   *
   * Reduce or withdraw an agency's Overrun ceiling.
   *
   * Overrun is credit extended at NetEnroll's discretion, so this can be done at
   * any time and `0` withdraws it entirely. Passing `null` returns the agency to
   * the clean-settlement schedule.
   */
  fastify.put<{
    Params: { tenantId: string };
    Body: { ceilingPctOverride?: number | null; note?: string };
  }>(
    '/api/v1/platform/delivery/agencies/:tenantId/ceiling',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const { tenantId } = request.params;
      const override = request.body?.ceilingPctOverride ?? null;

      if (override !== null && (typeof override !== 'number' || !Number.isFinite(override) || override < 0)) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'ceilingPctOverride must be zero or more, or null to use the schedule',
          },
        });
      }

      const existing = await prisma.agencyBillingProfile.findUnique({ where: { tenantId } });
      if (!existing) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: 'This agency has no recorded terms' },
        });
      }

      const profile = await prisma.agencyBillingProfile.update({
        where: { tenantId },
        data: {
          ceilingPctOverride: override === null ? null : new Prisma.Decimal(override),
          ceilingOverrideByUserId: getActingUserId(request),
          ceilingOverrideNote: request.body?.note ?? null,
          ceilingOverrideAt: override === null ? null : new Date(),
        },
      });

      await auditLog({
        tenantId,
        userId: getActingUserId(request) ?? undefined,
        action: 'platform.delivery.ceiling.updated',
        entityType: 'agency_billing_profile',
        entityId: profile.id,
        changes: { ceilingPctOverride: override, note: request.body?.note ?? null },
      });

      const terms = await loadAgencyTerms(tenantId, { prisma });
      return reply.send({
        data: {
          tenantId,
          ceilingPct: terms.ceilingPct,
          ceilingSource: terms.ceilingSource,
          ceilingApplications: terms.ceilingApplications,
        },
      });
    }
  );

  /**
   * POST /api/v1/platform/delivery/agencies/:tenantId/suspend
   * POST /api/v1/platform/delivery/agencies/:tenantId/resume
   *
   * Suspending pauses delivery immediately. It does NOT touch the ledger:
   * paid applications survive a suspension untouched and are available the
   * moment it is lifted.
   */
  fastify.post<{ Params: { tenantId: string }; Body: { reason?: string } }>(
    '/api/v1/platform/delivery/agencies/:tenantId/suspend',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const { tenantId } = request.params;
      const updated = await prisma.agencyBillingProfile.updateMany({
        where: { tenantId },
        data: {
          suspendedAt: new Date(),
          suspendedByUserId: getActingUserId(request),
          suspensionReason: request.body?.reason ?? null,
        },
      });

      if (updated.count === 0) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: 'This agency has no recorded terms' },
        });
      }

      await auditLog({
        tenantId,
        userId: getActingUserId(request) ?? undefined,
        action: 'platform.delivery.suspended',
        entityType: 'tenant',
        entityId: tenantId,
        changes: { reason: request.body?.reason ?? null },
      });

      return reply.send({ data: { tenantId, suspended: true } });
    }
  );

  fastify.post<{ Params: { tenantId: string } }>(
    '/api/v1/platform/delivery/agencies/:tenantId/resume',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const { tenantId } = request.params;
      const updated = await prisma.agencyBillingProfile.updateMany({
        where: { tenantId },
        data: { suspendedAt: null, suspendedByUserId: null, suspensionReason: null },
      });

      if (updated.count === 0) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: 'This agency has no recorded terms' },
        });
      }

      await auditLog({
        tenantId,
        userId: getActingUserId(request) ?? undefined,
        action: 'platform.delivery.resumed',
        entityType: 'tenant',
        entityId: tenantId,
      });

      return reply.send({ data: { tenantId, suspended: false } });
    }
  );

  /**
   * POST /api/v1/platform/delivery/agencies/:tenantId/opening-purchase
   *
   * The agency's opening block, at the agreed opening rate.
   *
   * This is the ONE place a card is permitted. Every daily settlement is ACH:
   * at roughly $8,978 a day on one account, card fees would run about $87,000 a
   * year, so the daily debit is ACH-only and this route is the exception, named
   * so that it cannot be reached for a settlement by accident.
   *
   * The quantity and the rate arrive from the caller because they are what was
   * commercially agreed before the agency's first Delivery Day -- the same shape
   * as an agreed opening rate on the rating side. They are platform-only and
   * audited, and no agency can reach this route.
   */
  fastify.post<{
    Params: { tenantId: string };
    Body: {
      quantity?: number;
      unitRate?: number;
      paymentMethodId?: string;
      method?: 'ACH' | 'CARD';
      deliveryDay?: string;
    };
  }>(
    '/api/v1/platform/delivery/agencies/:tenantId/opening-purchase',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const { tenantId } = request.params;
      const body = request.body ?? {};

      if (!Number.isInteger(body.quantity) || (body.quantity as number) <= 0) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'quantity must be a positive whole number' },
        });
      }
      if (typeof body.unitRate !== 'number' || !Number.isFinite(body.unitRate) || body.unitRate <= 0) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'unitRate must be a positive number' },
        });
      }
      if (body.deliveryDay !== undefined && !DAY_PATTERN.test(body.deliveryDay)) {
        return reply
          .code(400)
          .send({ error: { code: 'VALIDATION_ERROR', message: 'deliveryDay must be YYYY-MM-DD' } });
      }

      const profile = await prisma.agencyBillingProfile.findUnique({ where: { tenantId } });
      if (!profile) {
        return reply.code(409).send({
          error: {
            code: 'NO_BILLING_PROFILE',
            message: 'Record the agency terms before selling it an opening block',
          },
        });
      }

      const quantity = body.quantity as number;
      const unitRate = body.unitRate;
      const amount = Number((quantity * unitRate).toFixed(2));
      const deliveryDay = body.deliveryDay ?? currentCalendarDay();

      const gateway = paymentGateway();
      const paymentMethodId = body.paymentMethodId ?? profile.achPaymentMethodId;

      if (!profile.stripeCustomerId || !paymentMethodId) {
        return reply.code(409).send({
          error: {
            code: 'NO_PAYMENT_METHOD',
            message: 'This agency has no Stripe customer or payment method recorded',
          },
        });
      }

      const idempotencyKey = `opening:${tenantId}:${deliveryDay}:${quantity}:${unitRate}`;
      const charge =
        body.method === 'CARD'
          ? await gateway.chargeCardOnSession({
              customerId: profile.stripeCustomerId,
              paymentMethodId,
              amountCents: Math.round(amount * 100),
              description: `NetEnroll opening block ${deliveryDay}`,
              idempotencyKey,
              metadata: { tenantId, deliveryDay, kind: 'opening_purchase' },
            })
          : await gateway.chargeAchOffSession({
              customerId: profile.stripeCustomerId,
              paymentMethodId,
              amountCents: Math.round(amount * 100),
              description: `NetEnroll opening block ${deliveryDay}`,
              idempotencyKey,
              metadata: { tenantId, deliveryDay, kind: 'opening_purchase' },
            });

      if (!charge.ok) {
        return reply.code(402).send({
          error: {
            code: 'PAYMENT_FAILED',
            message: charge.failureMessage ?? 'The opening purchase was declined',
          },
        });
      }

      const entry = await recordPurchase(prisma, {
        tenantId,
        deliveryDay,
        quantity,
        unitRate,
        stripePaymentIntentId: charge.paymentIntentId,
        // No settlement sold this: it is the opening purchase, agreed before
        // the agency's first Delivery Day.
        settlementId: null,
      });

      await auditLog({
        tenantId,
        userId: getActingUserId(request) ?? undefined,
        action: 'platform.delivery.opening_purchase',
        entityType: 'application_credit_ledger',
        entityId: entry.id,
        changes: { quantity, unitRate, amount, method: body.method ?? 'ACH' },
      });

      return reply.code(201).send({
        data: {
          ledgerEntryId: entry.id,
          quantity,
          unitRate,
          amount,
          deliveryDay,
          balance: await creditBalance(prisma, tenantId),
        },
      });
    }
  );

  /**
   * POST /api/v1/platform/delivery/settlement/run
   *
   * The nightly run, by hand. Safe to call twice: the unique index on
   * (tenantId, deliveryDay) means a second call charges nobody.
   */
  fastify.post<{ Body: { deliveryDay?: string; tenantIds?: string[] } }>(
    '/api/v1/platform/delivery/settlement/run',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const deliveryDay = request.body?.deliveryDay;
      if (deliveryDay !== undefined && !DAY_PATTERN.test(deliveryDay)) {
        return reply
          .code(400)
          .send({ error: { code: 'VALIDATION_ERROR', message: 'deliveryDay must be YYYY-MM-DD' } });
      }

      const result = await runDailySettlement({
        deliveryDay,
        prisma,
        tenantIds: request.body?.tenantIds,
      });

      await auditLog({
        tenantId: null,
        userId: getActingUserId(request) ?? undefined,
        action: 'platform.delivery.settlement.run',
        entityType: 'daily_settlement',
        entityId: result.deliveryDay,
        changes: { settled: result.results.length, failures: result.failures.length },
      });

      return reply.send({ data: result });
    }
  );

  /**
   * GET /api/v1/platform/delivery/settlements
   *
   * Every agency's settlements for one Delivery Day, including the ones that
   * halted, so the run's status is answerable in one request.
   */
  fastify.get<{ Querystring: { day?: string } }>(
    '/api/v1/platform/delivery/settlements',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const day = request.query.day ?? calendarDayOf(new Date());
      if (!DAY_PATTERN.test(day)) {
        return reply
          .code(400)
          .send({ error: { code: 'VALIDATION_ERROR', message: 'day must be YYYY-MM-DD' } });
      }

      const rows = await prisma.dailySettlement.findMany({
        where: { deliveryDay: day },
        include: { attempts: { orderBy: { attemptNumber: 'asc' } } },
      });

      return reply.send({
        data: rows.map(row => ({
          ...serialiseSettlement(row),
          attempts: row.attempts.map(attempt => ({
            attemptNumber: attempt.attemptNumber,
            status: attempt.status,
            amount: toNumber(attempt.amount),
            failureCode: attempt.failureCode,
            failureMessage: attempt.failureMessage,
            occurredAt: attempt.occurredAt,
          })),
        })),
      });
    }
  );
}

/** One settlement row, with every figure it was written with. */
function serialiseSettlement(row: {
  id: string;
  tenantId: string;
  deliveryDay: string;
  deliveredCalls: number;
  submittedApplications: number;
  windowClosingPct: Prisma.Decimal | null;
  windowDeliveryDays: number;
  windowDaysFound: number;
  windowDayKeys: string[];
  rate: Prisma.Decimal | null;
  curveVersion: number | null;
  rateChangeId: string | null;
  overrunQuantity: number;
  overrunAmount: Prisma.Decimal;
  configuredBlockQuantity: number;
  unusedPaidApplications: number;
  nextBlockQuantity: number;
  nextBlockAmount: Prisma.Decimal;
  totalCharged: Prisma.Decimal;
  maxDailyDebit: Prisma.Decimal;
  paymentStatus: string;
  stripePaymentIntentId: string | null;
  paymentFailureCode: string | null;
  paymentFailureMessage: string | null;
  paidAt: Date | null;
  gracePeriodEndsOn: string | null;
  computedAt: Date;
}): Record<string, unknown> {
  return {
    id: row.id,
    tenantId: row.tenantId,
    deliveryDay: row.deliveryDay,
    deliveredCalls: row.deliveredCalls,
    submittedApplications: row.submittedApplications,
    windowClosingPct: row.windowClosingPct === null ? null : toNumber(row.windowClosingPct),
    windowDeliveryDays: row.windowDeliveryDays,
    windowDaysFound: row.windowDaysFound,
    windowDayKeys: row.windowDayKeys,
    rate: row.rate === null ? null : toNumber(row.rate),
    curveVersion: row.curveVersion,
    rateChangeId: row.rateChangeId,
    overrunQuantity: row.overrunQuantity,
    overrunAmount: toNumber(row.overrunAmount),
    configuredBlockQuantity: row.configuredBlockQuantity,
    unusedPaidApplications: row.unusedPaidApplications,
    nextBlockQuantity: row.nextBlockQuantity,
    nextBlockAmount: toNumber(row.nextBlockAmount),
    totalCharged: toNumber(row.totalCharged),
    maxDailyDebit: toNumber(row.maxDailyDebit),
    paymentStatus: row.paymentStatus,
    stripePaymentIntentId: row.stripePaymentIntentId,
    paymentFailureCode: row.paymentFailureCode,
    paymentFailureMessage: row.paymentFailureMessage,
    paidAt: row.paidAt,
    gracePeriodEndsOn: row.gracePeriodEndsOn,
    computedAt: row.computedAt,
  };
}
