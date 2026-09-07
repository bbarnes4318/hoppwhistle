/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
/**
 * The Anveo inventory sync.
 *
 * The bug this covers: the Numbers page reads `phone_numbers` and nothing else,
 * and a DID bought in the Anveo portal was never written there, so seven live
 * DIDs were invisible to the product. The sync closes that -- and the tests
 * below hold it to the narrow authority it claims, because the failure mode of
 * an over-eager sync is worse than the gap it fixes: it would reset the
 * campaign, agent and status an operator set by hand every time it ran.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = {
  carrier: { findFirst: vi.fn() },
  phoneNumber: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
};

const listDids = vi.fn();

vi.mock('../../../lib/prisma.js', () => ({
  getPrismaClient: () => prismaMock,
}));

vi.mock('../anveo-did-service.js', () => ({
  getAnveoDIDService: () => ({ listDids }),
}));

import { normalizeE164, syncAnveoNumbers } from '../anveo-sync.js';

const TENANT = 'tenant-1';

function anveoDid(overrides: Record<string, unknown> = {}) {
  return {
    e164: '12548319807',
    didType: 'GEOGRAPHIC',
    smsUrl: '',
    smsEmail: '',
    callForwardType: 'SIP_URI',
    callForwardTo: '$[E164]$@178.156.223.97:5080',
    status: 'ACTIVE',
    countryName: 'U.S.A',
    areaName: 'US-TX',
    areaCode: '254',
    monthly100: 149,
    ratePlanId: 'rp-1',
    title: 'Anveo Direct Prime',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.carrier.findFirst.mockResolvedValue(null);
  prismaMock.phoneNumber.findUnique.mockResolvedValue(null);
  prismaMock.phoneNumber.create.mockImplementation(({ data }: any) =>
    Promise.resolve({ id: `pn-${data.number}`, ...data })
  );
  prismaMock.phoneNumber.update.mockResolvedValue({});
});

describe('normalizeE164', () => {
  it("adds the plus Anveo omits, so the row matches the one we'd already have", () => {
    // phone_numbers is unique on (tenantId, number) and every other writer
    // stores +1...; without this the sync would insert a duplicate rather than
    // recognise the DID it was asked to reconcile.
    expect(normalizeE164('12548319807')).toBe('+12548319807');
    expect(normalizeE164('+1 (254) 831-9807')).toBe('+12548319807');
  });
});

describe('syncAnveoNumbers', () => {
  it('creates a row for every DID the account holds', async () => {
    listDids.mockResolvedValue([
      anveoDid(),
      anveoDid({ e164: '18652809894', areaCode: '865', areaName: 'VB-US-LA', smsUrl: 'https://x' }),
    ]);

    const result = await syncAnveoNumbers(TENANT);

    expect(result.found).toBe(2);
    expect(result.created).toBe(2);
    expect(prismaMock.phoneNumber.create).toHaveBeenCalledTimes(2);

    const first = prismaMock.phoneNumber.create.mock.calls[0][0].data;
    expect(first.number).toBe('+12548319807');
    expect(first.tenantId).toBe(TENANT);
    expect(first.provider).toBe('anveo');
    expect(first.capabilities).toEqual({ voice: true, sms: false });
    expect(first.metadata.anveoDid).toBe('12548319807');

    const second = prismaMock.phoneNumber.create.mock.calls[1][0].data;
    expect(second.capabilities).toEqual({ voice: true, sms: true });
  });

  it('links the numbers to the carrier that issued them when one is configured', async () => {
    prismaMock.carrier.findFirst.mockResolvedValue({ id: 'carrier-anveo', name: 'Anveo Direct' });
    listDids.mockResolvedValue([anveoDid()]);

    const result = await syncAnveoNumbers(TENANT);

    expect(result.carrier).toEqual({ id: 'carrier-anveo', name: 'Anveo Direct' });
    expect(prismaMock.phoneNumber.create.mock.calls[0][0].data.carrierId).toBe('carrier-anveo');
  });

  it('reports no carrier rather than inventing one', async () => {
    // A Carrier row is a routing participant. Creating one as a side effect of
    // an inventory import would put an unconfigured leg in the waterfall; the
    // numbers still import and group under their provider without it.
    listDids.mockResolvedValue([anveoDid()]);

    const result = await syncAnveoNumbers(TENANT);

    expect(result.carrier).toBeNull();
    expect(prismaMock.phoneNumber.create.mock.calls[0][0].data.carrierId).toBeNull();
  });

  it('corrects the provenance of a number already on file without touching local state', async () => {
    prismaMock.carrier.findFirst.mockResolvedValue({ id: 'carrier-anveo', name: 'Anveo Direct' });
    prismaMock.phoneNumber.findUnique.mockResolvedValue({
      id: 'pn-existing',
      provider: 'local',
      carrierId: null,
    });
    listDids.mockResolvedValue([anveoDid()]);

    const result = await syncAnveoNumbers(TENANT);

    expect(result.created).toBe(0);
    expect(result.updated).toBe(1);

    const update = prismaMock.phoneNumber.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: 'pn-existing' });
    expect(update.data.provider).toBe('anveo');
    expect(update.data.carrierId).toBe('carrier-anveo');

    // Anveo does not know what an operator decided locally, so the sync must
    // not have an opinion about any of these.
    expect(update.data).not.toHaveProperty('status');
    expect(update.data).not.toHaveProperty('campaignId');
    expect(update.data).not.toHaveProperty('userId');
    expect(update.data).not.toHaveProperty('poolType');
    expect(update.data).not.toHaveProperty('poolStatus');
  });

  it('counts an already-correct row as unchanged', async () => {
    prismaMock.carrier.findFirst.mockResolvedValue({ id: 'carrier-anveo', name: 'Anveo Direct' });
    prismaMock.phoneNumber.findUnique.mockResolvedValue({
      id: 'pn-existing',
      provider: 'anveo',
      carrierId: 'carrier-anveo',
    });
    listDids.mockResolvedValue([anveoDid()]);

    const result = await syncAnveoNumbers(TENANT);

    expect(result.updated).toBe(0);
    expect(result.unchanged).toBe(1);
    expect(result.numbers[0].action).toBe('unchanged');
  });

  it('files every DID under the tenant it was asked to sync', async () => {
    // The Anveo credential is account-wide; the tenant is the caller's, and a
    // DID must never land anywhere else.
    listDids.mockResolvedValue([anveoDid(), anveoDid({ e164: '18652757300' })]);

    await syncAnveoNumbers(TENANT);

    for (const call of prismaMock.phoneNumber.create.mock.calls) {
      expect(call[0].data.tenantId).toBe(TENANT);
    }
    for (const call of prismaMock.phoneNumber.findUnique.mock.calls) {
      expect(call[0].where.tenantId_number.tenantId).toBe(TENANT);
    }
  });
});
