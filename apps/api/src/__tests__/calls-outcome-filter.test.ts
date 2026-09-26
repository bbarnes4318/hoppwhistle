/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import { CallDirection, CallStatus, Prisma, RoleName } from '@prisma/client';
import Fastify, { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';
import { registerStaffOnly } from '../middleware/staff-only.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * The Calls ledger's `outcome` and `disputeStatus` filters, through
 * `GET /api/v1/calls` and its CSV export.
 *
 *   outcome=AGENTS       answered by one of the agency's agents
 *   outcome=BUYERS       sent to a buyer
 *   outcome=UNANSWERED   neither answered nor blocked
 *   disputeStatus=DISPUTED  open disputes only
 *   disputeStatus=ANY       every call a dispute was ever filed on
 */

const gate = databaseGate();
announceSkip('Calls outcome filter', gate);

const TEST_JWT_SECRET = 'calls-outcome-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

describe('Calls outcome filter suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `calls outcome suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)('GET /api/v1/calls filters', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;
  let tenantId: string;
  let ownerId: string;
  let ids: Record<string, string>;
  let seq = 0;

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(instance);
    registerStaffOnly(instance);
    const { registerCallRoutes } = await import('../routes/index.js');
    await instance.register(registerCallRoutes);
    await instance.ready();
    return instance;
  }

  function get(url: string) {
    return app.inject({
      method: 'GET',
      url,
      headers: {
        authorization: `Bearer ${app.jwt.sign({ userId: ownerId, tenantId, email: 'o@t.local' })}`,
      },
    });
  }

  async function listed(query: string): Promise<string[]> {
    const response = await get(`/api/v1/calls?limit=100&${query}`);
    expect(response.statusCode, response.body).toBe(200);
    return response
      .json()
      .data.map((call: any) => call.id)
      .sort();
  }

  const names = (...keys: string[]) => keys.map(key => ids[key]).sort();

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    prisma = getPrismaClient();
    for (const table of ['audit_logs', 'roles', 'tenants']) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`).catch(() => {});
    }
    const roleIds: Record<string, string> = {};
    for (const name of [RoleName.OWNER, RoleName.AGENT]) {
      roleIds[name] = (
        await prisma.role.create({ data: { name, description: `${name} role`, permissions: [] } })
      ).id;
    }
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    tenantId = (
      await prisma.tenant.create({ data: { name: 'Agency', slug: `a-${stamp}`, status: 'ACTIVE' } })
    ).id;
    const user = async (role: RoleName, label: string) =>
      (
        await prisma.user.create({
          data: {
            tenantId,
            email: `${label}-${stamp}@agency.local`,
            status: 'ACTIVE',
            roles: { create: { roleId: roleIds[role] } },
          },
        })
      ).id;
    ownerId = await user(RoleName.OWNER, 'owner');
    const agentId = await user(RoleName.AGENT, 'agent');
    const buyerId = (
      await prisma.buyer.create({ data: { tenantId, name: 'Acme', code: `b-${stamp}` } })
    ).id;

    const answeredAt = new Date(Date.now() - 60_000);
    const call = async (data: Partial<Prisma.CallUncheckedCreateInput>) =>
      (
        await prisma.call.create({
          data: {
            tenantId,
            toNumber: '+15550000000',
            callSid: `outcome-${++seq}-${Date.now()}`,
            status: CallStatus.COMPLETED,
            direction: CallDirection.INBOUND,
            ...data,
          },
        })
      ).id;

    ids = {
      agent: await call({ answeredByUserId: agentId, answeredAt }),
      buyer: await call({ buyerId, answeredAt, disputeStatus: 'DISPUTED' }),
      both: await call({
        answeredByUserId: agentId,
        buyerId,
        answeredAt,
        disputeStatus: 'ACCEPTED',
      }),
      unanswered: await call({ disputeStatus: 'DENIED' }),
      blocked: await call({ blocked: true }),
    };

    // Another agency's calls of every kind: never in this ledger.
    const other = await prisma.tenant.create({
      data: { name: 'Other', slug: `o-${stamp}`, status: 'ACTIVE' },
    });
    await prisma.call.create({
      data: {
        tenantId: other.id,
        toNumber: '+15550000000',
        callSid: `outcome-other-${Date.now()}`,
        status: CallStatus.COMPLETED,
        direction: CallDirection.INBOUND,
        disputeStatus: 'DISPUTED',
      },
    });
  });

  it('outcome=AGENTS lists the calls an agent answered', async () => {
    expect(await listed('outcome=AGENTS')).toEqual(names('agent', 'both'));
  });

  it('outcome=BUYERS lists the calls sent to a buyer', async () => {
    expect(await listed('outcome=BUYERS')).toEqual(names('buyer', 'both'));
  });

  it('outcome=UNANSWERED lists the calls nobody answered that were not blocked', async () => {
    expect(await listed('outcome=UNANSWERED')).toEqual(names('unanswered'));
  });

  it('an absent or unknown outcome is no filter', async () => {
    const all = names('agent', 'buyer', 'both', 'unanswered', 'blocked');
    expect(await listed('')).toEqual(all);
    expect(await listed('outcome=SOMETHING')).toEqual(all);
  });

  it('narrows the other filters rather than replacing them', async () => {
    expect(await listed('outcome=AGENTS&disputeStatus=NONE')).toEqual(names('agent'));
  });

  it('disputeStatus=DISPUTED is open disputes only; ANY is every dispute ever filed', async () => {
    expect(await listed('disputeStatus=DISPUTED')).toEqual(names('buyer'));
    expect(await listed('disputeStatus=ANY')).toEqual(names('buyer', 'both', 'unanswered'));
    expect(await listed('disputeStatus=ACCEPTED')).toEqual(names('both'));
    expect(await listed('disputeStatus=DENIED')).toEqual(names('unanswered'));
    expect(await listed('disputeStatus=NONE')).toEqual(names('agent', 'blocked'));
  });

  it('the CSV export honours outcome the same way', async () => {
    const response = await get('/api/v1/calls/export.csv?outcome=UNANSWERED');
    expect(response.statusCode, response.body).toBe(200);
    expect(response.body).toContain(ids.unanswered);
    for (const key of ['agent', 'buyer', 'both', 'blocked']) {
      expect(response.body, key).not.toContain(ids[key]);
    }

    const agents = await get('/api/v1/calls/export.csv?outcome=AGENTS');
    expect(agents.body).toContain(ids.agent);
    expect(agents.body).toContain(ids.both);
    expect(agents.body).not.toContain(ids.buyer);
  });
});
