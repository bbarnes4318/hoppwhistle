/**
 * An application counts when an agent dispositions a call "Application
 * Submitted" -- live, or afterwards from Calls -- or marks the prospect as an
 * app from the CRM. These pin both halves of that on the CRM side:
 *
 *   - an app written on a CALL takes the prospect off the Prospects list, by
 *     the customer's number on that call, even when the app form carried no
 *     phone and no lead id (the usual case from the call centre);
 *   - the CRM's own "mark as app" records the application against the lead and
 *     the agent's last call with them, dispositions that call, and refuses to
 *     record the same prospect twice.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const recordAgentApplication = vi.fn();

const mockPrisma = {
  insuranceLead: {
    findFirst: vi.fn(),
    findFirstOrThrow: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
  },
  insuranceCarrierApplication: { findMany: vi.fn() },
  call: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  insuranceActivity: { create: vi.fn() },
};

vi.mock('../../lib/prisma.js', () => ({ getPrismaClient: () => mockPrisma }));
vi.mock('../../lib/logger.js', () => ({
  createServiceLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('../../services/applications/agent-entry.js', () => ({ recordAgentApplication }));

import { getConvertedLeadKeys } from '../../services/crm-pipeline.js';
import { registerInsuranceLeadRoutes } from '../insurance-leads.js';

const TENANT = 'tenant-1';
const AGENT = 'agent-1';

const FORM = {
  clientRequestId: '6f1c2b1e-7a3d-4c5e-9f00-1234567890ab',
  carrier: 'Mutual of Omaha',
  faceAmount: 10000,
  modalPremium: 70,
  paymentMode: 'MONTHLY',
  firstName: 'Pat',
  lastName: 'Prospect',
};

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('onRequest', (request, _reply, done) => {
    (request as { user?: unknown }).user = {
      tenantId: TENANT,
      userId: AGENT,
      roles: ['OWNER', 'ADMIN'],
    };
    done();
  });
  await registerInsuranceLeadRoutes(app);
  await app.ready();
  return app;
}

describe('an application written on a call', () => {
  beforeEach(() => vi.clearAllMocks());

  it('converts the prospect by the number on that call, with no phone on the form', async () => {
    mockPrisma.insuranceCarrierApplication.findMany.mockResolvedValue([
      { insuranceLeadId: null, phone: null, callId: 'call-in' },
      { insuranceLeadId: null, phone: null, callId: 'call-out' },
    ]);
    mockPrisma.call.findMany.mockResolvedValue([
      // Inbound: the customer is the caller, not our DID.
      { id: 'call-in', direction: 'INBOUND', callerId: '+15551112222', toNumber: '+18005550000' },
      // Outbound: the customer is the number dialled.
      { id: 'call-out', direction: 'OUTBOUND', callerId: '+18005550000', toNumber: '+15553334444' },
    ]);

    const keys = await getConvertedLeadKeys({ tenantId: TENANT });

    expect(keys.phones.sort()).toEqual(['5551112222', '5553334444']);
    expect(keys.phones).not.toContain('8005550000');
  });
});

describe('POST /api/v1/insurance-leads/:id/application', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPrisma.insuranceLead.findFirst.mockResolvedValue({
      id: 'lead-1',
      assignedToId: AGENT,
      state: 'TX',
      phone: '5551112222',
    });
    mockPrisma.insuranceLead.findFirstOrThrow.mockResolvedValue({
      id: 'lead-1',
      phone: '5551112222',
      state: 'TX',
    });
    mockPrisma.insuranceLead.update.mockResolvedValue({ id: 'lead-1' });
    mockPrisma.insuranceCarrierApplication.findMany.mockResolvedValue([]);
    mockPrisma.call.findMany.mockResolvedValue([]);
    mockPrisma.call.findFirst.mockResolvedValue({ id: 'call-7' });
    mockPrisma.call.update.mockResolvedValue({ id: 'call-7' });
    recordAgentApplication.mockResolvedValue({ id: 'app-1', tenantId: TENANT });
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('records the app against the lead and the last call, and dispositions that call', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/insurance-leads/lead-1/application',
      payload: FORM,
    });

    expect(res.statusCode).toBe(201);
    expect(recordAgentApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        createdById: AGENT,
        insuranceLeadId: 'lead-1',
        callId: 'call-7',
        phone: '5551112222',
      })
    );
    expect(mockPrisma.call.update).toHaveBeenCalledWith({
      where: { id: 'call-7' },
      data: { disposition: 'APPLICATION_SUBMITTED' },
    });
  });

  it('records it without a call when the agent never spoke to them on one', async () => {
    mockPrisma.call.findFirst.mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/insurance-leads/lead-1/application',
      payload: FORM,
    });

    expect(res.statusCode).toBe(201);
    expect(recordAgentApplication).toHaveBeenCalledWith(expect.objectContaining({ callId: null }));
    expect(mockPrisma.call.update).not.toHaveBeenCalled();
  });

  it('refuses a prospect that already has a submitted app -- no second credit', async () => {
    mockPrisma.insuranceCarrierApplication.findMany.mockResolvedValue([
      { insuranceLeadId: null, phone: null, callId: 'call-in' },
    ]);
    mockPrisma.call.findMany.mockResolvedValue([
      { id: 'call-in', direction: 'INBOUND', callerId: '+15551112222', toNumber: '+18005550000' },
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/insurance-leads/lead-1/application',
      payload: FORM,
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('APPLICATION_ALREADY_RECORDED');
    expect(recordAgentApplication).not.toHaveBeenCalled();
  });

  it('refuses an incomplete form', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/insurance-leads/lead-1/application',
      payload: { ...FORM, carrier: '' },
    });

    expect(res.statusCode).toBe(400);
    expect(recordAgentApplication).not.toHaveBeenCalled();
  });
});
