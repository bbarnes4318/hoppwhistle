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
 * ── Enrolment is the opt-in, and it is here ──────────────────────────────────
 *
 * An agency is subject to the billing system only once a platform admin enrols
 * it, and enrolment is refused unless the terms, the Daily Block, the maximum
 * daily debit, the agreed opening rate and a valid ACH mandate are all already
 * in place -- because enrolment takes effect on the next call offered, and
 * enrolling an agency that fails any of those stops its phones that second.
 *
 * Charging is a second switch on top, off by default, so an enrolled agency can
 * be watched settling for as long as it takes before money moves.
 *
 * ── The agent's own view has no money on it ──────────────────────────────────
 *
 * `GET /api/v1/delivery/me` returns an agent's calls, applications and closing
 * percentage against the agency average, and loads no rate, balance, overrun or
 * charge at all. That is a property of the query, not of the rendering.
 *
 * ── And every other agency route here is the principal's ─────────────────────
 *
 * Everything on `/api/v1/delivery/*` except `/me` now carries
 * `requireAgencyPrincipal`. These routes were `[authenticate]` and nothing else,
 * which made an agency's rate, balance, overrun, projected charge and full
 * settlement history readable by any AGENT holding a token in the tenant -- and
 * made the mandate endpoints writable by one, so an agent could attach the bank
 * account the nightly ACH debit comes from. `/me` is the one exception because
 * it is the agent's own view and has no money on it.
 */

import {
  AchMandateStatus,
  AgencyPaymentMethod,
  Prisma,
  SettlementPaymentStatus,
} from '@prisma/client';
import type { FastifyInstance } from 'fastify';

import { requireAgencyPrincipal, requirePlatformAdmin } from '../lib/platform-context.js';
import { getPrismaClient } from '../lib/prisma.js';
import { getActingTenantId, getActingUserId, resolveTenant } from '../lib/tenant-context.js';
import { authenticate } from '../middleware/auth.js';
import { auditLog } from '../services/audit.js';
import { paymentGateway } from '../services/billing/ach.js';
import {
  closeOutDryRunLots,
  creditBalance,
  previewDryRunCloseout,
  recordPurchase,
} from '../services/billing/credit-ledger.js';
import {
  getAgentBreakdown,
  getAgentSelfView,
  getSettlementDerivation,
  getDeliveryToday,
  getPlatformOverview,
} from '../services/billing/delivery-view.js';
import { standDownDispute } from '../services/billing/disputes.js';
import { runDailySettlement } from '../services/billing/settlement.js';
import {
  enrolmentBlockersFor,
  loadAgencyTerms,
  maxDailyDebitFor,
  overrunCeilingApplications,
} from '../services/billing/terms.js';
import { currentCalendarDay } from '../services/rating/calendar-day.js';
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
  fastify.get('/api/v1/delivery/today', { preHandler: [authenticate, requireAgencyPrincipal] }, async (request, reply) => {
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
    { preHandler: [authenticate, requireAgencyPrincipal] },
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
    { preHandler: [authenticate, requireAgencyPrincipal] },
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
   * GET /api/v1/delivery/settlements/:settlementId/derivation
   *
   * How one settlement's rate was arrived at: the Delivery Days the trailing
   * window covered, each day's call and application counts, the totals they sum
   * to, and the rate the curve version named on the settlement returns for that
   * percentage.
   *
   * This is what an agency disputing a charge is shown. It reports the stored
   * figures AND re-measures the window, then says whether the two agree -- a
   * page that only re-prints the stored rate proves nothing. The curve is
   * loaded by the settlement's own `curveVersionId`, never by whichever curve
   * is active now.
   *
   * Scoped by tenant inside the query, so an agency cannot read another
   * agency's settlement by guessing an id.
   */
  fastify.get<{ Params: { settlementId: string } }>(
    '/api/v1/delivery/settlements/:settlementId/derivation',
    { preHandler: [authenticate, requireAgencyPrincipal] },
    async (request, reply) => {
      const tenantId = resolveTenant(request, reply);
      if (!tenantId) return;

      const derivation = await getSettlementDerivation(
        tenantId,
        request.params.settlementId,
        { prisma }
      );

      if (!derivation) {
        return reply
          .code(404)
          .send({ error: { code: 'NOT_FOUND', message: 'No such settlement for this agency' } });
      }

      return reply.send({ data: derivation });
    }
  );

  /**
   * GET /api/v1/delivery/settlements.csv?from=&to=
   *
   * The same rows, as a file. Every figure from the record, one row per settled
   * Delivery Day, so a finance team can reconcile without reading a screen.
   *
   * `from` and `to` are inclusive Delivery Days. Omitting both exports
   * everything, which is what a finance team reconciling a first month wants;
   * a malformed one is refused rather than silently ignored, because an export
   * that quietly widened its own range is one somebody invoices from.
   */
  fastify.get<{ Querystring: { from?: string; to?: string } }>(
    '/api/v1/delivery/settlements.csv',
    { preHandler: [authenticate, requireAgencyPrincipal] },
    async (request, reply) => {
      const tenantId = resolveTenant(request, reply);
      if (!tenantId) return;

      const { from, to } = request.query;
      for (const [name, value] of [
        ['from', from],
        ['to', to],
      ] as const) {
        if (value !== undefined && !DAY_PATTERN.test(value)) {
          return reply.code(400).send({
            error: { code: 'VALIDATION_ERROR', message: `${name} must be YYYY-MM-DD` },
          });
        }
      }

      const rows = await prisma.dailySettlement.findMany({
        where: {
          tenantId,
          ...(from || to
            ? { deliveryDay: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
            : {}),
        },
        orderBy: { deliveryDay: 'desc' },
      });

      const body = rows.map(row => settlementCsvRow(row).map(csvCell).join(','));

      // `from` and `to` are pattern-checked above, so nothing but YYYY-MM-DD
      // reaches the header.
      const filename = `settlements-${from ?? 'start'}-to-${to ?? 'today'}.csv`;

      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send([SETTLEMENT_CSV_COLUMNS.map(csvCell).join(','), ...body].join('\n'));
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
    { preHandler: [authenticate, requireAgencyPrincipal] },
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
  fastify.get('/api/v1/delivery/mandate', { preHandler: [authenticate, requireAgencyPrincipal] }, async (request, reply) => {
    const tenantId = resolveTenant(request, reply);
    if (!tenantId) return;

    const terms = await loadAgencyTerms(tenantId, { prisma });
    const payingByCard = terms.paymentMethod === AgencyPaymentMethod.CARD;

    return reply.send({
      data: {
        /*
         * The instrument this agency actually pays with. `status` and `valid`
         * answer for THAT one -- a card-paying agency reading "no mandate"
         * because it has no bank account on file would be reading a defect that
         * is not there.
         */
        paymentMethod: terms.paymentMethod,
        status: terms.mandateStatus,
        valid: terms.hasValidMandate,
        bankName: payingByCard ? null : terms.profile?.achBankName ?? null,
        cardBrand: payingByCard ? terms.profile?.cardBrand ?? null : null,
        last4: payingByCard
          ? terms.profile?.cardLast4 ?? null
          : terms.profile?.achLast4 ?? null,
        verifiedAt: payingByCard
          ? terms.profile?.cardMandateVerifiedAt ?? null
          : terms.profile?.achMandateVerifiedAt ?? null,
      },
    });
  });

  /**
   * POST /api/v1/delivery/card/setup-intent
   * POST /api/v1/delivery/card/confirm
   *
   * The card equivalent of the ACH mandate pair above, on exactly the same
   * terms.
   *
   * The client secret authorises attaching a card to this agency's customer and
   * nothing else: it moves no money and names no amount. The confirm body takes
   * a SetupIntent id and NOTHING ELSE -- the brand, the last four and whether
   * the card can be debited off-session are all read back from Stripe by the
   * server. A browser saying "I attached card X" is a browser choosing which
   * card a five-figure daily debit comes out of.
   *
   * Saving a card does not change what the agency is priced at. The rate offset
   * is a separate term a platform admin records; nothing on this path sets one.
   */
  fastify.post(
    '/api/v1/delivery/card/setup-intent',
    { preHandler: [authenticate, requireAgencyPrincipal] },
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

      const intent = await gateway.createCardSetupIntent(customerId);
      if (!intent) {
        return reply.code(502).send({
          error: { code: 'STRIPE_ERROR', message: 'Could not start card verification' },
        });
      }

      await prisma.agencyBillingProfile.updateMany({
        where: { tenantId },
        data: { stripeCustomerId: customerId },
      });

      return reply.send({ data: { setupIntentId: intent.id, clientSecret: intent.clientSecret } });
    }
  );

  fastify.post<{ Body: { setupIntentId?: string } }>(
    '/api/v1/delivery/card/confirm',
    { preHandler: [authenticate, requireAgencyPrincipal] },
    async (request, reply) => {
      const tenantId = resolveTenant(request, reply);
      if (!tenantId) return;

      const setupIntentId = request.body?.setupIntentId;
      if (typeof setupIntentId !== 'string' || setupIntentId.length === 0) {
        return reply
          .code(400)
          .send({ error: { code: 'VALIDATION_ERROR', message: 'setupIntentId is required' } });
      }

      const facts = await paymentGateway().describeCardMandate(setupIntentId);
      if (!facts) {
        return reply.code(502).send({
          error: { code: 'STRIPE_ERROR', message: 'Could not read the card verification result' },
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
       * The SetupIntent must belong to THIS agency's customer -- the same check
       * the bank mandate makes, for the same reason: without it one agency
       * could confirm another's SetupIntent id and attach that agency's card to
       * its own profile.
       */
      if (
        facts.customerId &&
        profile.stripeCustomerId &&
        facts.customerId !== profile.stripeCustomerId
      ) {
        return reply.code(403).send({
          error: {
            code: 'FORBIDDEN',
            message: 'That card verification does not belong to this agency',
          },
        });
      }

      const updated = await prisma.agencyBillingProfile.update({
        where: { tenantId },
        data: {
          cardPaymentMethodId: facts.paymentMethodId,
          cardMandateStatus: facts.usable
            ? AchMandateStatus.ACTIVE
            : AchMandateStatus.PENDING_VERIFICATION,
          cardMandateVerifiedAt: facts.usable ? new Date() : null,
          cardBrand: facts.brand,
          cardLast4: facts.last4,
          stripeCustomerId: facts.customerId ?? profile.stripeCustomerId,
        },
      });

      return reply.send({
        data: {
          status: updated.cardMandateStatus,
          valid: updated.cardMandateStatus === AchMandateStatus.ACTIVE,
          cardBrand: updated.cardBrand,
          last4: updated.cardLast4,
        },
      });
    }
  );

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
    { preHandler: [authenticate, requireAgencyPrincipal] },
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
    { preHandler: [authenticate, requireAgencyPrincipal] },
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
   * what is left on the block, the day's overrun, the distance to the ceiling,
   * the current rate and the offset in it, revenue, call cost, margin, per-call
   * figures, the flags that need somebody to act, and where the settlement run
   * got to. Platform totals across the top.
   *
   * ── This is where a platform admin lands ─────────────────────────────────
   *
   * NetEnroll staff run the whole platform. An operator with no acting tenant
   * gets every agency here rather than a prompt to choose one; entering an
   * agency narrows this same view to that agency, and leaving returns to all of
   * them. The switcher is a filter, not a gate.
   *
   * The narrowing comes from the ACTING TENANT on the session -- the Phase 1
   * helper -- and never from a query parameter. `?tenantId=` would be a second
   * way to answer "whose data is this", which is the thing Phase 1 removed.
   *
   * `?includeNonProduction=true` lists the demo and fixture tenants as well.
   * They stay out of the totals either way.
   */
  fastify.get<{ Querystring: { day?: string; includeNonProduction?: string } }>(
    '/api/v1/platform/delivery/overview',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const day = request.query.day;
      if (day !== undefined && !DAY_PATTERN.test(day)) {
        return reply
          .code(400)
          .send({ error: { code: 'VALIDATION_ERROR', message: 'day must be YYYY-MM-DD' } });
      }

      return reply.send({
        data: await getPlatformOverview({
          prisma,
          day,
          includeNonProduction: request.query.includeNonProduction === 'true',
          // The agency this operator has entered, or none. Session only.
          tenantId: getActingTenantId(request) ?? undefined,
        }),
      });
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
          rateOffset: terms.rateOffset,
          paymentMethod: terms.paymentMethod,
          mandateStatus: terms.mandateStatus,
          hasValidMandate: terms.hasValidMandate,
          suspended: terms.suspended,
          suspensionReason: terms.suspensionReason,
          /*
           * What the maximum daily debit WOULD be at the rate asked about.
           * Offered so the contract figure and the platform figure come from
           * one arithmetic; it never overwrites the stored commitment.
           *
           * `?rate=` is the CURVE rate being contemplated -- the number off the
           * Insertion Order's rate card -- and the offset is added here, so the
           * figure this returns is what a full day at the ceiling actually
           * costs. Computing the cap off the curve rate alone would leave it
           * short by the offset times the block plus ceiling, every day, and a
           * settlement at the ceiling would halt on a cap that was never the
           * real cost of the day.
           */
          computedMaxDailyDebitAtRate: Number.isFinite(rate) && rate > 0
            ? maxDailyDebitFor(
                terms.dailyBlockApplications,
                terms.ceilingPct,
                rate + terms.rateOffset
              )
            : null,
          /** The rate the figure above was computed at, so it reads on its own. */
          computedAtEffectiveRate:
            Number.isFinite(rate) && rate > 0 ? Number((rate + terms.rateOffset).toFixed(2)) : null,
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
      rateOffset?: number;
      ceilingPctBelowThreshold?: number;
      ceilingPctAtThreshold?: number;
      ceilingCleanSettlementThreshold?: number;
      ceilingPctCard?: number;
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

      /*
       * The rate offset, in dollars, added to whatever the curve returns at
       * every point on it.
       *
       * Optional, and zero when omitted -- an agency nobody agreed one with is
       * priced straight off the curve. Refused if negative: an offset is what
       * this agency is priced ABOVE the curve, and a negative one is a discount
       * that belongs in a renegotiated curve rather than hidden in a term.
       *
       * It arrives from a caller for the same reason the Daily Block does: it
       * is what was commercially agreed. Platform-only, audited, and an agency
       * OWNER is refused it.
       */
      const rateOffset = body.rateOffset;
      if (
        rateOffset !== undefined &&
        (typeof rateOffset !== 'number' || !Number.isFinite(rateOffset) || rateOffset < 0)
      ) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message:
              'rateOffset must be zero or a positive number of dollars. It is added to the ' +
              'curve rate at every point on the curve — it is part of the price, not a fee ' +
              'charged on top of one.',
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
        maxDailyDebit: new Prisma.Decimal(maxDebit.toFixed(2)),
        ...(typeof rateOffset === 'number'
          ? { rateOffset: new Prisma.Decimal(rateOffset.toFixed(2)) }
          : {}),
        ...(typeof body.ceilingPctCard === 'number' && body.ceilingPctCard >= 0
          ? { ceilingPctCard: new Prisma.Decimal(body.ceilingPctCard) }
          : {}),
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
          rateOffset: toNumber(profile.rateOffset),
        },
      });

      return reply.send({
        data: {
          tenantId: profile.tenantId,
          dailyBlockApplications: profile.dailyBlockApplications,
          maxDailyDebit: toNumber(profile.maxDailyDebit),
          rateOffset: toNumber(profile.rateOffset),
          paymentMethod: profile.paymentMethod,
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
   * PUT /api/v1/platform/delivery/agencies/:tenantId/payment-method
   *
   * Whether this agency pays by ACH mandate or by card.
   *
   * ── What this does and does not decide ───────────────────────────────────
   *
   * It decides which instrument the nightly settlement debits, and which
   * Overrun ceiling applies -- a card-paying agency gets the flat card
   * percentage, which does not rise with settlement history because a card
   * payment can be taken back without our consent and a clean payment record on
   * a reversible instrument is not the evidence the ACH schedule treats it as.
   *
   * It decides NOTHING about the price. An agency's rate offset is a separate,
   * explicit number on its terms, and nothing here sets, derives or implies
   * one. That is deliberate: the reason an offset exists for a card-paying
   * agency is a commercial matter agreed in a conversation, not a rule the
   * software enforces, and a code path that set a price from a payment method
   * would be that rule.
   */
  fastify.put<{
    Params: { tenantId: string };
    Body: { paymentMethod?: string };
  }>(
    '/api/v1/platform/delivery/agencies/:tenantId/payment-method',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const { tenantId } = request.params;
      const requested = (request.body?.paymentMethod ?? '').toUpperCase();

      if (requested !== 'ACH' && requested !== 'CARD') {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'paymentMethod must be ACH or CARD' },
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
        data: { paymentMethod: requested as AgencyPaymentMethod },
      });

      await auditLog({
        tenantId,
        userId: getActingUserId(request) ?? undefined,
        action: 'platform.delivery.payment_method.updated',
        entityType: 'agency_billing_profile',
        entityId: profile.id,
        changes: { paymentMethod: requested },
      });

      const terms = await loadAgencyTerms(tenantId, { prisma });

      return reply.send({
        data: {
          tenantId,
          paymentMethod: profile.paymentMethod,
          /*
           * What the agency has on file for the method now selected. Switching
           * an agency to CARD before it has saved one leaves it without a usable
           * instrument, which the enrolment check reports as NO_VALID_MANDATE --
           * so it is returned here rather than discovered at a settlement.
           */
          hasValidMandate: terms.hasValidMandate,
          mandateStatus: terms.mandateStatus,
          ceilingPct: terms.ceilingPct,
          ceilingSource: terms.ceilingSource,
          ceilingApplications: terms.ceilingApplications,
        },
      });
    }
  );

  /**
   * GET  /api/v1/platform/delivery/agencies/:tenantId/disputes
   * POST /api/v1/platform/delivery/agencies/:tenantId/disputes/stand-down
   *
   * A card chargeback stops delivery for the agency it hit, and only an
   * explicit act here starts it again.
   *
   * ── Not automatically, and not because it resolved ───────────────────────
   *
   * Nothing resumes delivery on its own. In particular the dispute CLOSING does
   * not, and it does not even when it closes in our favour: winning says the
   * money came back, not that this is an account to keep extending unsecured
   * credit to unexamined. A person looks and decides.
   *
   * ── Nothing here gives anything back ─────────────────────────────────────
   *
   * Standing down a dispute does not return a credit, write a ledger row or
   * change a settlement figure. The applications were delivered and consumed
   * and the settlement is the record of what was billed. A chargeback is a
   * payment event, and it is contained rather than reversed.
   */
  fastify.get<{ Params: { tenantId: string } }>(
    '/api/v1/platform/delivery/agencies/:tenantId/disputes',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const rows = await prisma.settlementDispute.findMany({
        where: { tenantId: request.params.tenantId },
        orderBy: { openedAt: 'desc' },
        take: 100,
      });

      return reply.send({
        data: rows.map(row => ({
          id: row.id,
          settlementId: row.settlementId,
          stripeDisputeId: row.stripeDisputeId,
          stripeChargeId: row.stripeChargeId,
          stripePaymentIntentId: row.stripePaymentIntentId,
          amount: toNumber(row.amount),
          reason: row.reason,
          status: row.status,
          stripeStatus: row.stripeStatus,
          openedAt: row.openedAt,
          closedAt: row.closedAt,
          /**
           * Null means delivery is still stopped for this dispute. It is the
           * only thing that says a person has looked.
           */
          deliveryResumedAt: row.deliveryResumedAt,
          deliveryResumedByUserId: row.deliveryResumedByUserId,
          deliveryResumedNote: row.deliveryResumedNote,
        })),
      });
    }
  );

  fastify.post<{ Params: { tenantId: string }; Body: { note?: string } }>(
    '/api/v1/platform/delivery/agencies/:tenantId/disputes/stand-down',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const { tenantId } = request.params;
      const operatorUserId = getActingUserId(request);

      if (!operatorUserId) {
        // The record has to name a person. An API key cannot stand down a
        // chargeback, because "a platform admin decided" is the whole content
        // of the decision.
        return reply.code(403).send({
          error: {
            code: 'FORBIDDEN',
            message: 'Resuming delivery after a dispute has to be done by a named operator',
          },
        });
      }

      const result = await standDownDispute({ prisma, tenantId, operatorUserId, note: request.body?.note });

      if (result.disputesStoodDown === 0) {
        return reply.code(409).send({
          error: {
            code: 'NO_OPEN_DISPUTE',
            message: 'This agency has no dispute holding delivery',
          },
        });
      }

      await auditLog({
        tenantId,
        userId: operatorUserId,
        action: 'platform.delivery.dispute.stood_down',
        entityType: 'settlement_dispute',
        entityId: tenantId,
        changes: {
          disputesStoodDown: result.disputesStoodDown,
          note: request.body?.note ?? null,
        },
      });

      return reply.send({
        data: {
          tenantId,
          disputesStoodDown: result.disputesStoodDown,
          deliveryResumed: result.deliveryResumed,
          /*
           * Said explicitly because it is the thing somebody pressing this
           * button might assume otherwise: nothing was returned to anybody.
           */
          creditsReturned: 0,
          settlementsChanged: 0,
        },
      });
    }
  );

  /**
   * GET /api/v1/platform/delivery/agencies/:tenantId/enrolment
   *
   * Whether this agency is enrolled, and if not, exactly what is missing.
   * Read-only: an operator can check an agency before committing to enrol it.
   */
  fastify.get<{ Params: { tenantId: string } }>(
    '/api/v1/platform/delivery/agencies/:tenantId/enrolment',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const { terms, blockers } = await enrolmentBlockersFor(request.params.tenantId, { prisma });

      // What turning charging on would retire, so an operator sees the number
      // before they press the button rather than in the response afterwards.
      const closeout = await previewDryRunCloseout(prisma, request.params.tenantId);

      return reply.send({
        data: {
          tenantId: request.params.tenantId,
          enrolled: terms.enrolled,
          enrolledAt: terms.enrolledAt,
          chargesEnabled: terms.chargesEnabled,
          /** Empty when the agency is ready to be enrolled. */
          blockers,
          readyToEnrol: blockers.length === 0,
          balance: await creditBalance(prisma, request.params.tenantId),
          pendingDryRunCloseout: closeout,
          /**
           * The account a five-figure daily debit would come out of.
           *
           * `NO_VALID_MANDATE` leaving the blocker list says a mandate exists;
           * it does not say it is the right bank account. Somebody about to
           * enrol an agency should be able to read the bank and the last four
           * off the same response they are checking readiness in, rather than
           * finding out from a settlement.
           */
          mandate: {
            status: terms.mandateStatus,
            valid: terms.hasValidMandate,
            bankName: terms.profile?.achBankName ?? null,
            last4: terms.profile?.achLast4 ?? null,
            verifiedAt: terms.profile?.achMandateVerifiedAt ?? null,
          },
        },
      });
    }
  );

  /**
   * POST /api/v1/platform/delivery/agencies/:tenantId/enrol
   *
   * Bring one agency into the billing system.
   *
   * From the next call offered, this agency is gated on its balance and Overrun
   * ceiling, its submitted applications spend credits, and the nightly
   * settlement bills it. Charging stays OFF until it is turned on separately,
   * so the first thing that happens is settlements that compute and record
   * without taking money.
   *
   * Refused with the full list of what is missing rather than a bare no: an
   * operator enrolling an agency should not discover the preconditions one
   * failed request at a time.
   */
  fastify.post<{ Params: { tenantId: string }; Body: { note?: string } }>(
    '/api/v1/platform/delivery/agencies/:tenantId/enrol',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const { tenantId } = request.params;

      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true },
      });
      if (!tenant) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Agency not found' } });
      }

      const { terms, blockers } = await enrolmentBlockersFor(tenantId, { prisma });

      if (terms.enrolled) {
        // Already in. Not an error, and deliberately not a re-enrolment: the
        // enrolment timestamp is when this agency started being billed, and
        // moving it would erase that.
        return reply.send({
          data: {
            tenantId,
            enrolled: true,
            enrolledAt: terms.enrolledAt,
            chargesEnabled: terms.chargesEnabled,
            alreadyEnrolled: true,
          },
        });
      }

      if (blockers.length > 0) {
        return reply.code(409).send({
          error: {
            code: 'ENROLMENT_BLOCKED',
            message:
              `This agency is not ready to be enrolled: ${blockers.length} thing(s) missing. ` +
              'Enrolment takes effect on the next call offered, and enrolling without these ' +
              'would stop delivery immediately.',
            blockers,
          },
        });
      }

      const now = new Date();
      const profile = await prisma.agencyBillingProfile.update({
        where: { tenantId },
        data: {
          billingEnrolledAt: now,
          billingEnrolledByUserId: getActingUserId(request),
          billingEnrolmentNote: request.body?.note ?? null,
        },
      });

      await auditLog({
        tenantId,
        userId: getActingUserId(request) ?? undefined,
        action: 'platform.delivery.enrolled',
        entityType: 'agency_billing_profile',
        entityId: profile.id,
        changes: {
          enrolledAt: now.toISOString(),
          note: request.body?.note ?? null,
          chargesEnabled: profile.chargesEnabled,
        },
      });

      return reply.send({
        data: {
          tenantId,
          enrolled: true,
          enrolledAt: profile.billingEnrolledAt,
          chargesEnabled: profile.chargesEnabled,
          alreadyEnrolled: false,
        },
      });
    }
  );

  /**
   * POST /api/v1/platform/delivery/agencies/:tenantId/unenrol
   *
   * Take one agency back out of the billing system.
   *
   * Delivery stops being gated immediately, its applications stop being
   * metered, and the nightly settlement stops looking at it. The ledger and the
   * settlements it already has are untouched -- they are the record of what it
   * was charged, and nothing in this system removes those.
   */
  fastify.post<{ Params: { tenantId: string }; Body: { reason?: string } }>(
    '/api/v1/platform/delivery/agencies/:tenantId/unenrol',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const { tenantId } = request.params;

      const updated = await prisma.agencyBillingProfile.updateMany({
        where: { tenantId },
        data: {
          billingEnrolledAt: null,
          billingEnrolledByUserId: null,
          billingEnrolmentNote: request.body?.reason ?? null,
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
        action: 'platform.delivery.unenrolled',
        entityType: 'tenant',
        entityId: tenantId,
        changes: { reason: request.body?.reason ?? null },
      });

      return reply.send({ data: { tenantId, enrolled: false } });
    }
  );

  /**
   * PUT /api/v1/platform/delivery/agencies/:tenantId/charges
   *
   * Turn real charging on or off for an enrolled agency.
   *
   * OFF is the dry run: the settlement computes everything and writes the full
   * immutable record, and only the Stripe debit is skipped. ON is money leaving
   * a bank account, so it is its own act with its own audit row, and it is
   * refused for an agency that is not enrolled -- there would be nothing to
   * charge.
   *
   * Turning it ON also retires every credit the dry run issued, so the first
   * charged settlement sells a full block against a zero balance rather than a
   * short one against credits nobody paid for. The response says how many.
   */
  fastify.put<{ Params: { tenantId: string }; Body: { enabled?: boolean } }>(
    '/api/v1/platform/delivery/agencies/:tenantId/charges',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const { tenantId } = request.params;
      const enabled = request.body?.enabled;

      if (typeof enabled !== 'boolean') {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'enabled must be true or false' },
        });
      }

      const terms = await loadAgencyTerms(tenantId, { prisma });
      if (!terms.profile) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: 'This agency has no recorded terms' },
        });
      }

      if (enabled && !terms.enrolled) {
        return reply.code(409).send({
          error: {
            code: 'NOT_ENROLLED',
            message:
              'This agency is not enrolled in billing, so there is nothing to charge. ' +
              'Enrol it first.',
          },
        });
      }

      const profile = await prisma.agencyBillingProfile.update({
        where: { tenantId },
        data: {
          chargesEnabled: enabled,
          chargesEnabledAt: enabled ? new Date() : null,
          chargesEnabledByUserId: enabled ? getActingUserId(request) : null,
        },
      });

      /*
       * Turning charging ON retires the credits the dry run issued.
       *
       * Blocks sold by a DRY_RUN settlement were never paid for. Left on the
       * balance they would reduce the first charged settlement's block, because
       * the block is the daily target minus unused paid applications and the
       * ledger cannot tell an unpaid credit from a bought one -- so the
       * agency's first real billing day would deliver short, on credits nobody
       * paid for.
       *
       * Retired by appending rows, never by editing the purchases: the ledger
       * is append-only and a correction is a later row. Idempotent, so pressing
       * this twice retires nothing the second time. See
       * `closeOutDryRunLots()` -- it is not a reversal and no money moves.
       */
      const closeout = enabled
        ? await closeOutDryRunLots({ prisma, tenantId })
        : { lotsRetired: 0, creditsRetired: 0, balanceAfter: 0, entryIds: [] };

      await auditLog({
        tenantId,
        userId: getActingUserId(request) ?? undefined,
        action: enabled
          ? 'platform.delivery.charges.enabled'
          : 'platform.delivery.charges.disabled',
        entityType: 'agency_billing_profile',
        entityId: profile.id,
        changes: {
          chargesEnabled: enabled,
          dryRunLotsRetired: closeout.lotsRetired,
          dryRunCreditsRetired: closeout.creditsRetired,
        },
      });

      return reply.send({
        data: {
          tenantId,
          enrolled: terms.enrolled,
          chargesEnabled: profile.chargesEnabled,
          chargesEnabledAt: profile.chargesEnabledAt,
          /**
           * What the transition retired. Zero on every call but the first, and
           * on an agency that never ran a dry run.
           */
          dryRunCloseout: enabled
            ? {
                lotsRetired: closeout.lotsRetired,
                creditsRetired: closeout.creditsRetired,
                balanceAfter: closeout.balanceAfter,
              }
            : null,
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
  fastify.post<{
    Body: { deliveryDay?: string; tenantIds?: string[]; settleWithoutCharge?: boolean };
  }>(
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
        // Can only ever turn charging OFF for this run. There is no body field
        // that turns it on for an agency whose profile says otherwise.
        settleWithoutCharge: request.body?.settleWithoutCharge === true,
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
   * GET /api/v1/platform/delivery/settlements.csv
   *
   * Every agency's settlements over a date range, as a file, optionally
   * filtered to the ones that charged or the ones that did not.
   *
   * This is what a dry-run period is invoiced from. It carries every figure the
   * settlement record was written with — the Delivery Day, the two counts, both
   * closing percentages, the rate and its curve version, the overrun quantity
   * and amount, the block quantity and amount, and the total that was or would
   * have been charged — plus the agency's name and id, so an invoice can be
   * raised from the file without opening the application.
   *
   *   ?from=2026-09-07&to=2026-09-09   inclusive Delivery Day range
   *   ?mode=DRY_RUN                    only the settlements that took no money
   *   ?mode=CHARGED                    only the ones that did
   *   ?mode=ALL                        both (the default)
   *   ?tenantId=<id>                   one agency
   *   ?includeNonProduction=true       demo and fixture tenants too
   *
   * The export is the file behind the platform-wide settlements screen, so it
   * takes the same filters that screen does and excludes non-production tenants
   * by default for the same reason. An operator who has ENTERED an agency gets
   * that agency: entering is a session-level decision and `tenantId` cannot
   * widen past it.
   */
  fastify.get<{
    Querystring: {
      from?: string;
      to?: string;
      mode?: string;
      tenantId?: string;
      includeNonProduction?: string;
    };
  }>(
    '/api/v1/platform/delivery/settlements.csv',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const { from, to } = request.query;
      const tenantId = getActingTenantId(request) ?? request.query.tenantId;
      const includeNonProduction = request.query.includeNonProduction === 'true';
      const mode = (request.query.mode ?? 'ALL').toUpperCase();

      for (const [name, value] of [
        ['from', from],
        ['to', to],
      ] as const) {
        if (value !== undefined && !DAY_PATTERN.test(value)) {
          return reply.code(400).send({
            error: { code: 'VALIDATION_ERROR', message: `${name} must be YYYY-MM-DD` },
          });
        }
      }

      if (!['ALL', 'DRY_RUN', 'CHARGED'].includes(mode)) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'mode must be ALL, DRY_RUN or CHARGED',
          },
        });
      }

      /*
       * CHARGED is every status except DRY_RUN, not just SUCCEEDED.
       *
       * A settlement that was sent to Stripe and failed, or that halted on the
       * maximum daily debit, is one where charging was in force -- it belongs
       * in the charged export, because leaving it out would make a reconciler
       * think the day was never settled. DRY_RUN is the only status where no
       * charge was ever attempted, so it is the only one the split turns on.
       */
      const paymentStatus =
        mode === 'DRY_RUN'
          ? { equals: SettlementPaymentStatus.DRY_RUN }
          : mode === 'CHARGED'
            ? { not: SettlementPaymentStatus.DRY_RUN }
            : undefined;

      /*
       * Deliberately unpaginated. This is one row per agency per Delivery Day
       * and an invoice is raised from it, so a page limit would hand somebody a
       * file that silently stops part-way through a billing period -- a worse
       * failure than a large download. The date range is the way to bound it.
       */
      const visibleTenants =
        includeNonProduction || tenantId
          ? null
          : await prisma.tenant.findMany({
              where: { isNonProduction: false },
              select: { id: true },
            });

      const rows = await prisma.dailySettlement.findMany({
        where: {
          ...(tenantId ? { tenantId } : {}),
          ...(visibleTenants ? { tenantId: { in: visibleTenants.map(t => t.id) } } : {}),
          ...(from || to
            ? { deliveryDay: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
            : {}),
          ...(paymentStatus ? { paymentStatus } : {}),
        },
        orderBy: [{ deliveryDay: 'asc' }, { tenantId: 'asc' }],
      });

      // One lookup for the names rather than a join per row: this export is
      // read by a person, and an agency id is not something they can invoice.
      const tenants = await prisma.tenant.findMany({
        where: { id: { in: [...new Set(rows.map(row => row.tenantId))] } },
        select: { id: true, name: true },
      });
      const nameById = new Map(tenants.map(t => [t.id, t.name]));

      const header = ['agency', 'tenant_id', ...SETTLEMENT_CSV_COLUMNS];
      const body = rows.map(row =>
        [nameById.get(row.tenantId) ?? '', row.tenantId, ...settlementCsvRow(row)]
          .map(csvCell)
          .join(',')
      );

      const filename = `settlements-${mode.toLowerCase()}-${from ?? 'start'}-to-${to ?? 'today'}.csv`;

      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send([header.map(csvCell).join(','), ...body].join('\n'));
    }
  );

  /**
   * GET /api/v1/platform/delivery/settlements
   *
   * Every agency's settlements over a Delivery Day range, including the ones
   * that halted, each carrying the agency it belongs to.
   *
   * ── The platform counterpart of `/delivery/settlements` ──────────────────
   *
   * An agency reads its own history one row per day. Platform staff read every
   * agency's, which is the same rows with the agency on them and a range rather
   * than a single day -- so this is that, and a platform admin with no acting
   * tenant lands on it instead of on a prompt to pick somebody.
   *
   *   ?from=&to=     inclusive Delivery Day range. Both optional.
   *   ?day=          one Delivery Day, the shorthand the settlement-run screen
   *                  uses. Equivalent to from=day&to=day.
   *   ?agencyId=     one agency. A FILTER on a platform-wide list, not a way to
   *                  resolve a caller's own tenant: the caller's authority here
   *                  is the platform capability, and this parameter names the
   *                  agency being looked at -- the same reading as the
   *                  `:tenantId` in every other platform route.
   *   ?includeNonProduction=true   list demo and fixture tenants too.
   *
   * When the operator has ENTERED an agency, that agency wins and `agencyId` is
   * ignored: entering is a session-level decision and a query string must not
   * be able to widen past it.
   */
  fastify.get<{
    Querystring: {
      day?: string;
      from?: string;
      to?: string;
      agencyId?: string;
      includeNonProduction?: string;
      limit?: string;
    };
  }>(
    '/api/v1/platform/delivery/settlements',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const { day, from, to } = request.query;

      for (const [name, value] of [
        ['day', day],
        ['from', from],
        ['to', to],
      ] as const) {
        if (value !== undefined && !DAY_PATTERN.test(value)) {
          return reply.code(400).send({
            error: { code: 'VALIDATION_ERROR', message: `${name} must be YYYY-MM-DD` },
          });
        }
      }

      /*
       * `day` is the one-day shorthand; `from`/`to` is the range. Naming both
       * is a caller asking two different questions, so the range wins and the
       * day is ignored rather than silently intersected into an empty result.
       */
      const rangeFrom = from ?? (from || to ? undefined : day);
      const rangeTo = to ?? (from || to ? undefined : day);

      /*
       * Which agency, if any. The acting tenant first -- an operator who has
       * entered an agency sees that agency, and no query parameter widens past
       * it -- then the explicit filter.
       */
      const acting = getActingTenantId(request);
      const agencyId = acting ?? request.query.agencyId;

      const includeNonProduction = request.query.includeNonProduction === 'true';

      /*
       * Non-production tenants are excluded by listing the production tenant
       * ids and filtering on them, rather than by filtering rows after the
       * fact: a page limit applied to a list that is then filtered hands
       * somebody a short page and calls it the answer.
       */
      const visibleTenants =
        includeNonProduction || agencyId
          ? null
          : await prisma.tenant.findMany({
              where: { isNonProduction: false },
              select: { id: true },
            });

      const limit = Math.min(Math.max(Number(request.query.limit ?? 500) || 500, 1), 2000);

      const rows = await prisma.dailySettlement.findMany({
        where: {
          ...(agencyId ? { tenantId: agencyId } : {}),
          ...(visibleTenants ? { tenantId: { in: visibleTenants.map(t => t.id) } } : {}),
          ...(rangeFrom || rangeTo
            ? {
                deliveryDay: {
                  ...(rangeFrom ? { gte: rangeFrom } : {}),
                  ...(rangeTo ? { lte: rangeTo } : {}),
                },
              }
            : {}),
        },
        include: { attempts: { orderBy: { attemptNumber: 'asc' } } },
        orderBy: [{ deliveryDay: 'desc' }, { tenantId: 'asc' }],
        take: limit,
      });

      // One lookup for the names rather than a join per row. An agency id is
      // not something an operator can read a settlement history by.
      const tenants = await prisma.tenant.findMany({
        where: { id: { in: [...new Set(rows.map(row => row.tenantId))] } },
        select: { id: true, name: true, isNonProduction: true },
      });
      const byId = new Map(tenants.map(t => [t.id, t]));

      return reply.send({
        data: {
          agencyId: agencyId ?? null,
          includingNonProduction: includeNonProduction,
          settlements: rows.map(row => ({
            ...serialiseSettlement(row),
            agency: byId.get(row.tenantId)?.name ?? null,
            isNonProduction: byId.get(row.tenantId)?.isNonProduction ?? false,
            attempts: row.attempts.map(attempt => ({
              attemptNumber: attempt.attemptNumber,
              status: attempt.status,
              amount: toNumber(attempt.amount),
              failureCode: attempt.failureCode,
              failureMessage: attempt.failureMessage,
              occurredAt: attempt.occurredAt,
            })),
          })),
        },
      });
    }
  );

  /**
   * GET /api/v1/platform/delivery/agencies
   *
   * The agency picker for the platform-wide screens: id, name, slug, whether
   * the tenant is marked non-production, and whether it is enrolled.
   *
   * Deliberately not the tenant list from `platform.ts`: that one is the
   * acting-tenant switcher and answers "which agencies may I enter". This one
   * is a filter control on a platform-wide table and says which agencies have
   * settlements to filter to. Neither is a cross-agency export.
   */
  fastify.get<{ Querystring: { includeNonProduction?: string } }>(
    '/api/v1/platform/delivery/agencies',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const includeNonProduction = request.query.includeNonProduction === 'true';

      const tenants = await prisma.tenant.findMany({
        where: {
          status: 'ACTIVE',
          ...(includeNonProduction ? {} : { isNonProduction: false }),
        },
        select: {
          id: true,
          name: true,
          slug: true,
          isNonProduction: true,
          billingProfile: { select: { billingEnrolledAt: true } },
        },
        orderBy: { name: 'asc' },
      });

      return reply.send({
        data: tenants.map(tenant => ({
          tenantId: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
          isNonProduction: tenant.isNonProduction,
          enrolled: tenant.billingProfile?.billingEnrolledAt != null,
        })),
      });
    }
  );
}

/**
 * The settlement export's columns, and one row.
 *
 * ── This is what an invoice is written from ──────────────────────────────────
 *
 * A dry-run period is invoiced by hand, so the export has to carry everything
 * needed to raise that invoice without opening the application: the Delivery
 * Day, the two counts, the closing percentages, the rate and the curve version
 * that produced it, the overrun quantity and amount, the block quantity and
 * amount, and the total that was -- or would have been -- charged.
 *
 * `day_closing_pct` is derived here from the two counts on the row rather than
 * stored, because it is exactly `submittedApplications / deliveredCalls` and a
 * second stored copy of a number is a second thing that can disagree. It is the
 * DAY's percentage; `window_closing_pct` is the trailing window that set the
 * rate, and they are different numbers, which is why both are here under names
 * that say which.
 */
const SETTLEMENT_CSV_COLUMNS = [
  'delivery_day',
  'delivered_calls',
  'submitted_applications',
  'day_closing_pct',
  'window_closing_pct',
  'window_delivery_days',
  'window_days_found',
  'window_day_keys',
  /*
   * Three columns for one price, and they are not redundant.
   *
   * `rate` is what the agency was charged per application. `curve_rate` is what
   * the curve returned for its closing percentage, and `rate_offset` is the
   * per-tenant offset agreed on its Insertion Order. The first is the sum of
   * the other two, which is what lets a finance team reconstruct a price from
   * the file rather than take it on trust.
   *
   * It is NOT a fee line. There is no column here that adds anything to
   * `total_charged`, because the offset is part of the price and not something
   * charged on top of one -- an itemised fee added at the point of payment is a
   * surcharge, which is a regulated instrument this platform does not use.
   */
  'rate',
  'curve_rate',
  'rate_offset',
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
] as const;

function settlementCsvRow(row: SettlementRecord): unknown[] {
  return [
    row.deliveryDay,
    row.deliveredCalls,
    row.submittedApplications,
    row.deliveredCalls > 0
      ? ((row.submittedApplications / row.deliveredCalls) * 100).toFixed(4)
      : '',
    row.windowClosingPct === null ? '' : toNumber(row.windowClosingPct),
    row.windowDeliveryDays,
    row.windowDaysFound,
    row.windowDayKeys.join(' '),
    row.rate === null ? '' : toNumber(row.rate),
    row.curveRate === null ? '' : toNumber(row.curveRate),
    toNumber(row.rateOffset),
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
  ];
}

/** One settlement row, with every figure it was written with. */
type SettlementRecord = {
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
  curveRate: Prisma.Decimal | null;
  rateOffset: Prisma.Decimal;
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
};

function serialiseSettlement(row: SettlementRecord): Record<string, unknown> {
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
    curveRate: row.curveRate === null ? null : toNumber(row.curveRate),
    rateOffset: toNumber(row.rateOffset),
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
