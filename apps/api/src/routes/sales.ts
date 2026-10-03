/**
 * The B2B Sales CRM and its agreement suite.
 *
 * ── Not the consumer CRM ─────────────────────────────────────────────────────
 *
 * `/insurance-leads` is the consumer-production CRM, and licensed agents work
 * their own consumer prospects there. This is something else: the pipeline a
 * SELLER -- NetEnroll, or a white-label issuer such as Life Leads Plus -- uses
 * to sell its own services to insurance agencies, licensed agents, IMOs/FMOs
 * and call centers, and to send them its MSA and campaign agreements. Its
 * records are `SalesProspect` and `SalesProspectActivity`, never
 * `InsuranceLead`, and an agent sees none of it unless the owner grants it.
 *
 * ── Scope ────────────────────────────────────────────────────────────────────
 *
 *   /api/v1/sales/context                 who I am here, what I may do
 *   /api/v1/sales/metrics                 pipeline and follow-up counts
 *   /api/v1/sales/members                 who prospects can be assigned to
 *   /api/v1/sales/prospects[/:id[/...]]   prospects, stage, activities
 *   /api/v1/sales/access[/:userId]        the owner's grants (TENANT only)
 *   /api/v1/sales/settings                the workspace's agreement suite
 *   /api/v1/sales/agreements/...          the suite's envelopes (agreement-surface.ts)
 *   /api/v1/platform/agreement-suites     platform admins: template sets, seals,
 *                                         link origins, enable/disable
 *
 * Every route resolves the workspace with `resolveSalesWorkspace` and filters
 * every query by it. No route takes a workspace id. A row of another
 * workspace answers 404, exactly like a row that does not exist.
 */

import { isBrandThemeKey } from '@hopwhistle/shared';
import type {
  Prisma,
  PrismaClient,
  SalesActivityType,
  SalesProspectStage,
  SalesProspectType,
} from '@prisma/client';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { clientIp, clientUserAgent } from '../lib/client-ip.js';
import { requirePlatformAdmin } from '../lib/platform-context.js';
import { getPrismaClient } from '../lib/prisma.js';
import {
  resolveSalesWorkspace,
  type ResolvedSalesWorkspace,
  type SalesAccessLevel,
} from '../lib/sales-workspace.js';
import { authenticate } from '../middleware/auth.js';
import { sealConfig, sealRefFor } from '../services/agreements/pdf.js';
import { loadAgreementSettings, SETTINGS_ID } from '../services/agreements/settings.js';
import {
  currentIssuer,
  ensurePlatformWorkspace,
  suiteContext,
  suiteReadiness,
  type SuiteContext,
} from '../services/agreements/suites.js';
import { listTemplateSets, templateSetAssignable } from '../services/agreements/template-sets.js';
import { auditLog } from '../services/audit.js';
import {
  installAgreementSync,
  reconcileProspectAgreements,
} from '../services/sales/agreement-sync.js';
import { isOpenStage, STAGE_ORDER } from '../services/sales/stage-policy.js';

import { registerAgreementSurface } from './agreement-surface.js';

const RANK: Record<SalesAccessLevel, number> = { READONLY: 0, MEMBER: 1, MANAGER: 2 };

const PROSPECT_TYPES = [
  'INSURANCE_AGENCY',
  'LICENSED_AGENT',
  'IMO_FMO',
  'CALL_CENTER',
  'OTHER',
] as const;
const STAGES = [
  'NEW',
  'ATTEMPTING_CONTACT',
  'CONTACTED',
  'QUALIFIED',
  'PROPOSAL',
  'AGREEMENT_SENT',
  'AGREEMENT_REVIEW',
  'AGREEMENT_SIGNED',
  'WON',
  'LOST',
] as const;
/** What a person may record by hand. Agreement entries come only from agreements. */
const MANUAL_ACTIVITY = ['NOTE', 'CALL', 'EMAIL', 'FOLLOW_UP'] as const;

function notFound(reply: FastifyReply, message = 'Prospect not found'): FastifyReply {
  return reply.code(404).send({ error: { code: 'NOT_FOUND', message } });
}

function validation(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(422).send({ error: { code: 'VALIDATION_ERROR', message } });
}

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Invalid request';
  const path = issue.path.join('.');
  return issue.code === 'custom' || !path ? issue.message : `${path}: ${issue.message}`;
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform(v => (v === undefined ? undefined : v ? v : null));

const prospectFields = {
  type: z.enum(PROSPECT_TYPES),
  companyName: optionalText(200),
  primaryContactName: optionalText(200),
  firstName: optionalText(100),
  lastName: optionalText(100),
  email: z
    .union([z.string().trim().email().max(254), z.literal(''), z.null()])
    .optional()
    .transform(v => (v === undefined ? undefined : v ? v.toLowerCase() : null)),
  phone: optionalText(40),
  website: optionalText(300),
  state: optionalText(60),
  address: optionalText(300),
  source: optionalText(120),
  summary: optionalText(5000),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  assignedUserId: z.string().uuid().nullable().optional(),
  nextFollowUpAt: z.string().datetime({ offset: true }).nullable().optional(),
};

const createSchema = z.object({
  ...prospectFields,
  stage: z.enum(STAGES).optional(),
  lostReason: optionalText(500),
});
const updateSchema = z.object({
  ...prospectFields,
  type: z.enum(PROSPECT_TYPES).optional(),
});

/** Eastern Time day bounds, the zone the agreements and the floor work in. */
export function etDayBounds(now = new Date()): { start: Date; end: Date } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value);
  const etAsUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second')
  );
  const offset = etAsUtc - Math.floor(now.getTime() / 1000) * 1000;
  const startUtc = Date.UTC(get('year'), get('month') - 1, get('day')) - offset;
  return { start: new Date(startUtc), end: new Date(startUtc + 24 * 60 * 60 * 1000) };
}

function displayNameOf(p: {
  companyName: string | null;
  primaryContactName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}): string {
  const person = p.primaryContactName || [p.firstName, p.lastName].filter(Boolean).join(' ');
  return p.companyName || person || p.email || 'Unnamed prospect';
}

// eslint-disable-next-line @typescript-eslint/require-await -- plugin signature
export async function registerSalesRoutes(fastify: FastifyInstance): Promise<void> {
  const prisma: PrismaClient = getPrismaClient();
  installAgreementSync();

  /** API keys belong to an agency and carry no person: never a Sales CRM user. */
  async function refuseApiKeys(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    await Promise.resolve();
    if ((request.user as { apiKeyId?: string } | undefined)?.apiKeyId) {
      void reply.code(403).send({
        error: { code: 'FORBIDDEN', message: 'The Sales CRM is not available to API keys.' },
      });
    }
  }
  const guard = { preHandler: [authenticate, refuseApiKeys] };
  const platformGuard = { preHandler: [authenticate, refuseApiKeys, requirePlatformAdmin] };

  async function workspace(
    request: FastifyRequest,
    reply: FastifyReply,
    need: SalesAccessLevel = 'READONLY'
  ): Promise<ResolvedSalesWorkspace | null> {
    const ws = await resolveSalesWorkspace(request, reply);
    if (!ws) return null;
    if (RANK[ws.level] < RANK[need]) {
      void reply.code(403).send({
        error: {
          code: 'FORBIDDEN',
          message:
            need === 'MANAGER'
              ? 'Only a manager of this sales workspace can do this.'
              : 'Your access to this sales workspace is read-only.',
        },
      });
      return null;
    }
    return ws;
  }

  async function audit(
    request: FastifyRequest,
    ws: Pick<ResolvedSalesWorkspace, 'workspace' | 'tenantId' | 'userId'>,
    action: string,
    entityType: string,
    entityId: string | undefined,
    changes: Record<string, unknown> = {}
  ): Promise<void> {
    await auditLog({
      // The issuer's tenant (null for NetEnroll's workspace): never another's.
      tenantId: ws.tenantId,
      userId: ws.userId,
      action,
      entityType,
      entityId,
      resource: request.url,
      method: request.method,
      changes: { salesWorkspaceId: ws.workspace.id, ...changes },
      ipAddress: clientIp(request) ?? undefined,
      userAgent: clientUserAgent(request) ?? undefined,
      requestId: request.id,
      success: true,
    });
  }

  /** The people a prospect may be assigned to in this workspace. */
  async function members(ws: ResolvedSalesWorkspace) {
    if (ws.scope === 'PLATFORM') {
      const admins = await prisma.platformAdmin.findMany({
        include: {
          user: {
            select: { id: true, email: true, firstName: true, lastName: true, status: true },
          },
        },
      });
      return admins
        .filter(a => a.user.status === 'ACTIVE')
        .map(a => ({ ...a.user, access: 'PLATFORM_ADMIN' as const }));
    }
    const users = await prisma.user.findMany({
      where: {
        tenantId: ws.tenantId!,
        status: 'ACTIVE',
        OR: [
          { roles: { some: { role: { name: 'OWNER' } } } },
          { salesWorkspaceAccess: { some: { workspaceId: ws.workspace.id } } },
        ],
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        status: true,
        roles: { select: { role: { select: { name: true } } } },
        salesWorkspaceAccess: { where: { workspaceId: ws.workspace.id }, select: { level: true } },
      },
      orderBy: { email: 'asc' },
    });
    return users.map(u => ({
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      status: u.status,
      access: u.roles.some(r => r.role.name === 'OWNER')
        ? ('OWNER' as const)
        : (u.salesWorkspaceAccess[0]?.level ?? null),
    }));
  }

  async function assignable(
    ws: ResolvedSalesWorkspace,
    userId: string | null | undefined
  ): Promise<boolean> {
    if (!userId) return true;
    return (await members(ws)).some(m => m.id === userId);
  }

  function ctxOf(ws: ResolvedSalesWorkspace): SuiteContext {
    return suiteContext(ws.workspace, ws.suite);
  }

  // ── Context ──────────────────────────────────────────────────────────────

  fastify.get('/api/v1/sales/context', guard, async (request, reply) => {
    const ws = await workspace(request, reply);
    if (!ws) return reply;
    const ctx = ctxOf(ws);
    const readiness = suiteReadiness(ctx);
    const issuer = await currentIssuer(ctx);
    return reply.send({
      data: {
        workspace: { name: ws.workspace.name, scope: ws.scope },
        access: { level: ws.level, via: ws.via },
        can: {
          write: RANK[ws.level] >= RANK.MEMBER,
          manage: ws.level === 'MANAGER',
          grantAccess: ws.level === 'MANAGER' && ws.scope === 'TENANT',
          sendAgreements: RANK[ws.level] >= RANK.MEMBER && readiness.canSend,
        },
        suite: {
          displayName: ws.suite.displayName,
          legalName: issuer.legalName,
          brandTheme: issuer.brandTheme,
          referencePrefix: ws.suite.referencePrefix,
          ...readiness,
        },
      },
    });
  });

  fastify.get('/api/v1/sales/members', guard, async (request, reply) => {
    const ws = await workspace(request, reply);
    if (!ws) return reply;
    return reply.send({ data: await members(ws) });
  });

  // ── Metrics ──────────────────────────────────────────────────────────────

  fastify.get('/api/v1/sales/metrics', guard, async (request, reply) => {
    const ws = await workspace(request, reply);
    if (!ws) return reply;
    const id = ws.workspace.id;
    const { start, end } = etDayBounds();
    const now = new Date();
    const open = {
      workspaceId: id,
      archivedAt: null,
      stage: { notIn: ['WON', 'LOST'] as SalesProspectStage[] },
    };
    const qualifiedStages = STAGE_ORDER.slice(STAGE_ORDER.indexOf('QUALIFIED'));
    const [openCount, qualified, won, lost, overdue, dueToday, out, signed] = await Promise.all([
      prisma.salesProspect.count({ where: open }),
      prisma.salesProspect.count({ where: { ...open, stage: { in: qualifiedStages } } }),
      prisma.salesProspect.count({ where: { workspaceId: id, archivedAt: null, stage: 'WON' } }),
      prisma.salesProspect.count({ where: { workspaceId: id, archivedAt: null, stage: 'LOST' } }),
      prisma.salesProspect.count({ where: { ...open, nextFollowUpAt: { lt: now } } }),
      prisma.salesProspect.count({ where: { ...open, nextFollowUpAt: { gte: now, lt: end } } }),
      prisma.agreementEnvelope.count({
        where: { salesWorkspaceId: id, status: { in: ['SENT', 'VIEWED'] } },
      }),
      prisma.agreementEnvelope.count({
        where: { salesWorkspaceId: id, status: { in: ['SIGNED', 'COMPLETED'] } },
      }),
    ]);
    const byStage = await prisma.salesProspect.groupBy({
      by: ['stage'],
      where: { workspaceId: id, archivedAt: null },
      _count: { _all: true },
    });
    return reply.send({
      data: {
        openProspects: openCount,
        qualified,
        agreementsOut: out,
        agreementsSigned: signed,
        won,
        lost,
        followUpsDueToday: dueToday,
        overdueFollowUps: overdue,
        byStage: Object.fromEntries(byStage.map(b => [b.stage, b._count._all])),
        dayStartsAt: start,
      },
    });
  });

  // ── Prospects ────────────────────────────────────────────────────────────

  fastify.get<{
    Querystring: {
      q?: string;
      stage?: string;
      type?: string;
      assignedUserId?: string;
      followUp?: string;
      archived?: string;
      page?: string;
      pageSize?: string;
      sort?: string;
    };
  }>('/api/v1/sales/prospects', guard, async (request, reply) => {
    const ws = await workspace(request, reply);
    if (!ws) return reply;
    const query = request.query;
    const page = Math.max(1, Number.parseInt(query.page ?? '1', 10) || 1);
    const pageSize = Math.min(200, Math.max(1, Number.parseInt(query.pageSize ?? '50', 10) || 50));
    const stages = (query.stage ?? '')
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter((s): s is SalesProspectStage => (STAGES as readonly string[]).includes(s));
    const types = (query.type ?? '')
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter((s): s is SalesProspectType => (PROSPECT_TYPES as readonly string[]).includes(s));
    const now = new Date();
    const { end } = etDayBounds(now);
    const where: Prisma.SalesProspectWhereInput = {
      workspaceId: ws.workspace.id,
      archivedAt: query.archived === 'true' ? { not: null } : null,
      ...(stages.length > 0 ? { stage: { in: stages } } : {}),
      ...(types.length > 0 ? { type: { in: types } } : {}),
    };
    if (query.assignedUserId === 'me') where.assignedUserId = ws.userId;
    else if (query.assignedUserId === 'none') where.assignedUserId = null;
    else if (z.string().uuid().safeParse(query.assignedUserId).success)
      where.assignedUserId = query.assignedUserId;
    const openOnly = { stage: { notIn: ['WON', 'LOST'] as SalesProspectStage[] } };
    if (query.followUp === 'overdue')
      Object.assign(where, openOnly, { nextFollowUpAt: { lt: now } });
    else if (query.followUp === 'today')
      Object.assign(where, openOnly, { nextFollowUpAt: { gte: now, lt: end } });
    else if (query.followUp === 'upcoming')
      Object.assign(where, openOnly, { nextFollowUpAt: { gte: end } });
    else if (query.followUp === 'none') Object.assign(where, openOnly, { nextFollowUpAt: null });
    const q = (query.q ?? '').trim();
    if (q) {
      where.OR = (
        [
          'companyName',
          'primaryContactName',
          'firstName',
          'lastName',
          'email',
          'phone',
          'state',
          'source',
        ] as const
      ).map(
        field =>
          ({ [field]: { contains: q, mode: 'insensitive' } }) as Prisma.SalesProspectWhereInput
      );
    }
    const orderBy: Prisma.SalesProspectOrderByWithRelationInput[] =
      query.sort === 'followUp'
        ? [{ nextFollowUpAt: { sort: 'asc', nulls: 'last' } }, { updatedAt: 'desc' }]
        : query.sort === 'name'
          ? [{ companyName: { sort: 'asc', nulls: 'last' } }, { primaryContactName: 'asc' }]
          : [{ updatedAt: 'desc' }];
    const [total, rows] = await Promise.all([
      prisma.salesProspect.count({ where }),
      prisma.salesProspect.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          assignedUser: { select: { id: true, email: true, firstName: true, lastName: true } },
        },
      }),
    ]);
    const envelopes =
      rows.length === 0
        ? []
        : await prisma.agreementEnvelope.findMany({
            where: {
              salesWorkspaceId: ws.workspace.id,
              salesProspectId: { in: rows.map(r => r.id) },
            },
            orderBy: { sentAt: 'desc' },
            select: {
              id: true,
              reference: true,
              status: true,
              sentAt: true,
              salesProspectId: true,
            },
          });
    const latest = new Map<string, (typeof envelopes)[number]>();
    for (const e of envelopes)
      if (e.salesProspectId && !latest.has(e.salesProspectId)) latest.set(e.salesProspectId, e);
    return reply.send({
      data: {
        items: rows.map(r => ({
          ...r,
          displayName: displayNameOf(r),
          followUpState:
            !r.nextFollowUpAt || !isOpenStage(r.stage)
              ? null
              : r.nextFollowUpAt < now
                ? 'OVERDUE'
                : r.nextFollowUpAt < end
                  ? 'DUE_TODAY'
                  : 'UPCOMING',
          latestAgreement: latest.get(r.id) ?? null,
        })),
        total,
        page,
        pageSize,
      },
    });
  });

  fastify.post('/api/v1/sales/prospects', guard, async (request, reply) => {
    const ws = await workspace(request, reply, 'MEMBER');
    if (!ws) return reply;
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return validation(reply, firstIssue(parsed.error));
    const body = parsed.data;
    if (
      ![body.companyName, body.primaryContactName, body.firstName, body.lastName, body.email].some(
        Boolean
      )
    ) {
      return validation(
        reply,
        'Give the prospect a company name, a contact name or an email address.'
      );
    }
    if (body.stage === 'LOST' && !body.lostReason)
      return validation(reply, 'Say why the prospect was lost.');
    if (!(await assignable(ws, body.assignedUserId))) {
      return validation(reply, 'That user cannot be assigned in this workspace.');
    }
    const prospect = await prisma.$transaction(async tx => {
      const created = await tx.salesProspect.create({
        data: {
          workspaceId: ws.workspace.id,
          type: body.type,
          companyName: body.companyName ?? null,
          primaryContactName: body.primaryContactName ?? null,
          firstName: body.firstName ?? null,
          lastName: body.lastName ?? null,
          email: body.email ?? null,
          phone: body.phone ?? null,
          website: body.website ?? null,
          state: body.state ?? null,
          address: body.address ?? null,
          source: body.source ?? null,
          summary: body.summary ?? null,
          tags: body.tags ?? [],
          stage: body.stage ?? 'NEW',
          lostReason: body.stage === 'LOST' ? (body.lostReason ?? null) : null,
          assignedUserId: body.assignedUserId ?? null,
          nextFollowUpAt: body.nextFollowUpAt ? new Date(body.nextFollowUpAt) : null,
          createdByUserId: ws.userId,
        },
      });
      return created;
    });
    await audit(request, ws, 'sales.prospect.created', 'SalesProspect', prospect.id, {
      type: prospect.type,
      displayName: displayNameOf(prospect),
    });
    return reply.code(201).send({ data: { ...prospect, displayName: displayNameOf(prospect) } });
  });

  /** One prospect of THIS workspace, or null. */
  async function findProspect(ws: ResolvedSalesWorkspace, id: string) {
    if (!z.string().uuid().safeParse(id).success) return null;
    return prisma.salesProspect.findFirst({ where: { id, workspaceId: ws.workspace.id } });
  }

  fastify.get<{ Params: { id: string } }>(
    '/api/v1/sales/prospects/:id',
    guard,
    async (request, reply) => {
      const ws = await workspace(request, reply);
      if (!ws) return reply;
      const found = await findProspect(ws, request.params.id);
      if (!found) return notFound(reply);
      await reconcileProspectAgreements(prisma, ws.workspace.id, found.id);
      const prospect = await prisma.salesProspect.findFirstOrThrow({
        where: { id: found.id, workspaceId: ws.workspace.id },
        include: {
          assignedUser: { select: { id: true, email: true, firstName: true, lastName: true } },
        },
      });
      const [activities, envelopes] = await Promise.all([
        prisma.salesProspectActivity.findMany({
          where: { workspaceId: ws.workspace.id, prospectId: prospect.id },
          orderBy: { occurredAt: 'desc' },
          take: 500,
        }),
        prisma.agreementEnvelope.findMany({
          where: { salesWorkspaceId: ws.workspace.id, salesProspectId: prospect.id },
          orderBy: { sentAt: 'desc' },
          select: {
            id: true,
            reference: true,
            status: true,
            includesMsa: true,
            includesCpa: true,
            includesCpl: true,
            sentAt: true,
            viewedAt: true,
            signedAt: true,
            completedAt: true,
            voidedAt: true,
            changesRequestedAt: true,
            expiresAt: true,
            signerName: true,
            signerEmail: true,
            terms: true,
          },
        }),
      ]);
      const actorIds = Array.from(
        new Set(activities.map(a => a.actorUserId).filter((v): v is string => !!v))
      );
      const actors = actorIds.length
        ? await prisma.user.findMany({
            where: { id: { in: actorIds } },
            select: { id: true, email: true, firstName: true, lastName: true },
          })
        : [];
      const actorById = new Map(actors.map(a => [a.id, a]));
      return reply.send({
        data: {
          ...prospect,
          displayName: displayNameOf(prospect),
          activities: activities.map(a => ({
            ...a,
            actor: a.actorUserId ? (actorById.get(a.actorUserId) ?? null) : null,
          })),
          // The frozen terms stay on the server; only the date a screen shows leaves.
          agreements: envelopes.map(({ terms, ...rest }) => ({
            ...rest,
            effectiveDate: (terms as { effectiveDate?: string } | null)?.effectiveDate ?? null,
          })),
        },
      });
    }
  );

  fastify.patch<{ Params: { id: string } }>(
    '/api/v1/sales/prospects/:id',
    guard,
    async (request, reply) => {
      const ws = await workspace(request, reply, 'MEMBER');
      if (!ws) return reply;
      const found = await findProspect(ws, request.params.id);
      if (!found) return notFound(reply);
      const parsed = updateSchema.safeParse(request.body);
      if (!parsed.success) return validation(reply, firstIssue(parsed.error));
      const body = parsed.data;
      if (body.assignedUserId !== undefined && !(await assignable(ws, body.assignedUserId))) {
        return validation(reply, 'That user cannot be assigned in this workspace.');
      }
      const data: Prisma.SalesProspectUpdateInput = {};
      const fields = [
        'type',
        'companyName',
        'primaryContactName',
        'firstName',
        'lastName',
        'email',
        'phone',
        'website',
        'state',
        'address',
        'source',
        'summary',
        'tags',
      ] as const;
      for (const field of fields) {
        if (body[field] !== undefined) (data as Record<string, unknown>)[field] = body[field];
      }
      if (body.assignedUserId !== undefined) {
        data.assignedUser = body.assignedUserId
          ? { connect: { id: body.assignedUserId } }
          : { disconnect: true };
      }
      if (body.nextFollowUpAt !== undefined) {
        data.nextFollowUpAt = body.nextFollowUpAt ? new Date(body.nextFollowUpAt) : null;
      }
      const merged = { ...found, ...(data as Record<string, unknown>) } as typeof found;
      if (
        ![
          merged.companyName,
          merged.primaryContactName,
          merged.firstName,
          merged.lastName,
          merged.email,
        ].some(Boolean)
      ) {
        return validation(
          reply,
          'Give the prospect a company name, a contact name or an email address.'
        );
      }
      const updated = await prisma.$transaction(async tx => {
        const row = await tx.salesProspect.update({ where: { id: found.id }, data });
        if (
          body.nextFollowUpAt !== undefined &&
          body.nextFollowUpAt !== (found.nextFollowUpAt?.toISOString() ?? null)
        ) {
          await tx.salesProspectActivity.create({
            data: {
              workspaceId: ws.workspace.id,
              prospectId: found.id,
              type: 'FOLLOW_UP',
              body: body.nextFollowUpAt ? 'Next follow-up scheduled.' : 'Follow-up cleared.',
              detail: { nextFollowUpAt: body.nextFollowUpAt },
              actorUserId: ws.userId,
            },
          });
        }
        return row;
      });
      await audit(request, ws, 'sales.prospect.updated', 'SalesProspect', found.id, {
        fields: Object.keys(data),
      });
      return reply.send({ data: { ...updated, displayName: displayNameOf(updated) } });
    }
  );

  fastify.post<{ Params: { id: string } }>(
    '/api/v1/sales/prospects/:id/stage',
    guard,
    async (request, reply) => {
      const ws = await workspace(request, reply, 'MEMBER');
      if (!ws) return reply;
      const found = await findProspect(ws, request.params.id);
      if (!found) return notFound(reply);
      const parsed = z
        .object({ stage: z.enum(STAGES), lostReason: optionalText(500), note: optionalText(2000) })
        .safeParse(request.body);
      if (!parsed.success) return validation(reply, firstIssue(parsed.error));
      const { stage, lostReason, note } = parsed.data;
      if (stage === 'LOST' && !lostReason)
        return validation(reply, 'Say why the prospect was lost.');
      if (stage === found.stage)
        return reply.send({ data: { ...found, displayName: displayNameOf(found) } });
      const updated = await prisma.$transaction(async tx => {
        const row = await tx.salesProspect.update({
          where: { id: found.id },
          data: { stage, lostReason: stage === 'LOST' ? lostReason : null },
        });
        await tx.salesProspectActivity.create({
          data: {
            workspaceId: ws.workspace.id,
            prospectId: found.id,
            type: 'STAGE_CHANGE',
            body:
              note ??
              (stage === 'LOST'
                ? `Marked lost: ${lostReason}`
                : `Stage moved from ${found.stage} to ${stage}.`),
            detail: {
              from: found.stage,
              to: stage,
              automatic: false,
              ...(stage === 'LOST' ? { lostReason } : {}),
            },
            actorUserId: ws.userId,
          },
        });
        return row;
      });
      await audit(request, ws, 'sales.prospect.stage_changed', 'SalesProspect', found.id, {
        from: found.stage,
        to: stage,
      });
      return reply.send({ data: { ...updated, displayName: displayNameOf(updated) } });
    }
  );

  for (const action of ['archive', 'restore'] as const) {
    fastify.post<{ Params: { id: string } }>(
      `/api/v1/sales/prospects/:id/${action}`,
      guard,
      async (request, reply) => {
        const ws = await workspace(request, reply, 'MANAGER');
        if (!ws) return reply;
        const found = await findProspect(ws, request.params.id);
        if (!found) return notFound(reply);
        // Archiving hides the prospect. Its agreements are untouched, forever.
        const updated = await prisma.salesProspect.update({
          where: { id: found.id },
          data: { archivedAt: action === 'archive' ? new Date() : null },
        });
        await audit(
          request,
          ws,
          `sales.prospect.${action === 'archive' ? 'archived' : 'restored'}`,
          'SalesProspect',
          found.id,
          {
            displayName: displayNameOf(found),
          }
        );
        return reply.send({ data: { ...updated, displayName: displayNameOf(updated) } });
      }
    );
  }

  fastify.post<{ Params: { id: string } }>(
    '/api/v1/sales/prospects/:id/activities',
    guard,
    async (request, reply) => {
      const ws = await workspace(request, reply, 'MEMBER');
      if (!ws) return reply;
      const found = await findProspect(ws, request.params.id);
      if (!found) return notFound(reply);
      const parsed = z
        .object({
          type: z.enum(MANUAL_ACTIVITY),
          body: z.string().trim().min(1).max(5000),
          occurredAt: z.string().datetime({ offset: true }).optional(),
          nextFollowUpAt: z.string().datetime({ offset: true }).nullable().optional(),
        })
        .safeParse(request.body);
      if (!parsed.success) return validation(reply, firstIssue(parsed.error));
      const body = parsed.data;
      const occurredAt = body.occurredAt ? new Date(body.occurredAt) : new Date();
      if (occurredAt.getTime() > Date.now() + 5 * 60 * 1000) {
        return validation(reply, 'A call or email that was recorded cannot be in the future.');
      }
      const activity = await prisma.$transaction(async tx => {
        const row = await tx.salesProspectActivity.create({
          data: {
            workspaceId: ws.workspace.id,
            prospectId: found.id,
            type: body.type as SalesActivityType,
            body: body.body,
            // Recorded by a person: nothing here claims the system made a call
            // or sent an email.
            detail: { recordedBy: 'user' },
            actorUserId: ws.userId,
            occurredAt,
          },
        });
        const update: Prisma.SalesProspectUpdateInput = {};
        if (body.type === 'CALL' || body.type === 'EMAIL') {
          if (!found.lastContactedAt || found.lastContactedAt < occurredAt)
            update.lastContactedAt = occurredAt;
        }
        if (body.nextFollowUpAt !== undefined) {
          update.nextFollowUpAt = body.nextFollowUpAt ? new Date(body.nextFollowUpAt) : null;
        }
        if (Object.keys(update).length > 0)
          await tx.salesProspect.update({ where: { id: found.id }, data: update });
        return row;
      });
      return reply.code(201).send({ data: activity });
    }
  );

  // ── Access grants (TENANT workspaces) ────────────────────────────────────

  fastify.get('/api/v1/sales/access', guard, async (request, reply) => {
    const ws = await workspace(request, reply, 'MANAGER');
    if (!ws) return reply;
    if (ws.scope === 'PLATFORM') {
      return reply.send({ data: { scope: 'PLATFORM', users: await members(ws) } });
    }
    const users = await prisma.user.findMany({
      where: { tenantId: ws.tenantId! },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        status: true,
        roles: { select: { role: { select: { name: true } } } },
        salesWorkspaceAccess: {
          where: { workspaceId: ws.workspace.id },
          select: { level: true, grantedByUserId: true, createdAt: true, updatedAt: true },
        },
      },
      orderBy: { email: 'asc' },
    });
    return reply.send({
      data: {
        scope: 'TENANT',
        users: users.map(u => {
          const roles = u.roles.map(r => r.role.name);
          const grant = u.salesWorkspaceAccess[0] ?? null;
          return {
            id: u.id,
            email: u.email,
            firstName: u.firstName,
            lastName: u.lastName,
            status: u.status,
            roles,
            implicit: roles.includes('OWNER'),
            level: roles.includes('OWNER') ? 'MANAGER' : (grant?.level ?? null),
            grantedAt: grant?.createdAt ?? null,
          };
        }),
      },
    });
  });

  fastify.put<{ Params: { userId: string } }>(
    '/api/v1/sales/access/:userId',
    guard,
    async (request, reply) => {
      const ws = await workspace(request, reply, 'MANAGER');
      if (!ws) return reply;
      if (ws.scope !== 'TENANT') {
        return reply.code(409).send({
          error: {
            code: 'NO_GRANTS',
            message: "NetEnroll's Sales CRM is reached by platform admins; it takes no grants.",
          },
        });
      }
      const parsed = z
        .object({ level: z.enum(['MANAGER', 'MEMBER', 'READONLY']) })
        .safeParse(request.body);
      if (!parsed.success) return validation(reply, 'Choose Manager, Member or Read only.');
      const target = z.string().uuid().safeParse(request.params.userId).success
        ? await prisma.user.findFirst({
            // The same tenant or nobody: a user of any other tenant is "not found".
            where: { id: request.params.userId, tenantId: ws.tenantId! },
            select: {
              id: true,
              email: true,
              status: true,
              roles: { select: { role: { select: { name: true } } } },
            },
          })
        : null;
      if (!target) return notFound(reply, 'User not found');
      if (target.roles.some(r => r.role.name === 'OWNER')) {
        return validation(reply, 'The owner already has full access to the Sales CRM.');
      }
      const before = await prisma.salesWorkspaceAccess.findUnique({
        where: { workspaceId_userId: { workspaceId: ws.workspace.id, userId: target.id } },
      });
      const grant = await prisma.salesWorkspaceAccess.upsert({
        where: { workspaceId_userId: { workspaceId: ws.workspace.id, userId: target.id } },
        create: {
          workspaceId: ws.workspace.id,
          userId: target.id,
          level: parsed.data.level,
          grantedByUserId: ws.userId,
        },
        update: { level: parsed.data.level, grantedByUserId: ws.userId },
      });
      // The person's role in the agency is not touched: this is a Sales CRM
      // grant, not a promotion.
      await audit(
        request,
        ws,
        before ? 'sales.access.changed' : 'sales.access.granted',
        'SalesWorkspaceAccess',
        grant.id,
        {
          userId: target.id,
          email: target.email,
          before: before?.level ?? null,
          after: grant.level,
        }
      );
      return reply.send({ data: { userId: target.id, level: grant.level } });
    }
  );

  fastify.delete<{ Params: { userId: string } }>(
    '/api/v1/sales/access/:userId',
    guard,
    async (request, reply) => {
      const ws = await workspace(request, reply, 'MANAGER');
      if (!ws) return reply;
      if (ws.scope !== 'TENANT') {
        return reply.code(409).send({
          error: {
            code: 'NO_GRANTS',
            message: "NetEnroll's Sales CRM is reached by platform admins; it takes no grants.",
          },
        });
      }
      const target = z.string().uuid().safeParse(request.params.userId).success
        ? await prisma.user.findFirst({
            where: { id: request.params.userId, tenantId: ws.tenantId! },
            select: {
              id: true,
              email: true,
              roles: { select: { role: { select: { name: true } } } },
            },
          })
        : null;
      if (!target) return notFound(reply, 'User not found');
      if (target.roles.some(r => r.role.name === 'OWNER')) {
        return validation(
          reply,
          "The owner's access is part of owning the agency and cannot be revoked."
        );
      }
      const existing = await prisma.salesWorkspaceAccess.findUnique({
        where: { workspaceId_userId: { workspaceId: ws.workspace.id, userId: target.id } },
      });
      if (!existing) return notFound(reply, 'This user has no Sales CRM access to revoke.');
      await prisma.salesWorkspaceAccess.delete({ where: { id: existing.id } });
      await audit(request, ws, 'sales.access.revoked', 'SalesWorkspaceAccess', existing.id, {
        userId: target.id,
        email: target.email,
        before: existing.level,
      });
      return reply.send({ data: { userId: target.id, level: null } });
    }
  );

  // ── Settings: the workspace's agreement suite ────────────────────────────

  async function settingsView(ws: ResolvedSalesWorkspace) {
    const ctx = ctxOf(ws);
    const issuer = await currentIssuer(ctx);
    const s = ws.suite;
    const ref = sealRefFor(ctx.scope, s.sealSecretRef);
    return {
      scope: ctx.scope,
      displayName: s.displayName,
      legalEntityName: s.legalEntityName,
      dbaName: s.dbaName,
      noticeAddress: s.noticeAddress,
      noticeEmail: s.noticeEmail,
      replyToEmail: s.replyToEmail,
      defaultSignatoryName: s.defaultSignatoryName,
      defaultSignatoryTitle: s.defaultSignatoryTitle,
      internalCopyEmails: s.internalCopyEmails,
      referencePrefix: s.referencePrefix,
      status: s.status,
      // Set by platform admins only; shown, not editable here.
      brandTheme: issuer.brandTheme,
      linkOrigin: issuer.linkOrigin,
      templateSet: ctx.templates.set
        ? {
            key: ctx.templates.set.key,
            label: ctx.templates.set.label,
            installNote: ctx.templates.set.installNote ?? null,
          }
        : null,
      // Whether a seal is configured; the reference and secret never leave the server.
      sealed: sealConfig(ref) !== null,
      legalName: issuer.legalName,
      ...suiteReadiness(ctx),
    };
  }

  fastify.get('/api/v1/sales/settings', guard, async (request, reply) => {
    const ws = await workspace(request, reply);
    if (!ws) return reply;
    return reply.send({ data: await settingsView(ws) });
  });

  const emailOrEmpty = z
    .union([z.string().trim().email().max(254), z.literal(''), z.null()])
    .optional()
    .transform(v => (v === undefined ? undefined : v ? v.toLowerCase() : null));
  const settingsSchema = z.object({
    displayName: z.string().trim().min(2).max(120).optional(),
    legalEntityName: optionalText(200),
    dbaName: optionalText(200),
    noticeAddress: optionalText(300),
    noticeEmail: emailOrEmpty,
    replyToEmail: emailOrEmpty,
    defaultSignatoryName: optionalText(100),
    defaultSignatoryTitle: optionalText(120),
    internalCopyEmails: z.array(z.string().trim().email().max(254)).max(20).optional(),
  });

  fastify.put('/api/v1/sales/settings', guard, async (request, reply) => {
    const ws = await workspace(request, reply, 'MANAGER');
    if (!ws) return reply;
    const parsed = settingsSchema.safeParse(request.body);
    if (!parsed.success) return validation(reply, firstIssue(parsed.error));
    const body = parsed.data;
    // A white-label issuer signs and emails in its own name. Its names may not
    // be NetEnroll's, or its agreements would read as NetEnroll's.
    if (ws.scope === 'TENANT') {
      const named = [body.displayName, body.legalEntityName, body.dbaName].filter(
        (v): v is string => typeof v === 'string'
      );
      if (named.some(v => /net\s*enroll|pvn\s+llc/i.test(v))) {
        return validation(reply, "A white-label suite's names cannot be NetEnroll's or PVN LLC's.");
      }
    }
    const data: Prisma.AgreementSuiteUpdateInput = { updatedByUserId: ws.userId };
    for (const key of Object.keys(body) as Array<keyof typeof body>) {
      if (body[key] === undefined) continue;
      (data as Record<string, unknown>)[key] =
        key === 'internalCopyEmails'
          ? Array.from(new Set((body.internalCopyEmails ?? []).map(e => e.toLowerCase())))
          : body[key];
    }
    // Only this workspace's suite: its id comes from the resolved workspace.
    const before = ws.suite;
    const suite = await prisma.agreementSuite.update({ where: { id: ws.suite.id }, data });
    if (ws.scope === 'PLATFORM') {
      // Keep the legacy NetEnroll row in step, as the platform settings screen does.
      await loadAgreementSettings(prisma);
      await prisma.agreementSettings.update({
        where: { id: SETTINGS_ID },
        data: {
          netenrollNoticeAddress: suite.noticeAddress,
          netenrollNoticeEmail: suite.noticeEmail,
          defaultSignatoryName: suite.defaultSignatoryName ?? undefined,
          defaultSignatoryTitle: suite.defaultSignatoryTitle ?? undefined,
          internalCopyEmails: suite.internalCopyEmails,
          updatedByUserId: ws.userId,
        },
      });
    }
    const changed = Object.keys(body).filter(k => body[k as keyof typeof body] !== undefined);
    await audit(request, ws, 'agreement_suite.settings_updated', 'AgreementSuite', suite.id, {
      before: Object.fromEntries(changed.map(k => [k, (before as Record<string, unknown>)[k]])),
      after: Object.fromEntries(changed.map(k => [k, (suite as Record<string, unknown>)[k]])),
    });
    return reply.send({ data: await settingsView({ ...ws, suite }) });
  });

  // ── The workspace's agreements ───────────────────────────────────────────

  registerAgreementSurface(fastify, prisma, {
    prefix: '/api/v1/sales/agreements',
    preHandler: guard.preHandler,
    resolve: async (request, reply) => {
      const ws = await resolveSalesWorkspace(request, reply);
      if (!ws) return null;
      return {
        ctx: ctxOf(ws),
        level: ws.level,
        // Audit rows belong to the ISSUER's tenant, not the recipient's.
        auditTenantId: () => ws.tenantId,
      };
    },
  });

  // ── Platform administration of every suite ───────────────────────────────

  fastify.get('/api/v1/platform/agreement-suites', platformGuard, async (_request, reply) => {
    await ensurePlatformWorkspace(prisma);
    const suites = await prisma.agreementSuite.findMany({
      include: {
        workspace: { include: { tenant: { select: { id: true, name: true, domain: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return reply.send({
      data: {
        templateSets: listTemplateSets().map(t => ({
          key: t.key,
          label: t.label,
          scope: t.scope,
          brandTheme: t.brandTheme,
          installed: t.documents !== null,
        })),
        suites: suites.map(s => {
          const ctx = suiteContext(s.workspace, s);
          return {
            id: s.id,
            workspace: {
              id: s.workspace.id,
              scope: s.workspace.scopeType,
              name: s.workspace.name,
              tenant: s.workspace.tenant,
            },
            displayName: s.displayName,
            legalEntityName: s.legalEntityName,
            templateSetKey: s.templateSetKey,
            sealSecretRef: s.sealSecretRef,
            sealConfigured: sealConfig(sealRefFor(ctx.scope, s.sealSecretRef)) !== null,
            sealLocation: s.sealLocation,
            linkOrigin: s.linkOrigin,
            brandTheme: s.brandTheme,
            referencePrefix: s.referencePrefix,
            status: s.status,
            ...suiteReadiness(ctx),
          };
        }),
      },
    });
  });

  const adminSchema = z.object({
    templateSetKey: z.string().trim().min(1).max(48).nullable().optional(),
    sealSecretRef: z
      .string()
      .trim()
      .regex(
        /^[A-Z][A-Z0-9_]{0,39}$/,
        'A seal reference is an environment name like LIFE_LEADS_PLUS, never the certificate.'
      )
      .nullable()
      .optional(),
    sealLocation: optionalText(120),
    linkOrigin: z
      .string()
      .trim()
      .regex(/^https:\/\/[a-z0-9.-]+(:\d+)?$/i, 'Use https://host with no path.')
      .nullable()
      .optional(),
    brandTheme: z.string().nullable().optional(),
    referencePrefix: z
      .string()
      .regex(/^[A-Z]{2,5}$/)
      .optional(),
    status: z.enum(['ACTIVE', 'DISABLED']).optional(),
  });

  fastify.put<{ Params: { suiteId: string } }>(
    '/api/v1/platform/agreement-suites/:suiteId',
    platformGuard,
    async (request, reply) => {
      if (!z.string().uuid().safeParse(request.params.suiteId).success)
        return notFound(reply, 'Suite not found');
      const suite = await prisma.agreementSuite.findUnique({
        where: { id: request.params.suiteId },
        include: { workspace: true },
      });
      if (!suite) return notFound(reply, 'Suite not found');
      const parsed = adminSchema.safeParse(request.body);
      if (!parsed.success) return validation(reply, firstIssue(parsed.error));
      const body = parsed.data;
      const scope = suite.workspace.scopeType;
      const brandTheme = body.brandTheme !== undefined ? body.brandTheme : suite.brandTheme;
      if (brandTheme !== null && !isBrandThemeKey(brandTheme))
        return validation(reply, 'Unknown brand theme.');
      if (scope === 'PLATFORM' && brandTheme !== null)
        return validation(reply, "NetEnroll's suite uses NetEnroll's look.");
      const templateSetKey =
        body.templateSetKey !== undefined ? body.templateSetKey : suite.templateSetKey;
      if (!templateSetAssignable(templateSetKey, { scope, brandTheme })) {
        return validation(
          reply,
          'That template set belongs to another issuer and cannot be assigned to this suite.'
        );
      }
      if (body.sealSecretRef === 'DEFAULT' && scope !== 'PLATFORM') {
        return validation(
          reply,
          "DEFAULT is NetEnroll's seal. A white-label suite names its own seal, or none."
        );
      }
      const updated = await prisma.agreementSuite.update({
        where: { id: suite.id },
        data: {
          ...(body.templateSetKey !== undefined ? { templateSetKey } : {}),
          ...(body.sealSecretRef !== undefined ? { sealSecretRef: body.sealSecretRef } : {}),
          ...(body.sealLocation !== undefined ? { sealLocation: body.sealLocation } : {}),
          ...(body.linkOrigin !== undefined
            ? { linkOrigin: body.linkOrigin?.replace(/\/+$/, '') ?? null }
            : {}),
          ...(body.brandTheme !== undefined ? { brandTheme } : {}),
          ...(body.referencePrefix !== undefined ? { referencePrefix: body.referencePrefix } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
        },
      });
      await auditLog({
        tenantId: suite.workspace.tenantId,
        userId: (request.user as { userId?: string }).userId,
        action:
          body.templateSetKey !== undefined
            ? 'agreement_suite.template_set_changed'
            : 'agreement_suite.administration_updated',
        entityType: 'AgreementSuite',
        entityId: suite.id,
        resource: request.url,
        method: request.method,
        changes: {
          salesWorkspaceId: suite.workspaceId,
          before: Object.fromEntries(
            Object.keys(body).map(k => [k, (suite as Record<string, unknown>)[k]])
          ),
          after: Object.fromEntries(
            Object.keys(body).map(k => [k, (updated as Record<string, unknown>)[k]])
          ),
        },
        ipAddress: clientIp(request) ?? undefined,
        userAgent: clientUserAgent(request) ?? undefined,
        requestId: request.id,
        success: true,
      });
      return reply.send({
        data: { id: updated.id, templateSetKey: updated.templateSetKey, status: updated.status },
      });
    }
  );
}
