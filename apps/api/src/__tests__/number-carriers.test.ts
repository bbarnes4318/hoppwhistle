/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import { RoleName } from '@prisma/client';
import Fastify, { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { grantPlatformAdmin } from '../lib/platform-admin.js';
import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';
import { registerStaffOnly } from '../middleware/staff-only.js';
import { provisioningService } from '../services/provisioning/provisioning-service.js';
import type { Provider, ProvisionedNumber } from '../services/provisioning/types.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * Which carriers agencies buy numbers from: a platform admin's choice, and
 * enforced everywhere an agency can buy.
 *
 * Against a real database, with every carrier replaced by a spy -- which
 * carriers are "configured", what each one's inventory search answers, and
 * the purchase itself.
 */

const gate = databaseGate();
announceSkip('Number carriers', gate);

const TEST_JWT_SECRET = 'number-carriers-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

describe('Number carriers suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `number carriers suite cannot run: ${gate.reason}`).toBe(true);
  });
});

function found(provider: Provider, number: string): ProvisionedNumber {
  return {
    id: `${provider}-${number}`,
    number,
    provider,
    status: 'available',
    providerId: `${provider}-${number}`,
    features: { voice: true },
  };
}

describe.skipIf(!gate.available)('Number carriers', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;
  let tenantId: string;
  let ownerId: string;
  let agentId: string;
  let operatorId: string;

  /** Which carriers have credentials, as far as the code under test can tell. */
  let configured: Set<string>;
  /** Each carrier's inventory search: numbers, or an error. */
  let inventory: Record<string, ProvisionedNumber[] | Error>;
  let purchaseAtCarrier: ReturnType<typeof vi.spyOn>;
  let searchAvailable: ReturnType<typeof vi.spyOn>;

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(instance);
    registerStaffOnly(instance);
    const { registerNumberRoutes } = await import('../routes/index.js');
    const { registerFractelProcurementRoutes } = await import('../routes/fractel-procurement.js');
    const { registerBulkvsProcurementRoutes } = await import('../routes/bulkvs-procurement.js');
    const { registerNumberCarrierRoutes } = await import('../routes/number-carriers.js');
    await instance.register(registerNumberRoutes);
    await instance.register(registerFractelProcurementRoutes);
    await instance.register(registerBulkvsProcurementRoutes);
    await instance.register(registerNumberCarrierRoutes);
    await instance.ready();
    return instance;
  }

  const as = (userId: string, tenant?: string) => {
    const token: string = app.jwt.sign({ userId, tenantId: tenant, email: `${userId}@t.local` });
    return { authorization: `Bearer ${token}` };
  };

  const settings = (userId = operatorId, tenant?: string) =>
    app.inject({
      method: 'GET',
      url: '/api/v1/platform/number-carriers',
      headers: as(userId, tenant),
    });

  const save = (payload: unknown, userId = operatorId, tenant?: string) =>
    app.inject({
      method: 'PUT',
      url: '/api/v1/platform/number-carriers',
      headers: as(userId, tenant),
      payload: payload as Record<string, unknown>,
    });

  const carrier = (body: any, provider: string) =>
    body.data.find((c: any) => c.provider === provider);

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    configured = new Set(['fractel', 'bulkvs', 'vonage']);
    inventory = {};
    vi.spyOn(provisioningService, 'isConfigured').mockImplementation(p => configured.has(p));
    searchAvailable = vi
      .spyOn(provisioningService, 'searchAvailable')
      .mockImplementation(provider => {
        const answer = inventory[provider] ?? [];
        return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
      });
    purchaseAtCarrier = vi
      .spyOn(provisioningService, 'purchaseAtCarrier')
      .mockImplementation((provider, request) =>
        Promise.resolve({
          ...found(provider, request.number ?? '+16155550199'),
          status: 'active',
          purchasedAt: new Date(),
        })
      );
    vi.spyOn(provisioningService, 'releaseAtCarrier').mockResolvedValue(undefined);

    prisma = getPrismaClient();
    for (const table of [
      'audit_logs',
      'roles',
      'tenants',
      'platform_admins',
      'number_carrier_settings',
    ]) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`).catch(() => {});
    }
    const roles: Record<string, string> = {};
    for (const name of [RoleName.OWNER, RoleName.AGENT]) {
      roles[name] = (
        await prisma.role.create({ data: { name, description: name, permissions: [] } })
      ).id;
    }
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    tenantId = (
      await prisma.tenant.create({
        data: { name: 'Ridgeline', slug: `ridge-${stamp}`, status: 'ACTIVE' },
      })
    ).id;
    const person = async (label: string, role: RoleName) =>
      (
        await prisma.user.create({
          data: {
            tenantId,
            email: `${label}-${stamp}@ridge.test`,
            status: 'ACTIVE',
            roles: { create: { roleId: roles[role] } },
          },
        })
      ).id;
    ownerId = await person('owner', RoleName.OWNER);
    agentId = await person('agent', RoleName.AGENT);
    operatorId = (
      await prisma.user.create({
        data: { email: `operator-${stamp}@netenroll.test`, status: 'ACTIVE', tenantId: null },
      })
    ).id;
    await grantPlatformAdmin(operatorId, { note: 'number carriers suite' });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    // Rows here outlive the tenant truncation every other suite does, and a
    // carrier left switched off would quietly change what they can buy.
    await prisma.numberCarrierSetting.deleteMany();
  });

  describe('the platform setting', () => {
    it('starts where the Buy dialog always was: FracTEL default, BulkVS on, the rest off', async () => {
      const response = await settings();
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(carrier(body, 'fractel')).toMatchObject({
        enabled: true,
        isDefault: true,
        configured: true,
      });
      expect(carrier(body, 'bulkvs')).toMatchObject({ enabled: true, isDefault: false });
      expect(carrier(body, 'vonage')).toMatchObject({ enabled: false, purchasable: true });
      expect(carrier(body, 'telnyx')).toMatchObject({ enabled: false, purchasable: false });
      expect(carrier(body, 'telnyx').unavailableReason).toBeTruthy();
    });

    it('is a platform admin’s alone: an agency owner and an agent are refused', async () => {
      expect((await settings(ownerId, tenantId)).statusCode).toBe(403);
      expect((await settings(agentId, tenantId)).statusCode).toBe(403);
      const attempt = await save(
        { carriers: [{ provider: 'bulkvs', enabled: false }], defaultProvider: 'fractel' },
        ownerId,
        tenantId
      );
      expect(attempt.statusCode).toBe(403);
      expect(await prisma.numberCarrierSetting.count()).toBe(0);
    });

    it('saves the switches and the default, and audits who changed what', async () => {
      const response = await save({
        carriers: [
          { provider: 'vonage', enabled: true },
          { provider: 'bulkvs', enabled: false },
        ],
        defaultProvider: 'vonage',
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(carrier(body, 'vonage')).toMatchObject({ enabled: true, isDefault: true });
      expect(carrier(body, 'fractel')).toMatchObject({ enabled: true, isDefault: false });
      expect(carrier(body, 'bulkvs')).toMatchObject({ enabled: false });

      // It is what the next read says, not just what this answer said.
      expect(carrier((await settings()).json(), 'vonage').isDefault).toBe(true);

      const audit = await prisma.auditLog.findFirst({
        where: { action: 'number_carriers.updated' },
      });
      expect(audit?.userId).toBe(operatorId);
      expect(audit?.tenantId).toBeNull();
    });

    it.each([
      [
        'switching every carrier off',
        {
          carriers: [
            { provider: 'fractel', enabled: false },
            { provider: 'bulkvs', enabled: false },
          ],
          defaultProvider: null,
        },
        'NO_CARRIER_ENABLED',
      ],
      [
        'a default that is switched off',
        { carriers: [{ provider: 'vonage', enabled: false }], defaultProvider: 'vonage' },
        'DEFAULT_NOT_ENABLED',
      ],
      [
        'a carrier that cannot be bought from here',
        { carriers: [{ provider: 'telnyx', enabled: true }], defaultProvider: 'fractel' },
        'CARRIER_NOT_PURCHASABLE',
      ],
      [
        'an unknown carrier',
        { carriers: [{ provider: 'acme', enabled: true }], defaultProvider: 'fractel' },
        'UNKNOWN_CARRIER',
      ],
    ])('refuses %s', async (_name, payload, code) => {
      const response = await save(payload);
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe(code);
      expect(await prisma.numberCarrierSetting.count()).toBe(0);
    });

    it('refuses to switch on a carrier whose credentials are not on the server', async () => {
      configured.delete('vonage');
      const response = await save({
        carriers: [{ provider: 'vonage', enabled: true }],
        defaultProvider: 'fractel',
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('CARRIER_NOT_CONFIGURED');
    });
  });

  describe('an agency buying', () => {
    it('cannot buy from a carrier the platform switched off, on the old routes either', async () => {
      await save({
        carriers: [{ provider: 'bulkvs', enabled: false }],
        defaultProvider: 'fractel',
      });

      const bought = await app.inject({
        method: 'POST',
        url: '/api/v1/bulkvs/purchase',
        headers: as(ownerId, tenantId),
        payload: { number: '+16155550111' },
      });
      expect(bought.statusCode).toBe(403);
      expect(bought.json().error.code).toBe('CARRIER_DISABLED');

      const searched = await app.inject({
        method: 'GET',
        url: '/api/v1/bulkvs/available?areaCode=615',
        headers: as(ownerId, tenantId),
      });
      expect(searched.statusCode).toBe(403);

      expect(purchaseAtCarrier).not.toHaveBeenCalled();
      expect(await prisma.phoneNumber.count({ where: { tenantId } })).toBe(0);
    });

    it('searches every enabled carrier, the default first, and only those', async () => {
      await save({
        carriers: [
          { provider: 'vonage', enabled: true },
          { provider: 'bulkvs', enabled: false },
        ],
        defaultProvider: 'vonage',
      });
      inventory = {
        vonage: [found('vonage', '+16155550101'), found('vonage', '+16155550102')],
        // Also for sale at Vonage: shown once, from the default.
        fractel: [found('fractel', '+16155550102'), found('fractel', '+16155550103')],
        bulkvs: [found('bulkvs', '+16155550199')],
      };

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/numbers/available?areaCode=615',
        headers: as(ownerId, tenantId),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.map((n: any) => [n.number, n.provider])).toEqual([
        ['+16155550101', 'vonage'],
        ['+16155550102', 'vonage'],
        ['+16155550103', 'fractel'],
      ]);
      expect(body.meta.carriersSearched).toBe(2);
      expect(searchAvailable.mock.calls.map(call => call[0])).toEqual(['vonage', 'fractel']);
    });

    it('shows what the healthy carriers have when one fails, and fails only when all do', async () => {
      inventory = {
        fractel: new Error('FracTEL timed out'),
        bulkvs: [found('bulkvs', '+16155550150')],
      };
      const partial = await app.inject({
        method: 'GET',
        url: '/api/v1/numbers/available?areaCode=615',
        headers: as(ownerId, tenantId),
      });
      expect(partial.statusCode).toBe(200);
      expect(partial.json().data.map((n: any) => n.number)).toEqual(['+16155550150']);

      inventory = { fractel: new Error('down'), bulkvs: new Error('down') };
      const none = await app.inject({
        method: 'GET',
        url: '/api/v1/numbers/available?areaCode=615',
        headers: as(ownerId, tenantId),
      });
      expect(none.statusCode).toBe(502);
      // An agency owner is never shown a carrier, nor its error.
      expect(none.body).not.toMatch(/FracTEL|BulkVS|down/);
    });

    it('gives up on a carrier that never answers, and shows the others', async () => {
      const { searchAvailableNumbers, NumberSearchError } = await import(
        '../services/numbers/number-carriers.js'
      );
      searchAvailable.mockImplementation(provider =>
        provider === 'fractel'
          ? new Promise<ProvisionedNumber[]>(() => undefined) // never settles
          : Promise.resolve([found('bulkvs', '+16155550177')])
      );

      const { numbers } = await searchAvailableNumbers({
        numberType: 'local',
        areaCode: '615',
        timeoutMs: 50,
      });
      expect(numbers.map(n => n.number)).toEqual(['+16155550177']);

      // The only carrier on, and it hangs: a named timeout, not a hang.
      await save({
        carriers: [{ provider: 'bulkvs', enabled: false }],
        defaultProvider: 'fractel',
      });
      const failed = await searchAvailableNumbers({
        numberType: 'local',
        areaCode: '615',
        timeoutMs: 50,
      }).catch((error: unknown) => error);
      expect(failed).toBeInstanceOf(NumberSearchError);
      expect((failed as InstanceType<typeof NumberSearchError>).failures).toEqual([
        {
          provider: 'fractel',
          label: 'FracTEL',
          message: 'FracTEL did not answer within 0 seconds',
        },
      ]);
    });

    it('tells a platform admin inside the agency which carrier failed, and why', async () => {
      await prisma.platformActingTenant.create({ data: { userId: operatorId, tenantId } });
      inventory = {
        fractel: new Error('401 Unauthorized: bad API token'),
        bulkvs: new Error('403 IP not allowlisted'),
      };
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/numbers/available?areaCode=615',
        headers: as(operatorId, tenantId),
      });
      expect(response.statusCode).toBe(502);
      const error = response.json().error;
      expect(error.message).toContain('FracTEL: 401 Unauthorized: bad API token');
      expect(error.message).toContain('BulkVS: 403 IP not allowlisted');
      expect(error.carriers.map((c: any) => c.provider)).toEqual(['fractel', 'bulkvs']);
    });

    it('buys from the carrier the number came from, if the platform still sells from it', async () => {
      await save({
        carriers: [{ provider: 'vonage', enabled: true }],
        defaultProvider: 'vonage',
      });
      const bought = await app.inject({
        method: 'POST',
        url: '/api/v1/numbers/buy',
        headers: as(ownerId, tenantId),
        payload: { provider: 'vonage', number: '+16155550101', areaCode: '615' },
      });
      expect(bought.statusCode).toBe(201);
      expect(purchaseAtCarrier).toHaveBeenCalledTimes(1);
      expect(purchaseAtCarrier.mock.calls[0][0]).toBe('vonage');
      const row = await prisma.phoneNumber.findFirst({ where: { tenantId } });
      expect(row?.provider).toBe('vonage');

      // Switched off since the search: refused, and nothing bought.
      await save({
        carriers: [{ provider: 'vonage', enabled: false }],
        defaultProvider: 'fractel',
      });
      const refused = await app.inject({
        method: 'POST',
        url: '/api/v1/numbers/buy',
        headers: as(ownerId, tenantId),
        payload: { provider: 'vonage', number: '+16155550102' },
      });
      expect(refused.statusCode).toBe(403);
      expect(refused.json().error.code).toBe('CARRIER_DISABLED');
      expect(purchaseAtCarrier).toHaveBeenCalledTimes(1);
    });

    it('is not an agent’s to do', async () => {
      const searched = await app.inject({
        method: 'GET',
        url: '/api/v1/numbers/available?areaCode=615',
        headers: as(agentId, tenantId),
      });
      expect(searched.statusCode).toBe(403);
      const bought = await app.inject({
        method: 'POST',
        url: '/api/v1/numbers/buy',
        headers: as(agentId, tenantId),
        payload: { provider: 'fractel', number: '+16155550101' },
      });
      expect(bought.statusCode).toBe(403);
      expect(purchaseAtCarrier).not.toHaveBeenCalled();
    });

    it('offers toll-free only while a carrier that sells it is on', async () => {
      const tollFree = async () =>
        (
          await app.inject({
            method: 'GET',
            url: '/api/v1/numbers/pricing',
            headers: as(ownerId, tenantId),
          })
        ).json().data.tollFreeAvailable;

      expect(await tollFree()).toBe(true);
      await save({
        carriers: [{ provider: 'fractel', enabled: false }],
        defaultProvider: 'bulkvs',
      });
      expect(await tollFree()).toBe(false);
    });
  });
});
