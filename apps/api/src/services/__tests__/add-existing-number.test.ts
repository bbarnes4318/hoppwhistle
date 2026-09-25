import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addExistingNumber, normalizeUsNumber } from '../add-existing-number.js';

const prisma = {
  campaign: { findFirst: vi.fn() },
  phoneNumber: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  didRoute: { findFirst: vi.fn() },
};

const add = (input: { number: string; provider: string; campaignId?: string | null }) =>
  addExistingNumber(
    prisma as unknown as Parameters<typeof addExistingNumber>[0],
    'agency-a',
    input
  );

beforeEach(() => {
  vi.clearAllMocks();
  prisma.campaign.findFirst.mockResolvedValue({ id: 'c-1' });
  prisma.phoneNumber.findFirst.mockResolvedValue(null);
  prisma.phoneNumber.findUnique.mockResolvedValue(null);
  prisma.phoneNumber.create.mockResolvedValue({ id: 'pn-1' });
  prisma.didRoute.findFirst.mockResolvedValue(null);
});

describe('normalizeUsNumber', () => {
  it('accepts common formats', () => {
    expect(normalizeUsNumber('(865) 555-1234')).toBe('+18655551234');
    expect(normalizeUsNumber('+1 865 555 1234')).toBe('+18655551234');
    expect(normalizeUsNumber('18655551234')).toBe('+18655551234');
  });

  it('rejects non-US and junk', () => {
    expect(normalizeUsNumber('555-1234')).toBeNull();
    expect(normalizeUsNumber('+44 20 7946 0958')).toBeNull();
    expect(normalizeUsNumber('call me')).toBeNull();
  });
});

describe('addExistingNumber', () => {
  it('creates the number in the agency, on the campaign', async () => {
    const result = await add({ number: '865-555-1234', provider: 'Anveo', campaignId: 'c-1' });

    expect(result).toEqual({ ok: true, id: 'pn-1', number: '+18655551234', created: true });
    expect(prisma.phoneNumber.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'agency-a',
          number: '+18655551234',
          provider: 'anveo',
          status: 'ACTIVE',
          campaignId: 'c-1',
        }) as unknown,
      })
    );
  });

  it('repoints a number the agency already has', async () => {
    prisma.phoneNumber.findUnique.mockResolvedValue({ id: 'pn-9' });

    const result = await add({ number: '8655551234', provider: 'anveo', campaignId: 'c-1' });

    expect(result).toMatchObject({ ok: true, id: 'pn-9', created: false });
    expect(prisma.phoneNumber.update).toHaveBeenCalledWith({
      where: { id: 'pn-9' },
      data: { provider: 'anveo', status: 'ACTIVE', campaignId: 'c-1' },
    });
    expect(prisma.phoneNumber.create).not.toHaveBeenCalled();
  });

  it('refuses a number active in another agency, naming it', async () => {
    prisma.phoneNumber.findFirst.mockResolvedValue({ tenant: { name: 'NetEnroll' } });

    const result = await add({ number: '8655551234', provider: 'anveo' });

    expect(result).toMatchObject({ ok: false, status: 409, code: 'NUMBER_IN_USE' });
    expect((result as { message: string }).message).toContain('NetEnroll');
    expect(prisma.phoneNumber.create).not.toHaveBeenCalled();
  });

  it('refuses a number routed in another agency', async () => {
    prisma.didRoute.findFirst.mockResolvedValue({ tenant: { name: 'Other Agency' } });

    const result = await add({ number: '8655551234', provider: 'anveo' });

    expect(result).toMatchObject({ ok: false, status: 409, code: 'NUMBER_IN_USE' });
  });

  it("refuses another agency's campaign", async () => {
    prisma.campaign.findFirst.mockResolvedValue(null);

    const result = await add({ number: '8655551234', provider: 'anveo', campaignId: 'c-x' });

    expect(result).toMatchObject({ ok: false, status: 404, code: 'CAMPAIGN_NOT_FOUND' });
  });

  it('refuses a bad number or carrier', async () => {
    expect(await add({ number: '555', provider: 'anveo' })).toMatchObject({
      ok: false,
      code: 'INVALID_NUMBER',
    });
    expect(await add({ number: '8655551234', provider: 'acme' })).toMatchObject({
      ok: false,
      code: 'INVALID_PROVIDER',
    });
  });

  it('adds without a campaign', async () => {
    await add({ number: '8655551234', provider: 'fractel' });
    expect(prisma.campaign.findFirst).not.toHaveBeenCalled();
    expect(prisma.phoneNumber.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ campaignId: null }) as unknown })
    );
  });
});
