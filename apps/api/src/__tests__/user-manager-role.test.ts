/* eslint-disable @typescript-eslint/no-unsafe-member-access -- assertions run over parsed JSON responses */
/**
 * PUT /api/v1/users/:userId/manager: an owner makes an agent a manager (keeps
 * AGENT, gains MANAGER) from Team Members, and can take it away again.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerUserRoutes } from '../routes/index.js';

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

const OWNER = { userId: 'owner-1', tenantId: 'agency-c', roles: ['OWNER'] };
const AGENT_ONLY = { userId: 'agent-9', tenantId: 'agency-c', roles: ['AGENT'] };
const MANAGER_ONLY = { userId: 'mgr-2', tenantId: 'agency-c', roles: ['MANAGER'] };

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
  target = { id: 'dana', buyerId: null, publisherId: null, roles: [role('AGENT')] };
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
  prisma.role.findUnique.mockResolvedValue({ id: 'role-MANAGER', name: 'MANAGER' });

  app = Fastify();
  app.addHook('preHandler', (request, _reply, done) => {
    (request as unknown as { user: unknown }).user = principal.current;
    done();
  });
  await app.register(registerUserRoutes);
  await app.ready();
});

const put = (userId: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'PUT', url: `/api/v1/users/${userId}/manager`, payload });

describe('PUT /api/v1/users/:userId/manager', () => {
  it('makes an agent a manager and keeps AGENT', async () => {
    const response = await put('dana', { manager: true });

    expect(response.statusCode).toBe(200);
    expect(prisma.userRole.create).toHaveBeenCalledWith({
      data: { userId: 'dana', roleId: 'role-MANAGER' },
    });
    expect(prisma.userRole.deleteMany).not.toHaveBeenCalled();
    expect(response.json().data.roles).toEqual(['agent', 'manager']);
  });

  it('takes MANAGER away again, leaving AGENT', async () => {
    target!.roles = [role('AGENT'), role('MANAGER')];
    const response = await put('dana', { manager: false });

    expect(response.statusCode).toBe(200);
    expect(prisma.userRole.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'dana', roleId: 'role-MANAGER' },
    });
    expect(response.json().data.roles).toEqual(['agent']);
  });

  it('is a no-op when nothing changes', async () => {
    target!.roles = [role('AGENT'), role('MANAGER')];
    const response = await put('dana', { manager: true });
    expect(response.statusCode).toBe(200);
    expect(prisma.userRole.create).not.toHaveBeenCalled();
  });

  it('refuses an agent or a manager making the change', async () => {
    for (const who of [AGENT_ONLY, MANAGER_ONLY]) {
      principal.current = who;
      const response = await put('dana', { manager: true });
      expect(response.statusCode).toBe(403);
    }
    expect(prisma.userRole.create).not.toHaveBeenCalled();
  });

  it("cannot reach another agency's user", async () => {
    principal.current = { ...OWNER, tenantId: 'agency-x' };
    const response = await put('dana', { manager: true });
    expect(response.statusCode).toBe(404);
    expect(prisma.userRole.create).not.toHaveBeenCalled();
  });

  it('refuses a buyer or publisher login', async () => {
    target = { id: 'b', buyerId: 'buyer-1', publisherId: null, roles: [role('BUYER')] };
    const response = await put('b', { manager: true });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('NOT_AGENCY_STAFF');
  });

  it("never removes somebody's only role", async () => {
    target!.roles = [role('MANAGER')];
    const response = await put('dana', { manager: false });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('ONLY_ROLE');
    expect(prisma.userRole.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects a body that is not a boolean', async () => {
    const response = await put('dana', { manager: 'yes' });
    expect(response.statusCode).toBe(400);
  });
});
