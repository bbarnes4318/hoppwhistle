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
    members: [{ tenantId: 'agency-a', campaignId: 'camp-a' }],
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
