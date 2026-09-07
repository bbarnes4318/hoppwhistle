/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import Fastify, { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkInternalKey, requireInternalKey } from '../lib/internal-auth.js';

/**
 * The FreeSWITCH callbacks, and the guard that closes them.
 *
 * ── What this is about ──────────────────────────────────────────────────────
 *
 * `docs/TENANT_ISOLATION_AUDIT.md` §4 recorded five endpoints as "NO AUTH —
 * internal network only", noted that this was a deployment assumption rather
 * than an enforced one, and that they are reachable through nginx. One of them,
 * `/freeswitch/carrier-result`, took a `tenantId` from its own body with
 * nothing in front of it.
 *
 * The properties that matter, and that nothing here may quietly lose:
 *
 *   1. It FAILS CLOSED. An unconfigured secret refuses every request. "Unset
 *      means open" is exactly the assumption being replaced.
 *   2. It accepts the header, because every caller that can send one should.
 *   3. It accepts the query parameter, because mod_curl cannot send headers and
 *      a guard the real caller cannot satisfy is not a guard, it is an outage.
 *   4. It never says which of "no secret configured" and "wrong secret" it was.
 *
 * This drives a real Fastify instance through the real preHandler rather than
 * asserting on a copy of the logic.
 */

const SECRET = 'not-a-real-key-0123456789abcdef0123456789abcdef';

let app: FastifyInstance;

async function buildApp(): Promise<FastifyInstance> {
  const instance = Fastify();

  instance.get('/guarded', { preHandler: [requireInternalKey] }, async () => ({ ok: true }));
  instance.post('/guarded-post', { preHandler: [requireInternalKey] }, async () => ({ ok: true }));

  await instance.ready();
  return instance;
}

beforeEach(async () => {
  process.env.FREESWITCH_INTERNAL_KEY = SECRET;
  app = await buildApp();
});

afterEach(async () => {
  await app?.close();
  delete process.env.FREESWITCH_INTERNAL_KEY;
});

describe('the FreeSWITCH internal-key guard', () => {
  it('refuses a request with no key at all', async () => {
    const response = await app.inject({ method: 'GET', url: '/guarded' });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('INTERNAL_KEY_REQUIRED');
  });

  it('accepts the key in the X-Internal-Key header', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/guarded',
      headers: { 'x-internal-key': SECRET },
    });
    expect(response.statusCode).toBe(200);
  });

  it('accepts the key as ?k=, because mod_curl cannot send request headers', async () => {
    // The dialplan and inbound_route.lua have no other way in. A guard the real
    // caller cannot satisfy is not a guard, it is a telephony outage.
    const response = await app.inject({
      method: 'GET',
      url: `/guarded?k=${encodeURIComponent(SECRET)}`,
    });
    expect(response.statusCode).toBe(200);
  });

  it('accepts the query form on a POST too, where the CDR webhook needs it', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/guarded-post?k=${encodeURIComponent(SECRET)}`,
      payload: { anything: true },
    });
    expect(response.statusCode).toBe(200);
  });

  it('refuses a wrong key in either position', async () => {
    const viaHeader = await app.inject({
      method: 'GET',
      url: '/guarded',
      headers: { 'x-internal-key': 'wrong' },
    });
    expect(viaHeader.statusCode).toBe(401);

    const viaQuery = await app.inject({ method: 'GET', url: '/guarded?k=wrong' });
    expect(viaQuery.statusCode).toBe(401);
  });

  it('refuses a key that is a prefix of the real one', async () => {
    // The length-difference fold in the comparison, which a naive
    // timingSafeEqual on unequal buffers would throw on rather than answer.
    const response = await app.inject({
      method: 'GET',
      url: '/guarded',
      headers: { 'x-internal-key': SECRET.slice(0, -1) },
    });
    expect(response.statusCode).toBe(401);
  });

  it('refuses a key with the real one as a prefix', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/guarded',
      headers: { 'x-internal-key': `${SECRET}x` },
    });
    expect(response.statusCode).toBe(401);
  });

  it('fails CLOSED when no secret is configured', async () => {
    // The property the whole change exists for. "Unset means open" is the
    // deployment assumption being replaced; if this ever passes with a 200 the
    // endpoints are open again and nothing else in the system would say so.
    delete process.env.FREESWITCH_INTERNAL_KEY;

    const noKey = await app.inject({ method: 'GET', url: '/guarded' });
    expect(noKey.statusCode).toBe(401);

    const withKey = await app.inject({
      method: 'GET',
      url: '/guarded',
      headers: { 'x-internal-key': SECRET },
    });
    expect(withKey.statusCode).toBe(401);
  });

  it('fails closed on a whitespace-only secret', async () => {
    // A secret that is present in the environment but empty is a
    // misconfiguration, not a configuration.
    process.env.FREESWITCH_INTERNAL_KEY = '   ';
    const response = await app.inject({
      method: 'GET',
      url: '/guarded',
      headers: { 'x-internal-key': '   ' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('does not tell the caller which failure it was', async () => {
    // An unauthenticated client learning that the server has no secret set is
    // being told exactly when to try again. The log line distinguishes them;
    // the response does not.
    const wrongKey = await app.inject({
      method: 'GET',
      url: '/guarded',
      headers: { 'x-internal-key': 'wrong' },
    });

    delete process.env.FREESWITCH_INTERNAL_KEY;
    const notConfigured = await app.inject({
      method: 'GET',
      url: '/guarded',
      headers: { 'x-internal-key': 'wrong' },
    });

    expect(notConfigured.statusCode).toBe(wrongKey.statusCode);
    expect(notConfigured.json()).toEqual(wrongKey.json());
  });

  it('reports the reason internally, so an operator can tell them apart', async () => {
    // The other half of the case above: the distinction exists, it just does
    // not reach the caller. An operator staring at a telephony outage needs it.
    const request = { headers: {}, query: {} } as any;

    expect(checkInternalKey(request)).toEqual({ ok: false, reason: 'missing' });

    delete process.env.FREESWITCH_INTERNAL_KEY;
    expect(checkInternalKey(request)).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('reports which transport was used, so the query form can be retired', async () => {
    const viaHeader = { headers: { 'x-internal-key': SECRET }, query: {} } as any;
    const viaQuery = { headers: {}, query: { k: SECRET } } as any;

    expect(checkInternalKey(viaHeader)).toEqual({ ok: true, via: 'header' });
    expect(checkInternalKey(viaQuery)).toEqual({ ok: true, via: 'query' });
  });

  it('ignores a non-string key rather than coercing it', async () => {
    // `?k=a&k=b` parses to an array. Coercing that to a string is how a
    // comparison ends up succeeding against something nobody intended.
    const response = await app.inject({
      method: 'GET',
      url: `/guarded?k=${encodeURIComponent(SECRET)}&k=other`,
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('the guarded routes are the FreeSWITCH callbacks', () => {
  /**
   * A static assertion, so a FreeSWITCH endpoint added later without the guard
   * fails the build rather than shipping open. It runs with no database and no
   * services, which is the point: this must fail everywhere, not only where
   * Postgres happens to be running.
   */
  it('every /api/v1/freeswitch route carries the guard', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');

    const files = ['did-routes.ts', 'carrier-routing.ts'];
    const unguarded: string[] = [];

    for (const file of files) {
      const source = readFileSync(join(process.cwd(), 'src', 'routes', file), 'utf8');

      // Each registration, and the ~200 characters after it, which is where a
      // preHandler would be if there is one.
      const registrations = source.matchAll(
        /server\.(get|post|put|patch|delete)\(\s*\n?\s*'(\/api\/v1\/freeswitch\/[^']+)'([\s\S]{0,200})/g
      );

      for (const match of registrations) {
        const [, , route, following] = match;
        if (!following.includes('requireInternalKey')) unguarded.push(`${file} ${route}`);
      }
    }

    expect(
      unguarded,
      'a /api/v1/freeswitch route is registered without requireInternalKey. ' +
        'These are reachable through nginx; "internal network only" is a ' +
        'deployment assumption, not a control. See lib/internal-auth.ts.'
    ).toEqual([]);
  });

  it('finds the five routes it is meant to be checking', async () => {
    // Guards the guard: a regex that matches nothing would pass the test above
    // while checking nothing at all.
    const { readFileSync } = await import('fs');
    const { join } = await import('path');

    let found = 0;
    for (const file of ['did-routes.ts', 'carrier-routing.ts']) {
      const source = readFileSync(join(process.cwd(), 'src', 'routes', file), 'utf8');
      found += [
        ...source.matchAll(
          /server\.(get|post|put|patch|delete)\(\s*\n?\s*'(\/api\/v1\/freeswitch\/[^']+)'/g
        ),
      ].length;
    }

    expect(found).toBe(5);
  });
});
