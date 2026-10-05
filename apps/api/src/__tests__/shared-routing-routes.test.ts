/**
 * Shared routing groups are cross-agency, so staff only; a member's agency is
 * the campaign's own tenant, never one the caller names; and an agency has at
 * most one campaign in a group.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, principal } = vi.hoisted(() => ({
  prisma: {
    sharedRoutingGroup: { findUnique: vi.fn() },
    sharedRoutingGroupMember: { create: vi.fn() },
    campaign: { findUnique: vi.fn() },
    user: { findFirst: vi.fn() },
    role: { findUnique: vi.fn() },
    userRole: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  },
  principal: { current: {} as Record<string, unknown> },
}));

vi.mock('../lib/prisma.js', () => ({ getPrismaClient: () => prisma }));
vi.mock('../middleware/auth.js', () => ({
  authenticate: vi.fn((request: { user?: unknown }) => {
    request.user = principal.current;
    return Promise.resolve(undefined);
  }),
}));
vi.mock('../services/audit.js', () => ({ auditLog: vi.fn() }));

import { registerSharedRoutingRoutes } from '../routes/shared-routing.js';

const STAFF = { userId: 'staff-1', isPlatformAdmin: true };
const AGENCY_OWNER = { userId: 'owner-1', tenantId: 'agency-a', roles: ['OWNER'] };

let app: FastifyInstance;

beforeEach(async () => {
  vi.clearAllMocks();
  principal.current = STAFF;
  prisma.sharedRoutingGroup.findUnique.mockResolvedValue({
    id: 'group-1',
    members: [{ tenantId: 'agency-a', campaignId: 'camp-a', userId: null }],
  });
  prisma.campaign.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
    Promise.resolve(
      {
        'camp-a2': { id: 'camp-a2', tenantId: 'agency-a', name: 'A again' },
        'camp-b': { id: 'camp-b', tenantId: 'agency-b', name: 'B FE' },
      }[where.id] ?? null
    )
  );
  prisma.sharedRoutingGroupMember.create.mockResolvedValue({ id: 'member-b' });
  prisma.user.findFirst.mockImplementation(({ where }: { where: { id: string } }) =>
    Promise.resolve(
      {
        sean: {
          id: 'sean',
          tenantId: 'agency-c',
          status: 'ACTIVE',
          firstName: 'Sean',
          lastName: 'Grove',
          roles: [{ role: { name: 'AGENT' } }],
        },
        'a-agent': {
          id: 'a-agent',
          tenantId: 'agency-a',
          status: 'ACTIVE',
          firstName: 'Ann',
          lastName: 'A',
          roles: [{ role: { name: 'AGENT' } }],
        },
        'owner-only': {
          id: 'owner-only',
          tenantId: 'agency-c',
          status: 'ACTIVE',
          firstName: 'Sean',
          lastName: 'Owner',
          roles: [{ role: { name: 'OWNER' } }],
        },
        pending: {
          id: 'pending',
          tenantId: 'agency-c',
          status: 'PENDING',
          firstName: 'Pat',
          lastName: 'Pending',
          roles: [{ role: { name: 'OWNER' } }],
        },
      }[where.id] ?? null
    )
  );

  app = Fastify();
  await registerSharedRoutingRoutes(app);
  await app.ready();
});

const addMember = (body: Record<string, unknown>) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/platform/shared-routing-groups/group-1/members',
    payload: body,
  });

describe('POST /api/v1/platform/shared-routing-groups/:groupId/members', () => {
  it('adds the campaign under its own agency, whatever tenant the body names', async () => {
    const response = await addMember({ campaignId: 'camp-b', tenantId: 'agency-z' });

    expect(response.statusCode).toBe(201);
    expect(prisma.sharedRoutingGroupMember.create).toHaveBeenCalledWith({
      data: { groupId: 'group-1', tenantId: 'agency-b', campaignId: 'camp-b' },
    });
  });

  it('refuses a second campaign from an agency already in the group', async () => {
    const response = await addMember({ campaignId: 'camp-a2' });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: 'AGENCY_ALREADY_MEMBER' } });
    expect(prisma.sharedRoutingGroupMember.create).not.toHaveBeenCalled();
  });

  it('is refused to an agency owner', async () => {
    principal.current = AGENCY_OWNER;

    const response = await addMember({ campaignId: 'camp-b' });

    expect(response.statusCode).toBe(403);
    expect(prisma.sharedRoutingGroupMember.create).not.toHaveBeenCalled();
  });
});

describe('adding a single agent', () => {
  it('adds them under their own agency, with no campaign', async () => {
    const response = await addMember({ userId: 'sean' });

    expect(response.statusCode).toBe(201);
    expect(prisma.sharedRoutingGroupMember.create).toHaveBeenCalledWith({
      data: { groupId: 'group-1', tenantId: 'agency-c', userId: 'sean', campaignId: undefined },
    });
  });

  it('finds agents, owners and administrators -- never a buyer or publisher login', async () => {
    await addMember({ userId: 'sean' });
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'sean',
          buyerId: null,
          publisherId: null,
          roles: { some: { role: { name: { in: ['AGENT', 'OWNER', 'ADMIN'] } } } },
        },
      })
    );
  });

  it('does not touch the roles of somebody who is already an agent', async () => {
    await addMember({ userId: 'sean' });
    expect(prisma.userRole.create).not.toHaveBeenCalled();
  });

  it('makes an owner an agent as well, so the calls they answer are credited', async () => {
    prisma.role.findUnique.mockResolvedValue({ id: 'role-agent', name: 'AGENT' });

    const response = await addMember({ userId: 'owner-only' });

    expect(response.statusCode).toBe(201);
    expect(prisma.userRole.create).toHaveBeenCalledWith({
      data: { userId: 'owner-only', roleId: 'role-agent' },
    });
    expect(prisma.sharedRoutingGroupMember.create).toHaveBeenCalledWith({
      data: {
        groupId: 'group-1',
        tenantId: 'agency-c',
        userId: 'owner-only',
        campaignId: undefined,
      },
    });
  });

  it('refuses an account that is not active, and says so', async () => {
    const response = await addMember({ userId: 'pending' });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('pending');
    expect(prisma.userRole.create).not.toHaveBeenCalled();
    expect(prisma.sharedRoutingGroupMember.create).not.toHaveBeenCalled();
  });

  it('adds an agent from an agency that already has a campaign in the group', async () => {
    const response = await addMember({ userId: 'a-agent', campaignId: 'camp-a2' });

    expect(response.statusCode).toBe(201);
    expect(prisma.sharedRoutingGroupMember.create).toHaveBeenCalledWith({
      data: { groupId: 'group-1', tenantId: 'agency-a', userId: 'a-agent', campaignId: 'camp-a2' },
    });
  });

  it("refuses a campaign from another agency than the agent's", async () => {
    const response = await addMember({ userId: 'sean', campaignId: 'camp-b' });

    expect(response.statusCode).toBe(400);
    expect(prisma.sharedRoutingGroupMember.create).not.toHaveBeenCalled();
  });

  it('refuses an agent already in the group', async () => {
    prisma.sharedRoutingGroup.findUnique.mockResolvedValue({
      id: 'group-1',
      members: [{ tenantId: 'agency-c', campaignId: null, userId: 'sean' }],
    });

    const response = await addMember({ userId: 'sean' });

    expect(response.statusCode).toBe(409);
  });

  it('404s an unknown or non-agent user', async () => {
    const response = await addMember({ userId: 'nobody' });
    expect(response.statusCode).toBe(404);
  });
});
