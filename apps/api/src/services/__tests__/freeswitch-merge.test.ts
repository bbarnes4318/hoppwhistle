/**
 * FreeSwitchService.mergeCalls -- the softphone's three-way merge.
 *
 * Runs against a fake FreeSWITCH that answers the ESL commands the merge
 * issues. What is pinned here is the ORDER of those commands and the cases
 * that must refuse without touching a channel; that FreeSWITCH then does the
 * right thing with them was checked against the real switch (safarov
 * 1.10.12, the production base image), see the pull request that added this.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FreeSwitchService, MergeCallsError } from '../freeswitch-service.js';

interface FakeChannel {
  uuid: string;
  call_uuid: string;
  callstate: string;
  sipCallId: string;
}

// held call: agent leg A1 (originator) bridged to customer B1
// active call: agent leg A2 (originator) bridged to third party B2
const A1: FakeChannel = {
  uuid: 'a1',
  call_uuid: 'a1',
  callstate: 'ACTIVE',
  sipCallId: 'held-sip-id-0001',
};
const B1: FakeChannel = {
  uuid: 'b1',
  call_uuid: 'a1',
  callstate: 'ACTIVE',
  sipCallId: 'carrier-b1',
};
const A2: FakeChannel = {
  uuid: 'a2',
  call_uuid: 'a2',
  callstate: 'ACTIVE',
  sipCallId: 'active-sip-id-02',
};
const B2: FakeChannel = {
  uuid: 'b2',
  call_uuid: 'a2',
  callstate: 'ACTIVE',
  sipCallId: 'carrier-b2',
};

function fakeSwitch(
  channels: FakeChannel[],
  opts: { customerJoins?: boolean; failActiveTransfer?: boolean } = {}
) {
  const { customerJoins = true, failActiveTransfer = false } = opts;
  const commands: string[] = [];
  let customerInRoom = false;

  const svc = new FreeSwitchService();
  vi.spyOn(svc, 'executeApi').mockImplementation(async (command: string, args: string) => {
    commands.push(`${command} ${args}`);
    if (command === 'show') {
      return JSON.stringify({ rows: channels.map(({ sipCallId: _s, ...row }) => row) });
    }
    if (command === 'uuid_getvar') {
      const [uuid, name] = args.split(' ');
      const chan = channels.find(c => c.uuid === uuid);
      if (!chan) throw new Error('FreeSWITCH command failed: -ERR No such channel!');
      return name === 'sip_call_id' ? chan.sipCallId : '_undef_';
    }
    if (command === 'uuid_transfer') {
      if (args.startsWith('b1 ') && customerJoins) customerInRoom = true;
      if (args.startsWith('a2 ') && failActiveTransfer) {
        throw new Error('FreeSWITCH command failed: -ERR No such channel!');
      }
      return '+OK';
    }
    if (command === 'conference') {
      const [name] = args.split(' ');
      if (!customerInRoom) return `Conference ${name} not found`;
      return `1;sofia/external/customer@carrier;b1;customer;customer;hear|speak;0;0;100`;
    }
    if (command === 'uuid_kill') return '+OK';
    throw new Error(`unexpected ESL command: ${command} ${args}`);
  });

  return { svc, commands };
}

const mutating = (commands: string[]) => commands.filter(c => /^(uuid_transfer|uuid_kill)/.test(c));

describe('FreeSwitchService.mergeCalls', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('moves the customer in first, waits for them, then drops the held leg, then moves agent + third party together', async () => {
    const { svc, commands } = fakeSwitch([A1, B1, A2, B2]);

    const { conferenceName } = await svc.mergeCalls(A2.sipCallId, A1.sipCallId);

    expect(conferenceName).toBe('hw3way-b1');
    expect(mutating(commands)).toEqual([
      'uuid_transfer b1 conference:hw3way-b1@hopwhistle-3way inline',
      'uuid_kill a1',
      'uuid_transfer a2 -both conference:hw3way-b1@hopwhistle-3way+flags{mintwo|dist-dtmf} inline',
    ]);
    // The held leg is only hung up after the customer is confirmed in the room.
    const confirmed = commands.findIndex(c => c.startsWith('conference hw3way-b1 list'));
    expect(confirmed).toBeGreaterThan(-1);
    expect(confirmed).toBeLessThan(commands.indexOf('uuid_kill a1'));
  });

  it('works when the customer called in (agent leg is the bridged child)', async () => {
    // Inbound: the customer leg C originated the bridge to the agent's leg A1.
    const C: FakeChannel = {
      uuid: 'c',
      call_uuid: 'c',
      callstate: 'ACTIVE',
      sipCallId: 'carrier-c',
    };
    const A1in: FakeChannel = { ...A1, call_uuid: 'c' };
    const { svc, commands } = fakeSwitch([C, A1in, A2, B2]);
    // The fake moves "b1" into the room; this switch's customer is "c".
    vi.spyOn(svc, 'executeApi').mockImplementation(async (command: string, args: string) => {
      commands.push(`${command} ${args}`);
      if (command === 'show') {
        return JSON.stringify({ rows: [C, A1in, A2, B2] });
      }
      if (command === 'uuid_getvar') {
        const chan = [C, A1in, A2, B2].find(x => x.uuid === args.split(' ')[0]);
        return chan?.sipCallId ?? '';
      }
      if (command === 'conference') return '1;sofia/external/c;c;c;c;hear|speak;0;0;100';
      return '+OK';
    });

    await svc.mergeCalls(A2.sipCallId, A1in.sipCallId);

    expect(mutating(commands)).toEqual([
      'uuid_transfer c conference:hw3way-c@hopwhistle-3way inline',
      'uuid_kill a1',
      'uuid_transfer a2 -both conference:hw3way-c@hopwhistle-3way+flags{mintwo|dist-dtmf} inline',
    ]);
  });

  it('refuses while the person being added is still ringing, touching nothing', async () => {
    const ringing = { ...B2, callstate: 'RINGING' };
    const { svc, commands } = fakeSwitch([A1, B1, A2, ringing]);

    await expect(svc.mergeCalls(A2.sipCallId, A1.sipCallId)).rejects.toMatchObject({
      code: 'NOT_ANSWERED',
    });
    expect(mutating(commands)).toEqual([]);
  });

  it('refuses when the customer on hold has already hung up', async () => {
    const { svc, commands } = fakeSwitch([A1, A2, B2]);

    await expect(svc.mergeCalls(A2.sipCallId, A1.sipCallId)).rejects.toMatchObject({
      code: 'CALL_NOT_FOUND',
    });
    expect(mutating(commands)).toEqual([]);
  });

  it('never matches a leg by anything but its SIP Call-ID', async () => {
    // A raw channel UUID, a bridge partner UUID and a fragment of a channel
    // name all used to resolve -- which let a request name anyone's channel.
    for (const id of ['b2', 'a2', 'sofia', 'b1']) {
      const { svc, commands } = fakeSwitch([A1, B1, A2, B2]);
      await expect(svc.mergeCalls(id, A1.sipCallId)).rejects.toBeInstanceOf(MergeCallsError);
      expect(mutating(commands)).toEqual([]);
    }
  });

  it('refuses the same call twice and empty ids without asking FreeSWITCH', async () => {
    const { svc, commands } = fakeSwitch([A1, B1, A2, B2]);
    await expect(svc.mergeCalls(A1.sipCallId, A1.sipCallId)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(svc.mergeCalls('', A1.sipCallId)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(commands).toEqual([]);
  });

  it('keeps the held leg up when the customer never arrives in the conference', async () => {
    vi.useFakeTimers();
    try {
      const { svc, commands } = fakeSwitch([A1, B1, A2, B2], { customerJoins: false });
      const merge = svc.mergeCalls(A2.sipCallId, A1.sipCallId);
      const settled = expect(merge).rejects.toMatchObject({ code: 'MERGE_FAILED' });
      await vi.advanceTimersByTimeAsync(6000);
      await settled;
      expect(commands).not.toContain('uuid_kill a1');
      expect(commands.some(c => c.includes('-both'))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a failure to move the agent and third party as MERGE_FAILED', async () => {
    const { svc } = fakeSwitch([A1, B1, A2, B2], { failActiveTransfer: true });
    await expect(svc.mergeCalls(A2.sipCallId, A1.sipCallId)).rejects.toMatchObject({
      code: 'MERGE_FAILED',
    });
  });
});
