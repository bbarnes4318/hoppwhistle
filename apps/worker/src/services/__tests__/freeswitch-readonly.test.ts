/**
 * The read-only FreeSWITCH port.
 *
 * No test here opens a socket. The executor is injected and records what it was
 * asked to send, which is how the negative cases prove a refusal happened
 * *before* dispatch rather than merely that a method returned an error.
 */

import { describe, expect, it } from 'vitest';

import {
  AllowlistedFreeSwitchAdapter,
  assertReadOnlyCommand,
  ForbiddenEslCommandError,
  FORBIDDEN_ESL_COMMANDS,
  isReadOnlyCommand,
  parseShowChannels,
  parseVariableBody,
  READABLE_CHANNEL_VARIABLES,
  READ_ONLY_ESL_COMMANDS,
  UnavailableFreeSwitchPort,
  type EslCommandExecutor,
} from '../freeswitch-readonly.js';

const ATTEMPT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CHAN_A = '11111111-1111-4111-8111-111111111111';
const CHAN_B = '22222222-2222-4222-8222-222222222222';

/** Records every command it is handed, so a leak is visible. */
class RecordingExecutor implements EslCommandExecutor {
  readonly sent: string[] = [];
  constructor(private readonly reply: (command: string) => string) {}
  api(command: string): Promise<string> {
    this.sent.push(command);
    return Promise.resolve(this.reply(command));
  }
}

class DeadExecutor implements EslCommandExecutor {
  readonly sent: string[] = [];
  api(command: string): Promise<string> {
    this.sent.push(command);
    return Promise.reject(new Error('connect ECONNREFUSED freeswitch:8021 password=ClueCon'));
  }
}

function channelsJson(rows: Array<{ uuid: string; callstate?: string }>): string {
  return JSON.stringify({ row_count: rows.length, rows });
}

describe('the allowlist is the mechanism', () => {
  it('permits exactly four commands', () => {
    expect([...READ_ONLY_ESL_COMMANDS].sort()).toEqual([
      'show',
      'status',
      'uuid_exists',
      'uuid_getvar',
    ]);
  });

  it('refuses every named forbidden command', () => {
    for (const command of FORBIDDEN_ESL_COMMANDS) {
      expect(isReadOnlyCommand(command)).toBe(false);
      expect(isReadOnlyCommand(`${command} ${CHAN_A}`)).toBe(false);
    }
  });

  it('refuses the specific commands this work is forbidden to send', () => {
    // Named individually rather than only through the list, so deleting an
    // entry from FORBIDDEN_ESL_COMMANDS cannot quietly delete a test.
    for (const command of [
      `originate {x=1}sofia/gateway/fractel1/+18005551212 &socket(h:1 async full)`,
      `bgapi originate sofia/gateway/fractel1/+18005551212 &park`,
      `uuid_kill ${CHAN_A}`,
      `uuid_transfer ${CHAN_A} 1000 XML default`,
      `uuid_bridge ${CHAN_A} ${CHAN_B}`,
      `uuid_setvar ${CHAN_A} hopwhistle_attempt_id other`,
      `uuid_broadcast ${CHAN_A} tone_stream://%(1000,0,440)`,
      `sofia profile internal restart`,
      `reloadxml`,
      `fsctl shutdown`,
    ]) {
      expect(() => assertReadOnlyCommand(command)).toThrow(ForbiddenEslCommandError);
    }
  });

  it('refuses an unknown command rather than assuming it is safe', () => {
    // The reason this is an allowlist. A future FreeSWITCH module's command is
    // refused without anybody having to hear about it.
    expect(isReadOnlyCommand('uuid_some_future_thing abc')).toBe(false);
    expect(isReadOnlyCommand('totally_new_verb')).toBe(false);
  });

  it('refuses a permitted verb carrying a second command', () => {
    // ESL is newline-delimited, so an embedded newline is a command the
    // allowlist never inspected.
    expect(isReadOnlyCommand(`show channels\noriginate sofia/gateway/g/+1800`)).toBe(false);
    expect(isReadOnlyCommand(`status\r\nuuid_kill ${CHAN_A}`)).toBe(false);
    expect(isReadOnlyCommand(`show channels; uuid_kill ${CHAN_A}`)).toBe(false);
    expect(isReadOnlyCommand(`show channels && uuid_kill ${CHAN_A}`)).toBe(false);
    expect(isReadOnlyCommand('show channels `id`')).toBe(false);
  });

  it('refuses an empty or non-string command', () => {
    expect(isReadOnlyCommand('')).toBe(false);
    expect(isReadOnlyCommand('   ')).toBe(false);
    expect(isReadOnlyCommand(undefined as unknown as string)).toBe(false);
  });

  it('names the command it refused and never the argument', () => {
    try {
      assertReadOnlyCommand(`uuid_setvar ${CHAN_A} sip_auth_password hunter2`);
      throw new Error('should have thrown');
    } catch (error) {
      const err = error as ForbiddenEslCommandError;
      expect(err.command).toBe('uuid_setvar');
      expect(err.message).not.toContain('hunter2');
    }
  });
});

describe('uuid_getvar is restricted to correlation variables', () => {
  it('permits only the declared variables', () => {
    for (const name of READABLE_CHANNEL_VARIABLES) {
      expect(isReadOnlyCommand(`uuid_getvar ${CHAN_A} ${name}`)).toBe(true);
    }
  });

  it('refuses a credential-bearing variable', () => {
    // The second half of the credential rule: a permitted command must not be
    // able to fetch something this module is forbidden to persist.
    for (const name of [
      'sip_auth_password',
      'sip_h_Authorization',
      'origination_caller_id_number',
      'sip_from_user',
    ]) {
      expect(isReadOnlyCommand(`uuid_getvar ${CHAN_A} ${name}`)).toBe(false);
    }
  });

  it('refuses uuid_getvar with no variable at all', () => {
    expect(isReadOnlyCommand(`uuid_getvar ${CHAN_A}`)).toBe(false);
  });
});

describe('finding a live channel', () => {
  it('reports the channel carrying the attempt id', async () => {
    const executor = new RecordingExecutor(command => {
      if (command.startsWith('show channels')) {
        return channelsJson([{ uuid: CHAN_A, callstate: 'ACTIVE' }, { uuid: CHAN_B }]);
      }
      return command.includes(CHAN_A) ? ATTEMPT : 'other-attempt';
    });
    const adapter = new AllowlistedFreeSwitchAdapter({ executor, now: () => 1_000 });

    const result = await adapter.findActiveChannelByAttemptId(ATTEMPT);

    expect(result.available).toBe(true);
    expect(result.value).toEqual([
      { channelUuid: CHAN_A, attemptId: ATTEMPT, observedAtMs: 1_000, answerState: 'ACTIVE' },
    ]);
    // Every command it sent was allowlisted.
    for (const command of executor.sent) expect(isReadOnlyCommand(command)).toBe(true);
  });

  it('reports two channels so the classifier can see the conflict', async () => {
    const executor = new RecordingExecutor(command =>
      command.startsWith('show channels')
        ? channelsJson([{ uuid: CHAN_A }, { uuid: CHAN_B }])
        : ATTEMPT
    );
    const adapter = new AllowlistedFreeSwitchAdapter({ executor });
    const result = await adapter.findActiveChannelByAttemptId(ATTEMPT);
    expect(result.value).toHaveLength(2);
  });

  it('an unreachable switch is unavailable, not empty', async () => {
    // The distinction the whole system turns on.
    const adapter = new AllowlistedFreeSwitchAdapter({ executor: new DeadExecutor() });
    const result = await adapter.findActiveChannelByAttemptId(ATTEMPT);
    expect(result.available).toBe(false);
    expect(result.value).toEqual([]);
  });

  it('never carries the driver error, which contains the credential', async () => {
    const adapter = new AllowlistedFreeSwitchAdapter({ executor: new DeadExecutor() });
    const result = await adapter.findActiveChannelByAttemptId(ATTEMPT);
    expect(result.detail).not.toContain('ClueCon');
    expect(result.detail).not.toContain('freeswitch:8021');
  });

  it('a switch that stops answering mid-search is unavailable', async () => {
    let calls = 0;
    const executor: EslCommandExecutor = {
      api(command) {
        calls++;
        if (command.startsWith('show channels')) {
          return Promise.resolve(channelsJson([{ uuid: CHAN_A }, { uuid: CHAN_B }]));
        }
        if (calls > 2) return Promise.reject(new Error('gone'));
        return Promise.resolve('not-this-attempt');
      },
    };
    const adapter = new AllowlistedFreeSwitchAdapter({ executor });
    const result = await adapter.findActiveChannelByAttemptId(ATTEMPT);
    // A partial search that found nothing is not evidence of nothing.
    expect(result.available).toBe(false);
  });

  it('refuses to draw a conclusion from a truncated search', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      uuid: `0000000${i}-0000-4000-8000-000000000000`,
    }));
    const executor = new RecordingExecutor(() => channelsJson(rows));
    const adapter = new AllowlistedFreeSwitchAdapter({ executor, maxChannelsInspected: 2 });
    const result = await adapter.findActiveChannelByAttemptId(ATTEMPT);
    expect(result.available).toBe(false);
    expect(result.detail).toContain('proves nothing');
  });

  it('refuses a non-uuid attempt id without sending anything', async () => {
    const executor = new RecordingExecutor(() => '');
    const adapter = new AllowlistedFreeSwitchAdapter({ executor });
    const result = await adapter.findActiveChannelByAttemptId("'; DROP TABLE leads; --");
    expect(result.available).toBe(false);
    expect(executor.sent).toEqual([]);
  });
});

describe('channel history cannot exist', () => {
  it('reports unavailable rather than empty', async () => {
    // Returning [] would be a lie the classifier would act on: FreeSWITCH
    // retains nothing about a destroyed channel, so "not found" there is not
    // "did not happen".
    const executor = new RecordingExecutor(() => '');
    const adapter = new AllowlistedFreeSwitchAdapter({ executor });
    const result = await adapter.findRecentChannelHistoryByAttemptId(ATTEMPT);
    expect(result.available).toBe(false);
    expect(result.detail).toContain('retains no channel history');
    expect(executor.sent).toEqual([]);
  });
});

describe('reading channel variables', () => {
  it('reads only the declared set', async () => {
    const executor = new RecordingExecutor(command =>
      command.endsWith('hopwhistle_attempt_id') ? ATTEMPT : '_undef_'
    );
    const adapter = new AllowlistedFreeSwitchAdapter({ executor });

    const result = await adapter.getChannelVariables(CHAN_A);

    expect(result.available).toBe(true);
    expect(result.value).toEqual({ hopwhistle_attempt_id: ATTEMPT });
    expect(executor.sent).toHaveLength(READABLE_CHANNEL_VARIABLES.length);
  });

  it('refuses a non-uuid channel without sending anything', async () => {
    const executor = new RecordingExecutor(() => '');
    const adapter = new AllowlistedFreeSwitchAdapter({ executor });
    const result = await adapter.getChannelVariables('not-a-uuid');
    expect(result.available).toBe(false);
    expect(executor.sent).toEqual([]);
  });
});

describe('the unavailable port', () => {
  it('reports every source unavailable, never empty', async () => {
    const port = new UnavailableFreeSwitchPort();
    for (const result of [
      await port.findActiveChannelByAttemptId(ATTEMPT),
      await port.findRecentChannelHistoryByAttemptId(ATTEMPT),
      await port.getChannelVariables(CHAN_A),
    ]) {
      expect(result.available).toBe(false);
    }
  });
});

describe('parsing', () => {
  it('reads a channel list', () => {
    expect(parseShowChannels(channelsJson([{ uuid: CHAN_A }]))).toEqual([{ uuid: CHAN_A }]);
  });

  it('treats an idle switch as no channels rather than as an error', () => {
    expect(parseShowChannels('{"row_count":0}')).toEqual([]);
    expect(parseShowChannels('')).toEqual([]);
    expect(parseShowChannels('-ERR no reply')).toEqual([]);
  });

  it('reads an unset variable as absent', () => {
    expect(parseVariableBody('_undef_')).toBeNull();
    expect(parseVariableBody('-ERR No such channel!')).toBeNull();
    expect(parseVariableBody('  ')).toBeNull();
    expect(parseVariableBody(` ${ATTEMPT} `)).toBe(ATTEMPT);
  });
});
