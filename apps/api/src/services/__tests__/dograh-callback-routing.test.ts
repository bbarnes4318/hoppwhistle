import { describe, expect, it, vi } from 'vitest';

import {
  dograhCallbackBridge,
  findDograhCallbackRoute,
  markDograhCallbackNumbers,
} from '../dograh-callback-routing.js';

const TEMPLATE = 'sofia/external/{DID}@10.0.0.9:5070';
const CALLBACK = { dograhCallback: true };
const CALLER_ID = { dograhCallerId: true };

type Row = { id?: string; number: string; tenantId?: string; metadata: Record<string, unknown> };

function prismaWith(rows: Row[], campaignRoute: { id: string } | null = null) {
  const findMany = vi.fn().mockResolvedValue(rows.map(r => ({ tenantId: 'agency-a', ...r })));
  const update = vi.fn().mockResolvedValue({});
  const findFirst = vi.fn().mockResolvedValue(campaignRoute);
  return {
    findMany,
    update,
    findFirst,
    client: { phoneNumber: { findMany, update }, didRoute: { findFirst } } as unknown as Parameters<
      typeof findDograhCallbackRoute
    >[0]['prismaClient'],
  };
}

describe('dograhCallbackBridge', () => {
  it('is off without a template, or with one that has no {DID}', () => {
    expect(dograhCallbackBridge('+18885550123', '')).toBeNull();
    expect(dograhCallbackBridge('+18885550123', 'sofia/external/x@h')).toBeNull();
  });

  it('fills in the DID', () => {
    expect(dograhCallbackBridge('+18885550123', TEMPLATE)).toBe(
      'sofia/external/+18885550123@10.0.0.9:5070'
    );
  });
});

describe('findDograhCallbackRoute', () => {
  it('routes a callback to a marked number to Dograh', async () => {
    const { client, findMany } = prismaWith([{ number: '+18885550123', metadata: CALLBACK }]);
    const route = await findDograhCallbackRoute({
      did: '18885550123',
      caller: '+14235551212',
      prismaClient: client,
      template: TEMPLATE,
    });
    expect(route).toEqual({
      bridge: 'sofia/external/+18885550123@10.0.0.9:5070',
      tenantId: 'agency-a',
      did: '+18885550123',
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'ACTIVE' }) as unknown,
      })
    );
  });

  it('matches a number stored without its country code', async () => {
    const { client } = prismaWith([{ number: '8885550123', metadata: CALLBACK }]);
    const route = await findDograhCallbackRoute({
      did: '+18885550123',
      prismaClient: client,
      template: TEMPLATE,
    });
    expect(route?.did).toBe('+18885550123');
  });

  it('leaves a caller ID Dograh has no inbound agent on to normal routing', async () => {
    const { client } = prismaWith([{ number: '+18885550123', metadata: CALLER_ID }]);
    expect(
      await findDograhCallbackRoute({
        did: '+18885550123',
        prismaClient: client,
        template: TEMPLATE,
      })
    ).toBeNull();
  });

  it('leaves an unmarked DID to normal routing', async () => {
    const { client } = prismaWith([]);
    expect(
      await findDograhCallbackRoute({
        did: '+18885550123',
        prismaClient: client,
        template: TEMPLATE,
      })
    ).toBeNull();
  });

  it('never routes a call Dograh sent us back to Dograh', async () => {
    const { client, findMany } = prismaWith([{ number: '+18885550123', metadata: CALLBACK }]);
    expect(
      await findDograhCallbackRoute({
        did: '+18885550123',
        fromDograh: true,
        prismaClient: client,
        template: TEMPLATE,
      })
    ).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('skips a call whose caller ID is itself an AI number (an AI transfer via the carrier)', async () => {
    const { client } = prismaWith([
      { number: '+18885550123', metadata: CALLBACK },
      { number: '+19135550100', metadata: CALLER_ID },
    ]);
    expect(
      await findDograhCallbackRoute({
        did: '+18885550123',
        caller: '19135550100',
        prismaClient: client,
        template: TEMPLATE,
      })
    ).toBeNull();
  });

  it('never takes a campaign DID: an AI transfer to it arrives from the lead', async () => {
    const { client, findFirst } = prismaWith([{ number: '+18885550123', metadata: CALLBACK }], {
      id: 'route-1',
    });
    expect(
      await findDograhCallbackRoute({
        did: '+18885550123',
        caller: '+14235551212',
        prismaClient: client,
        template: TEMPLATE,
      })
    ).toBeNull();
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'ACTIVE',
          OR: [{ campaignId: { not: null } }, { sharedRoutingGroupId: { not: null } }],
        }) as unknown,
      })
    );
  });

  it('does nothing when callbacks are not configured', async () => {
    const { client, findMany } = prismaWith([{ number: '+18885550123', metadata: CALLBACK }]);
    expect(
      await findDograhCallbackRoute({ did: '+18885550123', prismaClient: client, template: '' })
    ).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe('markDograhCallbackNumbers', () => {
  const rows: Row[] = [
    { id: 'a', number: '+18885550123', metadata: { state: 'TN' } },
    { id: 'b', number: '8885550124', metadata: { dograhCallback: true } },
    { id: 'c', number: '+18885550199', metadata: { dograhCallback: true, keep: 1 } },
  ];

  it('marks the listed numbers, unmarks the rest, and reports missing ones', async () => {
    const { client, update } = prismaWith(rows);
    const result = await markDograhCallbackNumbers(
      ['8885550123', '+1 (888) 555-0124', '18885550777'],
      { apply: true, prismaClient: client }
    );
    expect(result).toEqual({
      marked: 1,
      alreadyMarked: 1,
      unmarked: 1,
      notInHopwhistle: ['+18885550777'],
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'a' },
      data: { metadata: { state: 'TN', dograhCallback: true } },
    });
    expect(update).toHaveBeenCalledWith({ where: { id: 'c' }, data: { metadata: { keep: 1 } } });
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('writes nothing on a dry run', async () => {
    const { client, update } = prismaWith(rows);
    const result = await markDograhCallbackNumbers([], { apply: false, prismaClient: client });
    expect(result.unmarked).toBe(2);
    expect(update).not.toHaveBeenCalled();
  });
});
