/**
 * Agency Network: a white-label agency's own downline agencies.
 *
 *   GET  /api/v1/network/agencies?period=<PERIOD_KEY>&from=&to=
 *   POST /api/v1/network/agencies
 *   POST /api/v1/network/agencies/:tenantId/owner      { email }
 *
 * ── What a child is ──────────────────────────────────────────────────────────
 *
 * A normal agency tenant with `parentTenantId` set to the white-label agency
 * that onboarded it, drawn in that agency's brand, and never white-label
 * itself. It is NOT billed by NetEnroll: nothing here writes an
 * `AgencyBillingProfile`, terms or a payment method, so it is never enrolled,
 * never gated on billing and never settled (`settleAgencyForDeliveryDay`
 * skips a child outright).
 *
 * ── What the parent may see and do ───────────────────────────────────────────
 *
 * These three routes, and nothing else. The parent reads its children's
 * AGGREGATES -- counts and one percentage -- and never a call, a lead, a
 * consumer or a user row across the tenant line. It creates a child, and
 * invites that child's owner through `issueActivationGrant`, the one
 * invitation path there is. It can never enter a child, act inside it or
 * preview it: the acting-tenant switch is platform staff's alone and nothing
 * here touches it.
 *
 * `:tenantId` in the owner route is the one place a tenant is named on the
 * wire, and it is honoured only for a child of the ACTING tenant -- anything
 * else, a sibling's child or an unrelated agency, answers 404, the same as an
 * id that does not exist.
 *
 * ── Who ──────────────────────────────────────────────────────────────────────
 *
 * The OWNER or ADMIN of a white-label agency, or a platform admin acting
 * inside one (`requireWhiteLabelOperator`). A normal agency gets 403 on all
 * three.
 */

import { RoleName, TenantActivationSource } from '@prisma/client';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import {
  DELIVERY_DAYS,
  EMAIL_PATTERN,
  STATE_PATTERN,
  TIME_PATTERN,
  uniqueSlug,
} from '../lib/agency-details.js';
import { getPrismaClient } from '../lib/prisma.js';
import { getActingUserId, resolveTenant } from '../lib/tenant-context.js';
import { requireWhiteLabelOperator, WHITE_LABEL_ONLY } from '../lib/white-label.js';
import { authenticate } from '../middleware/auth.js';
import { auditLog } from '../services/audit.js';
import { submittedApplicationWhere } from '../services/rating/measurement.js';
import { issueActivationGrant } from '../services/tenant-activation.js';

import { periodFromQuery, type PeriodQuery } from './call-sales.js';

/** Where the child agency's owner stands. */
export type OwnerActivation = 'NOT_INVITED' | 'PENDING' | 'ACCEPTED' | 'EXPIRED';

interface CreateAgencyBody {
  name?: unknown;
  legalName?: unknown;
  state?: unknown;
  contactName?: unknown;
  contactEmail?: unknown;
  contactPhone?: unknown;
  licensedAgents?: unknown;
  deliveryDays?: unknown;
  deliveryStart?: unknown;
  deliveryEnd?: unknown;
  timezone?: unknown;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Whether the acting tenant itself is on the white-label tier. */
function actingTenantIsWhiteLabel(request: FastifyRequest): boolean {
  return (request.user as { tenantWhiteLabel?: boolean } | undefined)?.tenantWhiteLabel === true;
}

// eslint-disable-next-line @typescript-eslint/require-await -- plugin signature
export async function registerNetworkRoutes(fastify: FastifyInstance): Promise<void> {
  const prisma = getPrismaClient();

  /** One child's owner: accepted, invited and waiting, expired, or never invited. */
  async function ownerActivation(childId: string, now: Date) {
    const [owner, grant] = await Promise.all([
      prisma.user.findFirst({
        where: { tenantId: childId, roles: { some: { role: { name: RoleName.OWNER } } } },
        select: { email: true, createdAt: true },
      }),
      prisma.tenantActivationGrant.findFirst({
        where: { tenantId: childId, roleName: RoleName.OWNER },
        orderBy: { createdAt: 'desc' },
        select: { email: true, createdAt: true, expiresAt: true, redeemedAt: true },
      }),
    ]);

    let status: OwnerActivation = 'NOT_INVITED';
    if (owner || grant?.redeemedAt) status = 'ACCEPTED';
    else if (grant && grant.expiresAt <= now) status = 'EXPIRED';
    else if (grant) status = 'PENDING';

    return {
      status,
      email: owner?.email ?? grant?.email ?? null,
      invitedAt: grant?.createdAt.toISOString() ?? null,
    };
  }

  /**
   * GET /api/v1/network/agencies
   *
   * The acting tenant's children, each as counts over the period. Every query
   * below is a `count` scoped to one child: there is no row from inside a
   * child in the answer, by construction.
   */
  fastify.get<{ Querystring: PeriodQuery }>(
    '/api/v1/network/agencies',
    { preHandler: [authenticate, requireWhiteLabelOperator] },
    async (request, reply) => {
      const tenantId = resolveTenant(request, reply);
      if (!tenantId) return;

      const period = periodFromQuery(request.query, reply);
      if (!period) return;

      const children = await prisma.tenant.findMany({
        where: { parentTenantId: tenantId },
        select: { id: true, name: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      });

      const range = { start: period.start, endExclusive: period.endExclusive };
      const createdInPeriod = { gte: period.start, lt: period.endExclusive };
      const now = new Date();

      const agencies = await Promise.all(
        children.map(async child => {
          const [agents, inboundCalls, answeredByAgents, applications, owner] = await Promise.all([
            prisma.user.count({
              where: { tenantId: child.id, roles: { some: { role: { name: RoleName.AGENT } } } },
            }),
            prisma.call.count({
              where: { tenantId: child.id, direction: 'INBOUND', createdAt: createdInPeriod },
            }),
            prisma.call.count({
              where: {
                tenantId: child.id,
                direction: 'INBOUND',
                createdAt: createdInPeriod,
                answeredByUserId: { not: null },
              },
            }),
            prisma.insuranceCarrierApplication.count({
              where: submittedApplicationWhere(child.id, range),
            }),
            ownerActivation(child.id, now),
          ]);

          return {
            tenantId: child.id,
            name: child.name,
            status: child.status,
            createdAt: child.createdAt.toISOString(),
            agents,
            inboundCalls,
            answeredByAgents,
            applications,
            closingPct:
              answeredByAgents > 0
                ? Math.round((applications / answeredByAgents) * 10000) / 100
                : null,
            owner,
          };
        })
      );

      return reply.send({
        data: {
          period: {
            key: period.key,
            label: period.label,
            from: period.from,
            to: period.to,
            days: period.days,
            complete: period.complete,
          },
          agencies,
        },
      });
    }
  );

  /**
   * POST /api/v1/network/agencies
   *
   * A child agency and its profile, in one transaction, with the same fields
   * and the same validation NetEnroll's own onboarding step (a) uses. Audited
   * on the parent AND on the child, so each side's log says it happened.
   */
  fastify.post<{ Body: CreateAgencyBody }>(
    '/api/v1/network/agencies',
    { preHandler: [authenticate, requireWhiteLabelOperator] },
    async (request, reply) => {
      const tenantId = resolveTenant(request, reply);
      if (!tenantId) return;

      // Staff inside an ordinary agency pass the preHandler; only a
      // white-label agency has a downline.
      if (!actingTenantIsWhiteLabel(request)) {
        return reply.code(403).send({ error: WHITE_LABEL_ONLY });
      }

      const body = request.body ?? {};
      const problems: string[] = [];

      const name = text(body.name);
      const legalName = text(body.legalName);
      const contactName = text(body.contactName);
      const contactEmail = text(body.contactEmail).toLowerCase();
      const contactPhone = text(body.contactPhone);
      const agencyState = text(body.state).toUpperCase();
      const timezone = text(body.timezone) || 'America/New_York';

      if (!name) problems.push('name is required');
      if (!legalName) problems.push('legalName is required');
      if (!STATE_PATTERN.test(agencyState))
        problems.push('state must be a two-letter US state code');
      if (!contactName) problems.push('contactName is required');
      if (!EMAIL_PATTERN.test(contactEmail)) problems.push('contactEmail must be an email address');
      if (!contactPhone) problems.push('contactPhone is required');

      const licensedAgents = body.licensedAgents;
      if (!Number.isInteger(licensedAgents) || (licensedAgents as number) <= 0) {
        problems.push('licensedAgents must be a whole number of agents, one or more');
      }

      const days = Array.isArray(body.deliveryDays)
        ? body.deliveryDays.map(day => String(day).trim().toUpperCase())
        : [];
      if (days.length === 0) problems.push('deliveryDays must name at least one day');
      if (days.some(day => !DELIVERY_DAYS.includes(day as (typeof DELIVERY_DAYS)[number]))) {
        problems.push(`deliveryDays must be drawn from ${DELIVERY_DAYS.join(', ')}`);
      }

      const start = text(body.deliveryStart);
      const end = text(body.deliveryEnd);
      if (!TIME_PATTERN.test(start)) problems.push('deliveryStart must be HH:MM, 24-hour');
      if (!TIME_PATTERN.test(end)) problems.push('deliveryEnd must be HH:MM, 24-hour');
      if (TIME_PATTERN.test(start) && TIME_PATTERN.test(end) && end <= start) {
        problems.push('deliveryEnd must be after deliveryStart');
      }
      if (!isTimeZone(timezone)) problems.push('timezone must be an IANA time zone');

      if (problems.length > 0) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: problems.join('; '), problems },
        });
      }

      const parent = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, name: true, brandTheme: true, brandName: true },
      });
      if (!parent) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Agency not found' } });
      }

      const userId = getActingUserId(request);
      const slug = await uniqueSlug(prisma, name);

      const child = await prisma.$transaction(async tx => {
        const created = await tx.tenant.create({
          data: {
            name,
            slug,
            status: 'ACTIVE',
            parentTenantId: parent.id,
            // Drawn in the parent's brand: its owner signs in to a portal in
            // the white-label agency's colours, not NetEnroll's.
            brandTheme: parent.brandTheme,
            brandName: parent.brandName,
            whiteLabel: false,
          },
        });

        await tx.agencyProfile.create({
          data: {
            tenantId: created.id,
            legalName,
            state: agencyState,
            contactName,
            contactEmail,
            contactPhone,
            licensedAgentCount: licensedAgents as number,
            deliveryDays: DELIVERY_DAYS.filter(day => days.includes(day)),
            deliveryStartTime: start,
            deliveryEndTime: end,
            deliveryTimeZone: timezone,
            createdByUserId: userId,
          },
        });

        return created;
      });

      const changes = {
        parentTenantId: parent.id,
        childTenantId: child.id,
        name,
        slug,
        legalName,
        state: agencyState,
        licensedAgents,
      };
      await auditLog({
        tenantId: parent.id,
        userId: userId ?? undefined,
        action: 'network.agency.created',
        entityType: 'tenant',
        entityId: child.id,
        changes,
      });
      await auditLog({
        tenantId: child.id,
        userId: userId ?? undefined,
        action: 'network.agency.created_by_parent',
        entityType: 'tenant',
        entityId: child.id,
        changes,
      });

      return reply.code(201).send({
        data: {
          tenantId: child.id,
          name: child.name,
          slug: child.slug,
          parentTenantId: parent.id,
          owner: { status: 'NOT_INVITED' as OwnerActivation, email: null, invitedAt: null },
        },
      });
    }
  );

  /**
   * POST /api/v1/network/agencies/:tenantId/owner
   *
   * The child's owner, invited the one way owners are: an activation grant
   * from `issueActivationGrant`, single-use, hashed, bound to one address --
   * exactly as NetEnroll's onboarding step (d) issues one, and emailed the
   * same way. The token is returned once, here.
   */
  fastify.post<{ Params: { tenantId: string }; Body: { email?: unknown } }>(
    '/api/v1/network/agencies/:tenantId/owner',
    { preHandler: [authenticate, requireWhiteLabelOperator] },
    async (request, reply) => {
      const actingTenantId = resolveTenant(request, reply);
      if (!actingTenantId) return;

      // A child of the ACTING tenant, or it does not exist for this caller.
      const child = await prisma.tenant.findFirst({
        where: { id: request.params.tenantId, parentTenantId: actingTenantId },
        select: { id: true, name: true },
      });
      if (!child) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Agency not found' } });
      }

      const email = text(request.body?.email).toLowerCase();
      if (!EMAIL_PATTERN.test(email)) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'A valid email address is required' },
        });
      }

      const profile = await prisma.agencyProfile.findUnique({ where: { tenantId: child.id } });
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
          error: { code: 'EMAIL_EXISTS', message: 'An account with this email already exists' },
        });
      }

      const grant = await issueActivationGrant({
        tenantId: child.id,
        email,
        roleName: RoleName.OWNER,
        source: TenantActivationSource.ADMIN_INVITE,
      });

      const userId = getActingUserId(request) ?? undefined;
      // The token itself is never logged, audited or stored in plaintext.
      const changes = {
        parentTenantId: actingTenantId,
        childTenantId: child.id,
        email,
        roleName: 'OWNER',
        expiresAt: grant.expiresAt.toISOString(),
      };
      await auditLog({
        tenantId: actingTenantId,
        userId,
        action: 'network.agency.owner_invited',
        entityType: 'tenant_activation_grant',
        entityId: grant.grantId,
        changes,
      });
      await auditLog({
        tenantId: child.id,
        userId,
        action: 'network.agency.owner_invited_by_parent',
        entityType: 'tenant_activation_grant',
        entityId: grant.grantId,
        changes,
      });

      // Best-effort, exactly as onboarding step (d): the grant stands and the
      // token is returned whether or not SMTP accepted the message.
      const { sendAgentInvitationEmail } = await import('../services/agent-invite-email.js');
      const delivery = await sendAgentInvitationEmail({
        email,
        agencyName: child.name,
        activationToken: grant.token,
        expiresAt: grant.expiresAt,
        role: 'OWNER',
      });

      return reply.code(201).send({
        data: {
          tenantId: child.id,
          email,
          grantId: grant.grantId,
          expiresAt: grant.expiresAt,
          /** Shown once. It is not stored and cannot be read back. */
          activationToken: grant.token,
          /** False when SMTP is unconfigured or refused it. Hand-deliver then. */
          emailed: delivery.sent,
          emailFailureReason: delivery.reason ?? null,
        },
      });
    }
  );
}
