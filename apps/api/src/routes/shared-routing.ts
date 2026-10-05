/**
 * Shared routing groups: one DID, several agencies, round robin.
 *
 *   GET    /api/v1/platform/shared-routing-groups
 *   POST   /api/v1/platform/shared-routing-groups                     { name }
 *   PATCH  /api/v1/platform/shared-routing-groups/:groupId            { name?, status? }
 *   DELETE /api/v1/platform/shared-routing-groups/:groupId
 *   POST   /api/v1/platform/shared-routing-groups/:groupId/members    { campaignId }
 *   PATCH  /api/v1/platform/shared-routing-groups/:groupId/members/:memberId { status }
 *   DELETE /api/v1/platform/shared-routing-groups/:groupId/members/:memberId
 *   POST   /api/v1/platform/shared-routing-groups/:groupId/dids       { phoneNumberId, recordingEnabled? }
 *   DELETE /api/v1/platform/shared-routing-groups/:groupId/dids/:routeId
 *
 * A group spans agencies, so every route here is NetEnroll staff only, and
 * every write is audited. Members are added by campaign: the member's agency
 * is always the campaign's own tenant, never something the caller names. See
 * services/shared-routing.ts for how calls are routed and attributed.
 */

import { FastifyInstance, FastifyReply } from 'fastify';

import { requirePlatformAdmin } from '../lib/platform-context.js';
import { getPrismaClient } from '../lib/prisma.js';
import { getActingUserId } from '../lib/tenant-context.js';
import { authenticate } from '../middleware/auth.js';
import { auditLog } from '../services/audit.js';

const STATUSES = new Set(['ACTIVE', 'PAUSED']);

/** The route destination of a shared DID. Never dialed: the group decides per call. */
export const SHARED_ROUTE_DESTINATION = 'Shared';

function notFound(reply: FastifyReply, what: string) {
  return reply.code(404).send({ error: { code: 'NOT_FOUND', message: `${what} not found` } });
}

function invalid(reply: FastifyReply, message: string) {
  return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message } });
}

export async function registerSharedRoutingRoutes(fastify: FastifyInstance): Promise<void> {
  await Promise.resolve();

  const prisma = getPrismaClient();
  const guard = { preHandler: [authenticate, requirePlatformAdmin] };
  const base = '/api/v1/platform/shared-routing-groups';

  const loadGroup = (id: string) =>
    prisma.sharedRoutingGroup.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        members: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            status: true,
            tenantId: true,
            campaignId: true,
            tenant: { select: { name: true } },
            campaign: {
              select: {
                name: true,
                status: true,
                _count: { select: { agents: { where: { status: 'ACTIVE' } } } },
              },
            },
          },
        },
        didRoutes: {
          select: { id: true, did: true, tenantId: true, status: true, totalCalls: true },
        },
      },
    });

  const audit = async (
    request: Parameters<typeof getActingUserId>[0],
    tenantId: string,
    action: string,
    entityId: string,
    changes: Record<string, unknown>
  ) => {
    await auditLog({
      tenantId,
      userId: getActingUserId(request) ?? undefined,
      action,
      entityType: 'shared_routing_group',
      entityId,
      changes,
    });
  };

  /*
   * Pickers for the staff screen: campaigns and numbers across every agency,
   * with the agency named, since a group is built from several of them.
   */
  fastify.get<{ Querystring: { q?: string } }>(
    `${base}/options/campaigns`,
    guard,
    async (request, reply) => {
      const q = request.query.q?.trim();
      const campaigns = await prisma.campaign.findMany({
        where: {
          status: 'ACTIVE',
          ...(q
            ? {
                OR: [
                  { name: { contains: q, mode: 'insensitive' as const } },
                  { tenant: { name: { contains: q, mode: 'insensitive' as const } } },
                ],
              }
            : {}),
        },
        orderBy: [{ tenant: { name: 'asc' } }, { name: 'asc' }],
        take: 100,
        select: {
          id: true,
          name: true,
          tenantId: true,
          tenant: { select: { name: true } },
          _count: { select: { agents: { where: { status: 'ACTIVE' } } } },
        },
      });
      return reply.send({
        data: campaigns.map(c => ({
          id: c.id,
          name: c.name,
          tenantId: c.tenantId,
          tenantName: c.tenant.name,
          activeAgents: c._count.agents,
        })),
      });
    }
  );

  fastify.get<{ Querystring: { q?: string } }>(
    `${base}/options/numbers`,
    guard,
    async (request, reply) => {
      const digits = (request.query.q ?? '').replace(/\D/g, '');
      const numbers = await prisma.phoneNumber.findMany({
        where: { status: 'ACTIVE', ...(digits ? { number: { contains: digits } } : {}) },
        orderBy: { number: 'asc' },
        take: 100,
        select: {
          id: true,
          number: true,
          tenantId: true,
          tenant: { select: { name: true } },
          didRoutes: { select: { sharedRoutingGroupId: true, campaignId: true } },
        },
      });
      return reply.send({
        data: numbers.map(n => ({
          id: n.id,
          number: n.number,
          tenantId: n.tenantId,
          tenantName: n.tenant?.name ?? null,
          sharedRoutingGroupId:
            n.didRoutes.find(r => r.sharedRoutingGroupId)?.sharedRoutingGroupId ?? null,
          campaignId: n.didRoutes.find(r => r.campaignId)?.campaignId ?? null,
        })),
      });
    }
  );

  fastify.get(base, guard, async (_request, reply) => {
    const groups = await prisma.sharedRoutingGroup.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    const data = await Promise.all(groups.map(g => loadGroup(g.id)));
    return reply.send({ data: data.filter(Boolean) });
  });

  fastify.post<{ Body: { name?: string } }>(base, guard, async (request, reply) => {
    const name = request.body?.name?.trim();
    if (!name) return invalid(reply, 'name is required');
    const group = await prisma.sharedRoutingGroup.create({ data: { name } });
    return reply.code(201).send({ data: await loadGroup(group.id) });
  });

  fastify.patch<{ Params: { groupId: string }; Body: { name?: string; status?: string } }>(
    `${base}/:groupId`,
    guard,
    async (request, reply) => {
      const { groupId } = request.params;
      const { name, status } = request.body ?? {};
      if (status !== undefined && !STATUSES.has(status)) {
        return invalid(reply, 'status must be ACTIVE or PAUSED');
      }
      if (name !== undefined && !name.trim()) return invalid(reply, 'name cannot be empty');
      const existing = await prisma.sharedRoutingGroup.findUnique({
        where: { id: groupId },
        select: { id: true, didRoutes: { select: { tenantId: true } } },
      });
      if (!existing) return notFound(reply, 'Shared routing group');

      await prisma.sharedRoutingGroup.update({
        where: { id: groupId },
        data: {
          ...(name !== undefined ? { name: name.trim() } : {}),
          ...(status !== undefined ? { status: status as 'ACTIVE' | 'PAUSED' } : {}),
        },
      });
      for (const tenantId of new Set(existing.didRoutes.map(r => r.tenantId))) {
        await audit(request, tenantId, 'shared_routing.group.updated', groupId, { name, status });
      }
      return reply.send({ data: await loadGroup(groupId) });
    }
  );

  fastify.delete<{ Params: { groupId: string } }>(
    `${base}/:groupId`,
    guard,
    async (request, reply) => {
      const { groupId } = request.params;
      const existing = await prisma.sharedRoutingGroup.findUnique({
        where: { id: groupId },
        select: { id: true, _count: { select: { didRoutes: true } } },
      });
      if (!existing) return notFound(reply, 'Shared routing group');
      // Deleting it under a live DID would leave the DID routed to nothing.
      if (existing._count.didRoutes > 0) {
        return reply.code(409).send({
          error: {
            code: 'GROUP_HAS_DIDS',
            message: 'Remove this group from its DIDs before deleting it',
          },
        });
      }
      await prisma.sharedRoutingGroup.delete({ where: { id: groupId } });
      return reply.code(204).send();
    }
  );

  fastify.post<{ Params: { groupId: string }; Body: { campaignId?: string } }>(
    `${base}/:groupId/members`,
    guard,
    async (request, reply) => {
      const { groupId } = request.params;
      const campaignId = request.body?.campaignId;
      if (!campaignId) return invalid(reply, 'campaignId is required');

      const group = await prisma.sharedRoutingGroup.findUnique({
        where: { id: groupId },
        select: { id: true, members: { select: { tenantId: true, campaignId: true } } },
      });
      if (!group) return notFound(reply, 'Shared routing group');

      const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { id: true, tenantId: true, name: true },
      });
      if (!campaign) return notFound(reply, 'Campaign');

      if (group.members.some(m => m.campaignId === campaign.id)) {
        return reply.code(409).send({
          error: { code: 'ALREADY_MEMBER', message: 'This campaign is already in the group' },
        });
      }
      // The answering agent's agency must name exactly one campaign to record
      // the call under.
      if (group.members.some(m => m.tenantId === campaign.tenantId)) {
        return reply.code(409).send({
          error: {
            code: 'AGENCY_ALREADY_MEMBER',
            message:
              'This agency already has a campaign in the group. One campaign per agency: put the agents on that campaign.',
          },
        });
      }

      const member = await prisma.sharedRoutingGroupMember.create({
        data: { groupId, tenantId: campaign.tenantId, campaignId: campaign.id },
      });
      await audit(request, campaign.tenantId, 'shared_routing.member.added', groupId, {
        memberId: member.id,
        campaignId: campaign.id,
        campaignName: campaign.name,
      });
      return reply.code(201).send({ data: await loadGroup(groupId) });
    }
  );

  fastify.patch<{ Params: { groupId: string; memberId: string }; Body: { status?: string } }>(
    `${base}/:groupId/members/:memberId`,
    guard,
    async (request, reply) => {
      const { groupId, memberId } = request.params;
      const status = request.body?.status;
      if (!status || !STATUSES.has(status)) {
        return invalid(reply, 'status must be ACTIVE or PAUSED');
      }
      const member = await prisma.sharedRoutingGroupMember.findFirst({
        where: { id: memberId, groupId },
        select: { id: true, tenantId: true },
      });
      if (!member) return notFound(reply, 'Member');
      await prisma.sharedRoutingGroupMember.update({
        where: { id: memberId },
        data: { status: status as 'ACTIVE' | 'PAUSED' },
      });
      await audit(request, member.tenantId, 'shared_routing.member.updated', groupId, {
        memberId,
        status,
      });
      return reply.send({ data: await loadGroup(groupId) });
    }
  );

  fastify.delete<{ Params: { groupId: string; memberId: string } }>(
    `${base}/:groupId/members/:memberId`,
    guard,
    async (request, reply) => {
      const { groupId, memberId } = request.params;
      const member = await prisma.sharedRoutingGroupMember.findFirst({
        where: { id: memberId, groupId },
        select: { id: true, tenantId: true, campaignId: true },
      });
      if (!member) return notFound(reply, 'Member');
      await prisma.sharedRoutingGroupMember.delete({ where: { id: memberId } });
      await audit(request, member.tenantId, 'shared_routing.member.removed', groupId, {
        memberId,
        campaignId: member.campaignId,
      });
      return reply.send({ data: await loadGroup(groupId) });
    }
  );

  /*
   * Point a DID at the group. The route stays in the tenant that owns the
   * number -- calls nobody answers are recorded there -- and the number is
   * detached from any user or campaign, which would otherwise route it.
   */
  fastify.post<{
    Params: { groupId: string };
    Body: { phoneNumberId?: string; recordingEnabled?: boolean };
  }>(`${base}/:groupId/dids`, guard, async (request, reply) => {
    const { groupId } = request.params;
    const phoneNumberId = request.body?.phoneNumberId;
    if (!phoneNumberId) return invalid(reply, 'phoneNumberId is required');

    const group = await prisma.sharedRoutingGroup.findUnique({
      where: { id: groupId },
      select: { id: true, name: true },
    });
    if (!group) return notFound(reply, 'Shared routing group');

    const phoneNumber = await prisma.phoneNumber.findUnique({
      where: { id: phoneNumberId },
      select: { id: true, number: true, tenantId: true, status: true },
    });
    if (!phoneNumber) return notFound(reply, 'Phone number');
    if (phoneNumber.status !== 'ACTIVE') return invalid(reply, 'Phone number is not active');

    const routeData = {
      destination: SHARED_ROUTE_DESTINATION,
      buyerId: null,
      campaignId: null,
      sharedRoutingGroupId: groupId,
      status: 'ACTIVE' as const,
      label: `Shared: ${group.name}`,
      ...(request.body?.recordingEnabled !== undefined
        ? { recordingEnabled: request.body.recordingEnabled !== false }
        : {}),
    };

    const route = await prisma.$transaction(async tx => {
      await tx.phoneNumber.update({
        where: { id: phoneNumber.id },
        data: { campaignId: null, userId: null },
      });
      const existing = await tx.didRoute.findFirst({
        where: {
          OR: [
            { phoneNumberId: phoneNumber.id },
            { tenantId: phoneNumber.tenantId, did: phoneNumber.number },
          ],
        },
        select: { id: true },
      });
      if (existing) {
        return tx.didRoute.update({
          where: { id: existing.id },
          data: { ...routeData, phoneNumberId: phoneNumber.id },
        });
      }
      return tx.didRoute.create({
        data: {
          ...routeData,
          tenantId: phoneNumber.tenantId,
          phoneNumberId: phoneNumber.id,
          did: phoneNumber.number,
        },
      });
    });

    await audit(request, phoneNumber.tenantId, 'shared_routing.did.attached', groupId, {
      routeId: route.id,
      did: phoneNumber.number,
    });
    return reply.code(201).send({ data: await loadGroup(groupId) });
  });

  /*
   * Take a DID off the group. The route is paused rather than deleted: it
   * keeps its call counters, and the number can then be assigned to a user or
   * campaign as usual, which re-routes it.
   */
  fastify.delete<{ Params: { groupId: string; routeId: string } }>(
    `${base}/:groupId/dids/:routeId`,
    guard,
    async (request, reply) => {
      const { groupId, routeId } = request.params;
      const route = await prisma.didRoute.findFirst({
        where: { id: routeId, sharedRoutingGroupId: groupId },
        select: { id: true, tenantId: true, did: true },
      });
      if (!route) return notFound(reply, 'Shared DID');
      await prisma.didRoute.update({
        where: { id: route.id },
        data: { sharedRoutingGroupId: null, status: 'PAUSED', destination: '' },
      });
      await audit(request, route.tenantId, 'shared_routing.did.detached', groupId, {
        routeId: route.id,
        did: route.did,
      });
      return reply.send({ data: await loadGroup(groupId) });
    }
  );
}
