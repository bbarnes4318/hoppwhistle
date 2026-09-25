/**
 * Reading FreeSWITCH's registration table.
 *
 * ── Why this is worth its own module ─────────────────────────────────────────
 *
 * Routing needed a reliable answer to "can this agent's phone receive a call".
 * It had two unreliable ones: a Redis flag the browser writes, which goes stale
 * when a tab closes, and the fact that the agent once fetched credentials,
 * which is not evidence of anything. `routes/agent-phone.ts` records what the
 * second one cost -- an agent whose network blocked 7443 never sent a REGISTER,
 * "and every call to them died with USER_NOT_REGISTERED while the dashboard
 * still showed them available".
 *
 * ── The one property that must never break ───────────────────────────────────
 *
 * `null` means "cannot tell" and `new Set()` means "nobody is registered", and
 * the caller treats them as OPPOSITE instructions: the first does not filter,
 * the second excludes everybody. Collapsing them takes an entire agency off the
 * queue because ESL was briefly unreachable. Every failure path is asserted to
 * return null for that reason.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const executeApi = vi.fn<[command: string, args: string], Promise<string>>();
vi.mock('../services/freeswitch-service.js', () => ({
  freeswitchService: {
    executeApi: (...args: [command: string, args: string]) => executeApi(...args),
  },
}));

const redis = vi.hoisted(() => ({
  get: vi.fn<[key: string], Promise<string | null>>(),
  setex: vi.fn<[key: string, seconds: number, value: string], Promise<string>>(),
}));
vi.mock('../services/redis.js', () => ({ getRedisClient: () => redis }));

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  getRegisteredExtensions,
  parseRegisteredExtensions,
} from '../services/telephony/sip-registrations.js';

/** A `sofia status profile internal reg` dump with two agents on it. */
const TWO_REGISTERED = `
Registrations:
=================================================================================
Call-ID:        abc-123
User:           1000@sip.example.test
Contact:        "1000" <sip:1000@10.0.0.4:5060;transport=wss>
Status:         Registered(WSS)(unknown) EXP(2026-09-20 20:00:00) EXPSECS(3600)
Host:           freeswitch
IP:             10.0.0.4
Auth-User:      1000
Auth-Realm:     sip.example.test
=================================================================================
Call-ID:        def-456
User:           1042@sip.example.test
Contact:        "1042" <sip:1042@10.0.0.9:5060;transport=wss>
Status:         Registered(WSS)(unknown) EXP(2026-09-20 20:00:00) EXPSECS(3600)
Host:           freeswitch
IP:             10.0.0.9
Auth-User:      1042
Auth-Realm:     sip.example.test
=================================================================================

Total items returned: 2
`;

beforeEach(() => {
  vi.clearAllMocks();
  redis.get.mockResolvedValue(null);
  redis.setex.mockResolvedValue('OK');
});

afterEach(() => {
  delete process.env.FREESWITCH_INTERNAL_PROFILE;
});

/* ── Parsing ───────────────────────────────────────────────────────────────── */

describe('parseRegisteredExtensions', () => {
  it('reads every registered extension out of a real dump', () => {
    expect([...parseRegisteredExtensions(TWO_REGISTERED)].sort()).toEqual(['1000', '1042']);
  });

  it('strips the domain from a User line', () => {
    expect([...parseRegisteredExtensions('User:  1007@sip.example.test')]).toEqual(['1007']);
  });

  it('also reads Auth-User, for registrars that differ from User', () => {
    // A username this misses is an agent wrongly excluded, which is the one
    // outcome the gate must not produce.
    expect([...parseRegisteredExtensions('Auth-User:  1009')]).toEqual(['1009']);
  });

  it('finds nothing in a dump with no registrations', () => {
    expect(parseRegisteredExtensions('\nTotal items returned: 0\n').size).toBe(0);
  });

  it('finds nothing in an error body', () => {
    expect(parseRegisteredExtensions('-ERR no such profile').size).toBe(0);
  });
});

/* ── "Cannot tell" is never "nobody" ───────────────────────────────────────── */

describe('getRegisteredExtensions returns null rather than an empty set', () => {
  it('when ESL throws', async () => {
    executeApi.mockRejectedValue(new Error('ECONNREFUSED'));

    /*
     * THE property. An unreachable FreeSWITCH is not evidence that every
     * agent's phone is down. Returning an empty set here would take the whole
     * platform off the queue for the duration of an ESL blip.
     */
    expect(await getRegisteredExtensions()).toBeNull();
  });

  it('when the profile name is wrong and the dump is empty', async () => {
    executeApi.mockResolvedValue('Invalid Profile!');
    expect(await getRegisteredExtensions()).toBeNull();
  });

  it('when the registrar genuinely holds nothing', async () => {
    executeApi.mockResolvedValue('\nTotal items returned: 0\n');

    // Indistinguishable from a bad profile name, and nothing is lost by
    // declining to filter: an empty registrar means no agent could have taken
    // the call anyway.
    expect(await getRegisteredExtensions()).toBeNull();
  });

  it('and caches nothing when it could not tell', async () => {
    executeApi.mockRejectedValue(new Error('ECONNREFUSED'));
    await getRegisteredExtensions();
    expect(redis.setex).not.toHaveBeenCalled();
  });
});

/* ── Reading, and caching ──────────────────────────────────────────────────── */

describe('getRegisteredExtensions', () => {
  it('asks the internal profile for its registrations', async () => {
    executeApi.mockResolvedValue(TWO_REGISTERED);

    const registered = await getRegisteredExtensions();

    expect(executeApi).toHaveBeenCalledWith('sofia', 'status profile internal reg');
    expect(registered?.has('1000')).toBe(true);
    expect(registered?.has('1042')).toBe(true);
    expect(registered?.has('1099')).toBe(false);
  });

  it('honours a configured profile name', async () => {
    process.env.FREESWITCH_INTERNAL_PROFILE = 'agents';
    vi.resetModules();
    const mod = await import('../services/telephony/sip-registrations.js');
    executeApi.mockResolvedValue(TWO_REGISTERED);

    await mod.getRegisteredExtensions();

    expect(executeApi).toHaveBeenCalledWith('sofia', 'status profile agents reg');
  });

  it('serves a cached set without touching ESL', async () => {
    redis.get.mockResolvedValue(JSON.stringify(['1000', '1042']));

    const registered = await getRegisteredExtensions();

    // A burst of calls must share one lookup, not make one per call.
    expect(executeApi).not.toHaveBeenCalled();
    expect(registered?.has('1000')).toBe(true);
  });

  it('caches what it read, with a short life', async () => {
    executeApi.mockResolvedValue(TWO_REGISTERED);

    await getRegisteredExtensions();

    expect(redis.setex).toHaveBeenCalledWith(
      'sip:registrations',
      expect.any(Number),
      expect.stringContaining('1042')
    );
    const ttl = redis.setex.mock.calls[0][1];
    // Short enough that a newly-registered agent is not left waiting.
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(30);
  });

  it('falls through to ESL when the cache holds something unusable', async () => {
    redis.get.mockResolvedValue('not json');
    executeApi.mockResolvedValue(TWO_REGISTERED);

    const registered = await getRegisteredExtensions();

    // A cache that cannot be read is a miss, not a failure.
    expect(registered?.has('1000')).toBe(true);
  });

  it('falls through to ESL when Redis itself throws', async () => {
    redis.get.mockRejectedValue(new Error('redis is down'));
    executeApi.mockResolvedValue(TWO_REGISTERED);

    expect((await getRegisteredExtensions())?.has('1000')).toBe(true);
  });

  it('still answers when the cache write fails', async () => {
    executeApi.mockResolvedValue(TWO_REGISTERED);
    redis.setex.mockRejectedValue(new Error('redis is down'));

    // Not caching is slower, not wrong.
    expect((await getRegisteredExtensions())?.has('1000')).toBe(true);
  });
});
