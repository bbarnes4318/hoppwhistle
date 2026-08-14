/**
 * A FreeSWITCH surface that cannot place, move, or end a call.
 *
 * ── Why an allowlist and not a denylist ──────────────────────────────────────
 *
 * A denylist of dangerous commands is wrong by construction: FreeSWITCH has
 * hundreds of API commands, new ones arrive with new modules, and the failure
 * mode of forgetting one is a call this module was built to make impossible.
 * So the rule is inverted. Four commands are permitted, by exact first token,
 * and everything else — known, unknown, future — is refused before it can reach
 * a socket. `FORBIDDEN_ESL_COMMANDS` exists only so tests and the CI guard can
 * name specific commands and prove they are refused; it is documentation and
 * test fodder, never the mechanism.
 *
 * ── Why the executor is wrapped rather than trusted ──────────────────────────
 *
 * `assertReadOnlyCommand` is called inside this module on every path, and the
 * injected executor is never exposed. A caller holding a `ReadOnlyFreeSwitchPort`
 * has no way to reach the socket, exactly as `EslClient` in `apps/dialer-v2` has
 * none — that is the same design, applied to a surface that must additionally
 * send commands rather than only subscribe.
 *
 * ── Why unreachability is a value, not an exception ──────────────────────────
 *
 * Every method returns a result carrying `available`. A thrown error at this
 * boundary invites a `catch` that treats failure as emptiness, and emptiness is
 * the one thing this system must never confuse with absence. Making the failure
 * a field forces the classifier to see it.
 *
 * Nothing here connects to a real FreeSWITCH in any test. The executor is
 * injected and every suite supplies a deterministic fake.
 */

import type { ChannelSighting } from './reconciliation-contract.js';

/**
 * The complete set of permitted commands, by first token.
 *
 *   show        — inventory. `show channels`, `show calls`, `show registrations`.
 *                 The verb has no mutating subcommand in any FreeSWITCH version.
 *   status      — switch uptime and session counts.
 *   uuid_exists — does this channel exist. Returns true/false, touches nothing.
 *   uuid_getvar — read one channel variable, further restricted below.
 *
 * `uuid_dump` is deliberately absent even though it is read-only: it returns the
 * entire variable set, which includes SIP authentication headers, and this module
 * must never hold data it is not allowed to persist. `sofia` is absent for the
 * opposite reason — `sofia status` is harmless but `sofia profile internal
 * restart` is not, and a first-token allowlist cannot tell them apart.
 */
export const READ_ONLY_ESL_COMMANDS: readonly string[] = Object.freeze([
  'show',
  'status',
  'uuid_exists',
  'uuid_getvar',
]);

/**
 * Commands named explicitly so tests and the CI guard can prove each is refused.
 *
 * NOT the mechanism. Refusal comes from absence in `READ_ONLY_ESL_COMMANDS`; a
 * command deleted from this list is still refused.
 */
export const FORBIDDEN_ESL_COMMANDS: readonly string[] = Object.freeze([
  'originate',
  'bgapi',
  'uuid_kill',
  'uuid_transfer',
  'uuid_bridge',
  'uuid_setvar',
  'uuid_broadcast',
  'uuid_hold',
  'uuid_park',
  'uuid_record',
  'uuid_send_dtmf',
  'uuid_displace',
  'uuid_break',
  'hupall',
  'reload',
  'reloadxml',
  'load',
  'unload',
  'fsctl',
  'sofia',
  'system',
  'bg_system',
  'sched_api',
  'sched_hangup',
  'conference',
  'expand',
  'eval',
]);

/**
 * Channel variables this module may read.
 *
 * Restricting `uuid_getvar` is the second half of the credential rule: without
 * it, a permitted command could fetch `sip_auth_password` or an arbitrary
 * customer-supplied header. Only the correlation variables the reconciler needs
 * are readable, and they are all values this system itself wrote.
 */
export const READABLE_CHANNEL_VARIABLES: readonly string[] = Object.freeze([
  'hopwhistle_attempt_id',
  'hopwhistle_tenant_id',
  'hopwhistle_campaign_id',
  'hopwhistle_lead_id',
  'hopwhistle_dialer_version',
]);

/** A command this module refuses to send. Names the command, never a credential. */
export class ForbiddenEslCommandError extends Error {
  readonly code = 'FORBIDDEN_ESL_COMMAND';
  constructor(
    readonly command: string,
    readonly constraint: string
  ) {
    super(`refused to send "${command}": ${constraint}`);
    this.name = 'ForbiddenEslCommandError';
  }
}

/**
 * Characters that let one command become two.
 *
 * ESL is newline-delimited, so an embedded newline in an argument is a second
 * command the allowlist never saw. The shell metacharacters are refused for the
 * same reason at one remove: a command reaching `system` would be evaluated
 * elsewhere, and defence in depth here costs nothing.
 */
const INJECTION_CHARACTERS = /[\r\n\0;|&`$]/;

/** First token, lowercased. Empty string when there is none. */
function firstToken(command: string): string {
  return command.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
}

/**
 * Refuse anything that is not provably read-only.
 *
 * Throws rather than returning a verdict: this is the last line before a socket,
 * and a boolean invites a caller that forgets to check it.
 */
export function assertReadOnlyCommand(command: string): void {
  if (typeof command !== 'string' || command.trim().length === 0) {
    throw new ForbiddenEslCommandError(String(command), 'a command must be a non-empty string');
  }
  if (INJECTION_CHARACTERS.test(command)) {
    throw new ForbiddenEslCommandError(
      firstToken(command),
      'the command contains a character that could start a second command'
    );
  }

  const verb = firstToken(command);
  if (!READ_ONLY_ESL_COMMANDS.includes(verb)) {
    throw new ForbiddenEslCommandError(
      verb,
      `only ${READ_ONLY_ESL_COMMANDS.join(', ')} may be sent from this module`
    );
  }

  if (verb === 'uuid_getvar') {
    const parts = command.trim().split(/\s+/);
    const variable = parts[2];
    if (!variable || !READABLE_CHANNEL_VARIABLES.includes(variable)) {
      throw new ForbiddenEslCommandError(
        'uuid_getvar',
        `only ${READABLE_CHANNEL_VARIABLES.join(', ')} may be read`
      );
    }
  }
}

/** Whether a command would be permitted. For guards and reports; never a gate. */
export function isReadOnlyCommand(command: string): boolean {
  try {
    assertReadOnlyCommand(command);
    return true;
  } catch {
    return false;
  }
}

/** The raw ESL surface. Injected, so no test needs a switch. */
export interface EslCommandExecutor {
  /** Send an API command and return its body. Rejects if the switch is unreachable. */
  api(command: string): Promise<string>;
}

/** Every lookup reports whether the source could be consulted at all. */
export interface LookupResult<T> {
  available: boolean;
  /** Sanitized. Never a driver message, a host, or a credential. */
  detail: string;
  value: T;
}

export interface ReadOnlyFreeSwitchPort {
  /** Live channels carrying this attempt id. Positive proof when non-empty. */
  findActiveChannelByAttemptId(attemptId: string): Promise<LookupResult<ChannelSighting[]>>;
  /**
   * Terminated channels for this attempt.
   *
   * Always reports unavailable — see below. Present because the reconciler must
   * record that it looked, and because a future durable ledger implements this
   * same signature.
   */
  findRecentChannelHistoryByAttemptId(attemptId: string): Promise<LookupResult<ChannelSighting[]>>;
  /** The readable correlation variables for a channel. */
  getChannelVariables(channelUuid: string): Promise<LookupResult<Record<string, string>>>;
}

/** A uuid-shaped string. Anything else is refused before it reaches a command. */
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

interface ShowChannelsRow {
  uuid?: string;
  callstate?: string;
  [key: string]: unknown;
}

/**
 * Parse `show channels as json`.
 *
 * FreeSWITCH answers `{"row_count":0}` with no `rows` key when nothing matches,
 * which is why this returns an empty array rather than throwing on a missing
 * key: a switch with no calls is a normal answer, not a broken response.
 */
export function parseShowChannels(body: string): ShowChannelsRow[] {
  const trimmed = body.trim();
  if (trimmed.length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') return [];
  const rows = (parsed as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) return [];
  return rows.filter((r): r is ShowChannelsRow => !!r && typeof r === 'object');
}

/** `uuid_getvar` answers `-ERR ...` or `_undef_` when the variable is unset. */
export function parseVariableBody(body: string): string | null {
  const trimmed = body.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.startsWith('-ERR')) return null;
  if (trimmed === '_undef_') return null;
  return trimmed;
}

export interface AdapterOptions {
  executor: EslCommandExecutor;
  now?: () => number;
  /**
   * Cap on channels inspected per lookup.
   *
   * A busy switch can hold thousands of channels and identifying an attempt
   * means one `uuid_getvar` each. Unbounded, a single reconciliation run would
   * issue thousands of commands against a production switch. Bounded, a lookup
   * that hits the cap reports `available: false` — because a truncated search
   * that found nothing is exactly the absence-of-evidence this system refuses to
   * treat as proof.
   */
  maxChannelsInspected?: number;
}

const DEFAULT_MAX_CHANNELS = 500;

/**
 * The only implementation. Sends four commands, all allowlisted, all validated
 * immediately before dispatch.
 */
export class AllowlistedFreeSwitchAdapter implements ReadOnlyFreeSwitchPort {
  private readonly now: () => number;
  private readonly maxChannels: number;
  /** Counts commands actually dispatched. Asserted in tests. */
  private dispatched = 0;

  constructor(private readonly options: AdapterOptions) {
    this.now = options.now ?? (() => Date.now());
    this.maxChannels = options.maxChannelsInspected ?? DEFAULT_MAX_CHANNELS;
  }

  commandsDispatched(): number {
    return this.dispatched;
  }

  /** The single choke point. Nothing in this class calls the executor directly. */
  private async send(command: string): Promise<string> {
    assertReadOnlyCommand(command);
    this.dispatched++;
    return this.options.executor.api(command);
  }

  async findActiveChannelByAttemptId(
    attemptId: string
  ): Promise<LookupResult<ChannelSighting[]>> {
    if (!UUID.test(attemptId)) {
      return { available: false, detail: 'attempt id is not a uuid', value: [] };
    }

    let rows: ShowChannelsRow[];
    try {
      rows = parseShowChannels(await this.send('show channels as json'));
    } catch {
      // Deliberately no error detail. A driver message can carry the host and
      // sometimes the password it tried.
      return { available: false, detail: 'the switch could not be reached', value: [] };
    }

    const uuids = rows
      .map(r => (typeof r.uuid === 'string' ? r.uuid : null))
      .filter((u): u is string => u !== null && UUID.test(u));

    if (uuids.length > this.maxChannels) {
      return {
        available: false,
        detail: `more than ${this.maxChannels} live channels; a truncated search proves nothing`,
        value: [],
      };
    }

    const sightings: ChannelSighting[] = [];
    for (const uuid of uuids) {
      let value: string | null;
      try {
        value = parseVariableBody(await this.send(`uuid_getvar ${uuid} hopwhistle_attempt_id`));
      } catch {
        // One channel we could not read means we cannot claim to have searched
        // them all, and a partial search that found nothing is not evidence.
        return { available: false, detail: 'the switch stopped answering mid-search', value: [] };
      }
      if (value === attemptId) {
        const callstate = typeof rows.find(r => r.uuid === uuid)?.callstate === 'string'
          ? (rows.find(r => r.uuid === uuid)!.callstate as string)
          : null;
        sightings.push({
          channelUuid: uuid,
          attemptId,
          observedAtMs: this.now(),
          answerState: callstate,
        });
      }
    }

    return {
      available: true,
      detail: `${uuids.length} live channel(s) inspected`,
      value: sightings,
    };
  }

  /**
   * There is no channel history in FreeSWITCH.
   *
   * Once a channel is destroyed it is gone from every API this module may use.
   * A live switch therefore cannot distinguish "hung up a second ago" from
   * "never existed", which is why terminal and negative verdicts require a
   * durable event ledger and why this reports unavailable rather than empty.
   * Returning `[]` here would be a lie the classifier would act on.
   */
  findRecentChannelHistoryByAttemptId(_attemptId: string): Promise<LookupResult<ChannelSighting[]>> {
    return Promise.resolve({
      available: false,
      detail:
        'FreeSWITCH retains no channel history; a terminated channel cannot be found by any ' +
        'read-only command, so this source can never confirm or deny a past call',
      value: [],
    });
  }

  async getChannelVariables(channelUuid: string): Promise<LookupResult<Record<string, string>>> {
    if (!UUID.test(channelUuid)) {
      return { available: false, detail: 'channel uuid is not a uuid', value: {} };
    }

    const variables: Record<string, string> = {};
    for (const name of READABLE_CHANNEL_VARIABLES) {
      try {
        const value = parseVariableBody(await this.send(`uuid_getvar ${channelUuid} ${name}`));
        if (value !== null) variables[name] = value;
      } catch {
        return { available: false, detail: 'the switch could not be reached', value: {} };
      }
    }
    return { available: true, detail: `${Object.keys(variables).length} variable(s)`, value: variables };
  }
}

/**
 * A port that reports every source unavailable.
 *
 * The default wherever a reconciler runs without an authorized FreeSWITCH
 * connection, which is everywhere today. It is not a stub that returns empty
 * results — that would classify as absence and eventually as manual review for
 * the wrong reason. It reports that nothing was asked, which is true.
 */
export class UnavailableFreeSwitchPort implements ReadOnlyFreeSwitchPort {
  constructor(private readonly reason = 'no read-only FreeSWITCH connection is configured') {}

  findActiveChannelByAttemptId(_attemptId: string): Promise<LookupResult<ChannelSighting[]>> {
    return Promise.resolve({ available: false, detail: this.reason, value: [] });
  }

  findRecentChannelHistoryByAttemptId(
    _attemptId: string
  ): Promise<LookupResult<ChannelSighting[]>> {
    return Promise.resolve({ available: false, detail: this.reason, value: [] });
  }

  getChannelVariables(_channelUuid: string): Promise<LookupResult<Record<string, string>>> {
    return Promise.resolve({ available: false, detail: this.reason, value: {} });
  }
}
