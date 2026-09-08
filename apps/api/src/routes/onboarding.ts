/**
 * Onboarding an agency: internal, ordered, and refusing to skip ahead.
 *
 * ── There is no self-serve path, deliberately ────────────────────────────────
 *
 * Every agency on this platform is onboarded by NetEnroll staff after a
 * conversation and a signed agreement. There is no public checkout, no signup
 * that creates an account, and no introductory package anybody can buy. An
 * account exists because somebody here created it.
 *
 * That is enforced rather than intended: `POST /api/auth/register` requires an
 * activation grant, grants are minted only by the server, and the only grant
 * this file mints is for the agency OWNER of an agency a platform admin just
 * created. Registration names no tenant and cannot.
 *
 * ── The order is the runbook's order, and it is checked ──────────────────────
 *
 * docs/BILLING.md §0d says what has to be true before each step, and every one
 * of those preconditions exists because skipping it breaks something specific:
 *
 *   a. TENANT      the agency itself: legal name, state, contact, licensed
 *                  agents, the days and hours it takes calls.
 *   b. TERMS       the opening rate, the rate offset, the opening block, the
 *                  daily application target, the ceiling percentage and the
 *                  maximum daily debit. The maximum is SHOWN as
 *                  (block + ceiling) x effective rate and STORED as an explicit
 *                  figure, because it is a contractual commitment on the
 *                  Insertion Order rather than something recomputed at charge
 *                  time -- a cap that moves when a rate moves is not a cap.
 *   c. PAYMENT     ACH mandate or card. The agency completes it in its own
 *                  browser; this records which instrument its terms name.
 *   d. OWNER       one activation grant for the agency principal, through the
 *                  existing `TenantActivationGrant` mechanism: single-use,
 *                  hashed, bound to one email. There is deliberately no second
 *                  invitation path.
 *   e. ENROL       the existing prerequisite check, which names everything
 *                  missing at once.
 *
 * A step that is asked for out of order is refused with what is missing, and
 * `GET .../onboarding` reports every step's state so the screen renders the
 * position rather than guessing it. The state is DERIVED from the rows each
 * step writes -- there is no stored "current step" column, because a stored
 * position is wrong the first time somebody does a step by hand.
 *
 * ── Every step writes an AuditLog row naming the operator ────────────────────
 *
 * `auditLog()` raises rather than swallowing, so a step that could not be
 * recorded is a step that did not happen.
 *
 * ── Nothing here takes a figure from a browser it then charges ───────────────
 *
 * The rate, offset, block and maximum daily debit arrive from the caller
 * because they are what was commercially agreed -- the same shape as the terms
 * route -- and they are platform-only, audited, and refused to an agency OWNER.
 * No agency can reach any route in this file.
 */

import { AgencyPaymentMethod, Prisma, RoleName, TenantActivationSource } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

import { requirePlatformAdmin } from '../lib/platform-context.js';
import { getPrismaClient } from '../lib/prisma.js';
import { getActingUserId } from '../lib/tenant-context.js';
import { authenticate } from '../middleware/auth.js';
import { auditLog } from '../services/audit.js';
import {
  enrolmentBlockersFor,
  loadAgencyTerms,
  maxDailyDebitFor,
  overrunCeilingApplications,
} from '../services/billing/terms.js';
import { toNumber } from '../services/rating/rate-curve.js';
import { issueActivationGrant } from '../services/tenant-activation.js';

/** `MON`..`SUN`. Stored as strings so no layer can shift a day by a timezone. */
const DELIVERY_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STATE_PATTERN = /^[A-Z]{2}$/;

/** The five steps, in the order the runbook does them. */
export type OnboardingStepId = 'TENANT' | 'TERMS' | 'PAYMENT_METHOD' | 'OWNER' | 'ENROL';

export interface OnboardingStepState {
  id: OnboardingStepId;
  /** Done, ready to do now, or blocked because an earlier step is not done. */
  state: 'COMPLETE' | 'READY' | 'BLOCKED';
  /** What is missing. Every reason at once, never one at a time. */
  blockers: string[];
  summary: Record<string, unknown> | null;
}

/**
 * A slug that is stable, readable and unlikely to collide.
 *
 * Derived from the name, suffixed when taken. Not from anything in the request
 * that names an existing tenant: a caller must not be able to steer a new
 * agency onto an existing slug.
 */
async function uniqueSlug(
  prisma: ReturnType<typeof getPrismaClient>,
  name: string
): Promise<string> {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'agency';

  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const taken = await prisma.tenant.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!taken) return candidate;
  }

  return `${base}-${Date.now()}`;
}

// eslint-disable-next-line @typescript-eslint/require-await -- plugin signature
export async function registerOnboardingRoutes(fastify: FastifyInstance): Promise<void> {
  const prisma = getPrismaClient();

  /**
   * Where an agency has got to, step by step.
   *
   * Derived from the rows each step writes. A screen renders this rather than
   * remembering where it thinks it is, so an agency half-onboarded last week
   * opens on the right step.
   */
  async function onboardingState(tenantId: string): Promise<{
    tenantId: string;
    name: string;
    steps: OnboardingStepState[];
    complete: boolean;
  } | null> {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, slug: true },
    });
    if (!tenant) return null;

    const [agencyProfile, terms, ratingState, grant, owner] = await Promise.all([
      prisma.agencyProfile.findUnique({ where: { tenantId } }),
      loadAgencyTerms(tenantId, { prisma }),
      prisma.agencyRatingState.findUnique({ where: { tenantId } }),
      prisma.tenantActivationGrant.findFirst({
        where: { tenantId, roleName: RoleName.OWNER },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.user.findFirst({
        where: { tenantId, roles: { some: { role: { name: RoleName.OWNER } } } },
        select: { id: true, email: true, status: true },
      }),
    ]);

    const tenantDone = agencyProfile !== null;

    const termsBlockers: string[] = [];
    if (!terms.profile) termsBlockers.push('No commercial terms recorded.');
    if (terms.dailyBlockApplications <= 0) termsBlockers.push('No daily application target.');
    if (terms.maxDailyDebit <= 0) termsBlockers.push('No maximum daily debit.');
    if (ratingState?.openingRate == null && ratingState?.currentRate == null) {
      termsBlockers.push('No agreed opening rate.');
    }
    const termsDone = termsBlockers.length === 0;

    const paymentDone = terms.hasValidMandate;
    const ownerDone = owner !== null || grant !== null;

    const { blockers: enrolBlockers } = await enrolmentBlockersFor(tenantId, { prisma });

    const step = (
      id: OnboardingStepId,
      done: boolean,
      earlierDone: boolean,
      blockers: string[],
      summary: Record<string, unknown> | null
    ): OnboardingStepState => ({
      id,
      state: done ? 'COMPLETE' : earlierDone ? 'READY' : 'BLOCKED',
      blockers: done ? [] : earlierDone ? blockers : ['An earlier step is not done yet.'],
      summary,
    });

    const steps: OnboardingStepState[] = [
      step('TENANT', tenantDone, true, ['The agency itself has not been recorded.'], {
        name: tenant.name,
        slug: tenant.slug,
        legalName: agencyProfile?.legalName ?? null,
        state: agencyProfile?.state ?? null,
        contactName: agencyProfile?.contactName ?? null,
        contactEmail: agencyProfile?.contactEmail ?? null,
        contactPhone: agencyProfile?.contactPhone ?? null,
        licensedAgentCount: agencyProfile?.licensedAgentCount ?? null,
        deliveryDays: agencyProfile?.deliveryDays ?? [],
        deliveryStartTime: agencyProfile?.deliveryStartTime ?? null,
        deliveryEndTime: agencyProfile?.deliveryEndTime ?? null,
        deliveryTimeZone: agencyProfile?.deliveryTimeZone ?? null,
      }),
      step('TERMS', termsDone, tenantDone, termsBlockers, {
        openingRate: ratingState?.openingRate == null ? null : toNumber(ratingState.openingRate),
        openingBlockApplications: ratingState?.openingBlockApplications ?? null,
        rateOffset: terms.rateOffset,
        effectiveRate:
          ratingState?.openingRate == null
            ? null
            : Number((toNumber(ratingState.openingRate) + terms.rateOffset).toFixed(2)),
        dailyBlockApplications: terms.dailyBlockApplications,
        ceilingPct: terms.ceilingPct,
        ceilingApplications: terms.ceilingApplications,
        maxDailyDebit: terms.maxDailyDebit,
      }),
      step(
        'PAYMENT_METHOD',
        paymentDone,
        termsDone,
        [
          terms.paymentMethod === AgencyPaymentMethod.CARD
            ? 'No usable card on file. The agency saves one from its own portal.'
            : 'No valid ACH mandate. The agency completes it from its own portal.',
        ],
        {
          paymentMethod: terms.paymentMethod,
          mandateStatus: terms.mandateStatus,
          hasValidMandate: terms.hasValidMandate,
          bankName: terms.profile?.achBankName ?? null,
          cardBrand: terms.profile?.cardBrand ?? null,
          last4:
            terms.paymentMethod === AgencyPaymentMethod.CARD
              ? terms.profile?.cardLast4 ?? null
              : terms.profile?.achLast4 ?? null,
        }
      ),
      step('OWNER', ownerDone, paymentDone, ['No owner has been invited.'], {
        ownerUserId: owner?.id ?? null,
        ownerEmail: owner?.email ?? grant?.email ?? null,
        ownerStatus: owner?.status ?? null,
        grantIssuedAt: grant?.createdAt ?? null,
        grantExpiresAt: grant?.expiresAt ?? null,
        grantRedeemedAt: grant?.redeemedAt ?? null,
      }),
      step(
        'ENROL',
        terms.enrolled,
        ownerDone,
        enrolBlockers.map(b => b.message),
        {
          enrolled: terms.enrolled,
          enrolledAt: terms.enrolledAt,
          chargesEnabled: terms.chargesEnabled,
        }
      ),
    ];

    return {
      tenantId,
      name: tenant.name,
      steps,
      complete: steps.every(s => s.state === 'COMPLETE'),
    };
  }

  /**
   * GET /api/v1/platform/onboarding/agencies
   *
   * Every agency that is not finished being onboarded, plus the ones that are,
   * so the screen is a list to work down rather than a search box.
   */
  fastify.get<{ Querystring: { includeNonProduction?: string } }>(
    '/api/v1/platform/onboarding/agencies',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const includeNonProduction = request.query.includeNonProduction === 'true';

      const tenants = await prisma.tenant.findMany({
        where: {
          status: 'ACTIVE',
          ...(includeNonProduction ? {} : { isNonProduction: false }),
        },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });

      const rows = await Promise.all(tenants.map(t => onboardingState(t.id)));

      return reply.send({ data: rows.filter(row => row !== null) });
    }
  );

  /**
   * GET /api/v1/platform/onboarding/agencies/:tenantId
   */
  fastify.get<{ Params: { tenantId: string } }>(
    '/api/v1/platform/onboarding/agencies/:tenantId',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const state = await onboardingState(request.params.tenantId);
      if (!state) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Agency not found' } });
      }
      return reply.send({ data: state });
    }
  );

  /**
   * POST /api/v1/platform/onboarding/agencies
   *
   * Step a: the agency itself.
   *
   * Creates the tenant and its profile in one transaction, so there is no
   * window where a tenant exists with no agency behind it. Every field is
   * required: a half-recorded agency is what step b then has to guess from.
   */
  fastify.post<{
    Body: {
      name?: string;
      legalName?: string;
      state?: string;
      contactName?: string;
      contactEmail?: string;
      contactPhone?: string;
      licensedAgentCount?: number;
      deliveryDays?: string[];
      deliveryStartTime?: string;
      deliveryEndTime?: string;
      deliveryTimeZone?: string;
    };
  }>(
    '/api/v1/platform/onboarding/agencies',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const body = request.body ?? {};

      /*
       * Every problem at once. An operator filling in an onboarding form should
       * not discover the requirements one rejected submission at a time -- the
       * same rule the enrolment check follows.
       */
      const problems: string[] = [];

      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const legalName = typeof body.legalName === 'string' ? body.legalName.trim() : '';
      const contactName = typeof body.contactName === 'string' ? body.contactName.trim() : '';
      const contactEmail =
        typeof body.contactEmail === 'string' ? body.contactEmail.trim().toLowerCase() : '';
      const contactPhone = typeof body.contactPhone === 'string' ? body.contactPhone.trim() : '';
      const agencyState =
        typeof body.state === 'string' ? body.state.trim().toUpperCase() : '';

      if (!name) problems.push('name is required');
      if (!legalName) problems.push('legalName is required');
      if (!STATE_PATTERN.test(agencyState)) {
        problems.push('state must be a two-letter US state code');
      }
      if (!contactName) problems.push('contactName is required');
      if (!EMAIL_PATTERN.test(contactEmail)) problems.push('contactEmail must be an email address');
      if (!contactPhone) problems.push('contactPhone is required');

      if (!Number.isInteger(body.licensedAgentCount) || (body.licensedAgentCount as number) <= 0) {
        problems.push('licensedAgentCount must be a whole number of agents, one or more');
      }

      const days = Array.isArray(body.deliveryDays)
        ? body.deliveryDays.map(d => String(d).trim().toUpperCase())
        : [];
      if (days.length === 0) problems.push('deliveryDays must name at least one day');
      if (days.some(d => !DELIVERY_DAYS.includes(d as (typeof DELIVERY_DAYS)[number]))) {
        problems.push(`deliveryDays must be drawn from ${DELIVERY_DAYS.join(', ')}`);
      }

      const start = typeof body.deliveryStartTime === 'string' ? body.deliveryStartTime : '';
      const end = typeof body.deliveryEndTime === 'string' ? body.deliveryEndTime : '';
      if (!TIME_PATTERN.test(start)) problems.push('deliveryStartTime must be HH:MM, 24-hour');
      if (!TIME_PATTERN.test(end)) problems.push('deliveryEndTime must be HH:MM, 24-hour');
      if (TIME_PATTERN.test(start) && TIME_PATTERN.test(end) && end <= start) {
        problems.push('deliveryEndTime must be after deliveryStartTime');
      }

      if (problems.length > 0) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: problems.join('; '), problems },
        });
      }

      const slug = await uniqueSlug(prisma, name);

      const tenant = await prisma.$transaction(async tx => {
        const created = await tx.tenant.create({
          data: { name, slug, status: 'ACTIVE' },
        });

        await tx.agencyProfile.create({
          data: {
            tenantId: created.id,
            legalName,
            state: agencyState,
            contactName,
            contactEmail,
            contactPhone,
            licensedAgentCount: body.licensedAgentCount as number,
            // Deduplicated and ordered as the week runs, so two operators
            // entering the same schedule store the same row.
            deliveryDays: DELIVERY_DAYS.filter(d => days.includes(d)),
            deliveryStartTime: start,
            deliveryEndTime: end,
            deliveryTimeZone: body.deliveryTimeZone ?? 'America/New_York',
            createdByUserId: getActingUserId(request),
          },
        });

        return created;
      });

      await auditLog({
        tenantId: tenant.id,
        userId: getActingUserId(request) ?? undefined,
        action: 'platform.onboarding.tenant.created',
        entityType: 'tenant',
        entityId: tenant.id,
        changes: { name, slug, legalName, state: agencyState, licensedAgentCount: body.licensedAgentCount },
      });

      return reply.code(201).send({ data: await onboardingState(tenant.id) });
    }
  );

  /**
   * PUT /api/v1/platform/onboarding/agencies/:tenantId/terms
   *
   * Step b: the commercial terms, recorded in one act.
   *
   * The opening rate goes to the rating state and the rest to the billing
   * profile, because that is where each already lives -- this route is the
   * onboarding screen's single call, not a second home for either.
   *
   * ── The maximum daily debit ──────────────────────────────────────────────
   *
   * Computed and returned as (daily block + ceiling quantity) x effective rate,
   * where the effective rate is the opening rate plus the agency's offset. It
   * is STORED as an explicit figure -- the one the caller sends, or this
   * computation when they send none -- because it is a contractual commitment
   * on the Insertion Order. A cap recomputed at charge time is not a cap: it
   * would move every time the rate moved, and a settlement could never breach
   * it however large the day.
   */
  fastify.put<{
    Params: { tenantId: string };
    Body: {
      openingRate?: number;
      rateOffset?: number;
      openingBlockApplications?: number;
      dailyBlockApplications?: number;
      ceilingPct?: number;
      maxDailyDebit?: number;
      note?: string;
    };
  }>(
    '/api/v1/platform/onboarding/agencies/:tenantId/terms',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const { tenantId } = request.params;
      const body = request.body ?? {};

      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true },
      });
      if (!tenant) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Agency not found' } });
      }

      /*
       * Step a first. Terms recorded against a tenant with no agency behind it
       * are terms nobody can tie to an agreement.
       */
      const agencyProfile = await prisma.agencyProfile.findUnique({ where: { tenantId } });
      if (!agencyProfile) {
        return reply.code(409).send({
          error: {
            code: 'STEP_OUT_OF_ORDER',
            message: 'Record the agency itself before its terms.',
          },
        });
      }

      const problems: string[] = [];

      const openingRate = body.openingRate;
      if (typeof openingRate !== 'number' || !Number.isFinite(openingRate) || openingRate <= 0) {
        problems.push('openingRate must be a positive number of dollars');
      }

      const rateOffset = body.rateOffset ?? 0;
      if (typeof rateOffset !== 'number' || !Number.isFinite(rateOffset) || rateOffset < 0) {
        problems.push(
          'rateOffset must be zero or a positive number of dollars. It is added to the curve ' +
            'rate at every point on the curve — part of the price, not a fee on top of one.'
        );
      }

      const openingBlock = body.openingBlockApplications;
      if (!Number.isInteger(openingBlock) || (openingBlock as number) <= 0) {
        problems.push('openingBlockApplications must be a whole number of applications');
      }

      const dailyBlock = body.dailyBlockApplications;
      if (!Number.isInteger(dailyBlock) || (dailyBlock as number) <= 0) {
        problems.push('dailyBlockApplications must be a whole number of applications');
      }

      const ceilingPct = body.ceilingPct;
      if (typeof ceilingPct !== 'number' || !Number.isFinite(ceilingPct) || ceilingPct < 0) {
        problems.push('ceilingPct must be zero or more');
      }

      if (problems.length > 0) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: problems.join('; '), problems },
        });
      }

      const effectiveRate = Number(((openingRate as number) + rateOffset).toFixed(2));
      const ceilingApplications = overrunCeilingApplications(
        dailyBlock as number,
        ceilingPct as number
      );
      const computedMaxDailyDebit = maxDailyDebitFor(
        dailyBlock as number,
        ceilingPct as number,
        effectiveRate
      );

      /*
       * The stored maximum is the caller's figure when they send one -- the
       * number that was actually signed -- and the computation only when they
       * do not. It is never silently replaced by the computation: getting it
       * wrong low means nightly halts and getting it wrong high means the cap
       * is not enforced, and both of those are better discovered than papered
       * over by the software substituting its own arithmetic for the contract.
       */
      const maxDailyDebit =
        typeof body.maxDailyDebit === 'number' &&
        Number.isFinite(body.maxDailyDebit) &&
        body.maxDailyDebit > 0
          ? body.maxDailyDebit
          : computedMaxDailyDebit;

      const [profile, ratingState] = await prisma.$transaction([
        prisma.agencyBillingProfile.upsert({
          where: { tenantId },
          create: {
            tenantId,
            dailyBlockApplications: dailyBlock as number,
            maxDailyDebit: new Prisma.Decimal(maxDailyDebit.toFixed(2)),
            rateOffset: new Prisma.Decimal(rateOffset.toFixed(2)),
            ceilingPctBelowThreshold: new Prisma.Decimal(ceilingPct as number),
          },
          update: {
            dailyBlockApplications: dailyBlock as number,
            maxDailyDebit: new Prisma.Decimal(maxDailyDebit.toFixed(2)),
            rateOffset: new Prisma.Decimal(rateOffset.toFixed(2)),
            ceilingPctBelowThreshold: new Prisma.Decimal(ceilingPct as number),
          },
        }),
        prisma.agencyRatingState.upsert({
          where: { tenantId },
          create: {
            tenantId,
            status: 'OPENING_BLOCK',
            openingRate: new Prisma.Decimal((openingRate as number).toFixed(2)),
            openingBlockApplications: openingBlock as number,
            openingAgreementNote: body.note ?? null,
            /*
             * The opening rate is what the agency pays until its first settled
             * Delivery Day, so it is also the rate in force. It is the AGREED
             * rate: the offset is a term applied to CURVE answers from the
             * second Delivery Day on, and adding it to a number that was
             * negotiated whole would charge the agency something nobody signed.
             */
            currentRate: new Prisma.Decimal((openingRate as number).toFixed(2)),
          },
          update: {
            status: 'OPENING_BLOCK',
            openingRate: new Prisma.Decimal((openingRate as number).toFixed(2)),
            openingBlockApplications: openingBlock as number,
            openingAgreementNote: body.note ?? null,
            currentRate: new Prisma.Decimal((openingRate as number).toFixed(2)),
          },
        }),
      ]);

      await auditLog({
        tenantId,
        userId: getActingUserId(request) ?? undefined,
        action: 'platform.onboarding.terms.recorded',
        entityType: 'agency_billing_profile',
        entityId: profile.id,
        changes: {
          openingRate,
          rateOffset,
          effectiveRate,
          openingBlockApplications: openingBlock,
          dailyBlockApplications: dailyBlock,
          ceilingPct,
          maxDailyDebit,
          computedMaxDailyDebit,
          note: body.note ?? null,
        },
      });

      return reply.send({
        data: {
          tenantId,
          openingRate: toNumber(ratingState.openingRate ?? 0),
          rateOffset: toNumber(profile.rateOffset),
          /** The rate the agency is actually charged: the two above, summed. */
          effectiveRate,
          openingBlockApplications: ratingState.openingBlockApplications,
          dailyBlockApplications: profile.dailyBlockApplications,
          ceilingPct: toNumber(profile.ceilingPctBelowThreshold),
          ceilingApplications,
          maxDailyDebit: toNumber(profile.maxDailyDebit),
          /**
           * What the arithmetic gives, beside what was stored, so an operator
           * can see immediately when the signed figure and the computation
           * disagree. They are allowed to disagree; being unable to tell is
           * what is not allowed.
           */
          computedMaxDailyDebit,
          onboarding: await onboardingState(tenantId),
        },
      });
    }
  );

  /**
   * PUT /api/v1/platform/onboarding/agencies/:tenantId/payment-method
   *
   * Step c: which instrument this agency pays with.
   *
   * The same act as the platform terms route's payment-method call, reached
   * from the onboarding screen. The agency completes the mandate or saves the
   * card itself, in its own browser, against a Stripe SetupIntent -- nothing
   * here records a bank account or a card number, and nothing could.
   */
  fastify.put<{ Params: { tenantId: string }; Body: { paymentMethod?: string } }>(
    '/api/v1/platform/onboarding/agencies/:tenantId/payment-method',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const { tenantId } = request.params;
      const requested = (request.body?.paymentMethod ?? '').toUpperCase();

      if (requested !== 'ACH' && requested !== 'CARD') {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'paymentMethod must be ACH or CARD' },
        });
      }

      const profile = await prisma.agencyBillingProfile.findUnique({ where: { tenantId } });
      if (!profile) {
        return reply.code(409).send({
          error: {
            code: 'STEP_OUT_OF_ORDER',
            message: 'Record the agency terms before its payment method.',
          },
        });
      }

      const updated = await prisma.agencyBillingProfile.update({
        where: { tenantId },
        data: { paymentMethod: requested as AgencyPaymentMethod },
      });

      await auditLog({
        tenantId,
        userId: getActingUserId(request) ?? undefined,
        action: 'platform.onboarding.payment_method.recorded',
        entityType: 'agency_billing_profile',
        entityId: updated.id,
        changes: { paymentMethod: requested },
      });

      return reply.send({
        data: { tenantId, paymentMethod: updated.paymentMethod, onboarding: await onboardingState(tenantId) },
      });
    }
  );

  /**
   * POST /api/v1/platform/onboarding/agencies/:tenantId/owner
   *
   * Step d: the agency principal's account.
   *
   * Issues ONE `TenantActivationGrant` for the OWNER role in this agency,
   * through the existing mechanism: 32 random bytes, only the SHA-256 stored,
   * single-use, time-boxed, and bound to the one email address. The plaintext
   * token is returned exactly once, here, for whoever is about to send it.
   *
   * There is deliberately no second invitation path. This route mints a grant;
   * `POST /api/auth/register` redeems it; and registration names no tenant at
   * all, so the tenant travels with the token rather than with the request.
   */
  fastify.post<{ Params: { tenantId: string }; Body: { email?: string } }>(
    '/api/v1/platform/onboarding/agencies/:tenantId/owner',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const { tenantId } = request.params;
      const email =
        typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : '';

      if (!EMAIL_PATTERN.test(email)) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'A valid email address is required' },
        });
      }

      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, name: true },
      });
      if (!tenant) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Agency not found' } });
      }

      const profile = await prisma.agencyProfile.findUnique({ where: { tenantId } });
      if (!profile) {
        return reply.code(409).send({
          error: {
            code: 'STEP_OUT_OF_ORDER',
            message: 'Record the agency itself before inviting its owner.',
          },
        });
      }

      const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (existing) {
        return reply.code(409).send({
          error: {
            code: 'EMAIL_EXISTS',
            message: 'An account with this email already exists',
          },
        });
      }

      const grant = await issueActivationGrant({
        // From the path, which names the agency being administered -- the same
        // reading as every other platform route. The caller's authority is the
        // platform capability; the parameter says who it is pointed at.
        tenantId,
        email,
        roleName: RoleName.OWNER,
        source: TenantActivationSource.ADMIN_INVITE,
      });

      await auditLog({
        tenantId,
        userId: getActingUserId(request) ?? undefined,
        action: 'platform.onboarding.owner.invited',
        entityType: 'tenant_activation_grant',
        entityId: grant.grantId,
        // The token itself is never logged, audited or stored in plaintext. The
        // grant id and the address are what an audit trail needs.
        changes: { email, roleName: 'OWNER', expiresAt: grant.expiresAt.toISOString() },
      });

      return reply.code(201).send({
        data: {
          tenantId,
          email,
          grantId: grant.grantId,
          expiresAt: grant.expiresAt,
          /** Shown once. It is not stored and cannot be read back. */
          activationToken: grant.token,
          onboarding: await onboardingState(tenantId),
        },
      });
    }
  );
}
