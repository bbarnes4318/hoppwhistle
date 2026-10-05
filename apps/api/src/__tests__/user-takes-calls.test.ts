/**
 * PUT /api/v1/users/:userId/takes-calls: an owner who also works the phones
 * becomes an agent (keeps OWNER, gains AGENT), and can stop again.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, principal } = vi.hoisted(() => ({
  prisma: {
    user: { findUnique: vi.fn(), findFirst: vi.fn() },
    role: { findUnique: vi.fn() },
    userRole: { create: vi.fn(), deleteMany: vi.fn() },
    publisher: { findUnique: vi.fn() },
  },
  principal: { current: {} as Record<string, unknown> },
}));

vi.mock('../lib/prisma.js', () => ({ getPrismaClient: () => prisma }));
vi.mock('../services/audit.js', () => ({ auditLog: vi.fn(), auditUpdate: vi.fn() }));

import { registerUserRoutes } from '../routes/index.js';

const OWNER = { userId: 'owner-1', tenantId: 'agency-c', roles: ['OWNER'] };
const AGENT_ONLY = { userId: 'agent-9', tenantId: 'agency-c', roles: ['AGENT'] };

type Target = {
  id: string;
  buyerId: string | null;
  publisherId: string | null;
  roles: Array<{ roleId: string; role: { name: string } }>;
};

const role = (name: string) => ({ roleId: `role-${name}`, role: { name } });

let target: Target | null;
let app: FastifyInstance;

beforeEach(async () => {
  vi.clearAllMocks();
  principal.current = OWNER;
  target = { id: 'sean', buyerId: null, publisherId: null, roles: [role('OWNER')] };
  prisma.user.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
    Promise.resolve({
      id: where.id,
      buyerId: null,
      publisherId: null,
      metadata: {},
      roles: ((principal.current.roles as string[]) ?? []).map(name => ({ role: { name } })),
    })
  );
  prisma.user.findFirst.mockImplementation(
    ({ where }: { where: { id: string; tenantId: string } }) =>
      Promise.resolve(
        target && where.id === target.id && where.tenantId === 'agency-c' ? target : null
      )
  );
  prisma.role.findUnique.mockResolvedValue({ id: 'role-AGENT', name: 'AGENT' });

  app = Fastify();
  app.addHook('preHandler', (request, _reply, done) => {
    (request as unknown as { user: unknown }).user = principal.current;
    done();
  });
  await app.register(registerUserRoutes);
  await app.ready();
});

const put = (userId: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'PUT', url: `/api/v1/users/${userId}/takes-calls`, payload });

describe('PUT /api/v1/users/:userId/takes-calls', () => {
  it('gives an owner the AGENT role and keeps OWNER', async () => {
    const response = await put('sean', { takesCalls: true });

    expect(response.statusCode).toBe(200);
    expect(prisma.userRole.create).toHaveBeenCalledWith({
      data: { userId: 'sean', roleId: 'role-AGENT' },
    });
    expect(prisma.userRole.deleteMany).not.toHaveBeenCalled();
    expect(response.json<{ data: { roles: string[] } }>().data.roles.sort()).toEqual([
      'agent',
      'owner',
    ]);
  });

  it('does nothing when they already take calls', async () => {
    target = { ...target!, roles: [role('OWNER'), role('AGENT')] };
    const response = await put('sean', { takesCalls: true });
    expect(response.statusCode).toBe(200);
    expect(prisma.userRole.create).not.toHaveBeenCalled();
  });

  it('takes AGENT away again, keeping OWNER', async () => {
    target = { ...target!, roles: [role('OWNER'), role('AGENT')] };
    const response = await put('sean', { takesCalls: false });
    expect(response.statusCode).toBe(200);
    expect(prisma.userRole.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'sean', roleId: 'role-AGENT' },
    });
  });

  it("never removes somebody's only role", async () => {
    target = { ...target!, roles: [role('AGENT')] };
    const response = await put('sean', { takesCalls: false });
    expect(response.statusCode).toBe(400);
    expect(prisma.userRole.deleteMany).not.toHaveBeenCalled();
  });

  it('refuses a buyer or publisher login', async () => {
    target = { ...target!, buyerId: 'buyer-1', roles: [role('BUYER')] };
    const response = await put('sean', { takesCalls: true });
    expect(response.statusCode).toBe(400);
    expect(prisma.userRole.create).not.toHaveBeenCalled();
  });

  it('is refused to an agent', async () => {
    principal.current = AGENT_ONLY;
    const response = await put('sean', { takesCalls: true });
    expect(response.statusCode).toBe(403);
    expect(prisma.userRole.create).not.toHaveBeenCalled();
  });

  it('404s a user of another agency', async () => {
    principal.current = { ...OWNER, tenantId: 'agency-z' };
    const response = await put('sean', { takesCalls: true });
    expect(response.statusCode).toBe(404);
  });

  it('wants a boolean', async () => {
    const response = await put('sean', { takesCalls: 'yes' });
    expect(response.statusCode).toBe(400);
  });
});
