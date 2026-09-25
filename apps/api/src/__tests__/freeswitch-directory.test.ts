/**
 * The FreeSWITCH user directory, served from the database.
 *
 * ── What this endpoint replaced ──────────────────────────────────────────────
 *
 * Twenty files under `apps/freeswitch/conf/directory/default/`, 1000 through
 * 1019, each carrying `$${default_password}` -- one password shared by every
 * agent on the platform, and a hard ceiling of twenty SIP identities. Static
 * files can express neither a per-agent secret nor a twenty-first agent.
 *
 * ── The properties that matter ───────────────────────────────────────────────
 *
 *   1. It is GUARDED. Unauthenticated, this hands out the password of any
 *      extension anyone cares to name.
 *   2. Every answer is 200 with a parseable XML body. mod_xml_curl treats a
 *      non-200 as a FAILED FETCH rather than as a fall-through, and a failed
 *      fetch on the directory section is every agent on the box unable to
 *      register -- so even a database failure answers not-found.
 *   3. Not-found is exactly the document FreeSWITCH matches on, because that is
 *      what makes it consult the static XML still on disk. Get the shape wrong
 *      and every legacy extension stops resolving.
 *   4. The domain it answers with is the domain it was ASKED about. Reply with
 *      a different one and FreeSWITCH finds no user in it -- which presents as
 *      a registration failing with the correct password.
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- assertions run over parsed XML */
import { XMLValidator } from 'fast-xml-parser';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = {} as unknown;
vi.mock('../lib/prisma.js', () => ({
  getPrismaClient: () => mockPrisma,
}));

type Lookup = typeof lookupDirectoryPrincipal;
const mockLookup = vi.fn<Parameters<Lookup>, ReturnType<Lookup>>();
vi.mock('../services/telephony/agent-sip-credential.js', () => ({
  lookupDirectoryPrincipal: (...args: Parameters<Lookup>) => mockLookup(...args),
}));

import { registerFreeswitchDirectoryRoutes } from '../routes/freeswitch-directory.js';
import type { lookupDirectoryPrincipal } from '../services/telephony/agent-sip-credential.js';

const INTERNAL_KEY = 'test-internal-key';
const DOMAIN = 'sip.example.test';

/** One lookup, as mod_xml_curl posts it: form-encoded, not JSON. */
function lookupBody(overrides: Record<string, string> = {}): string {
  return new URLSearchParams({
    section: 'directory',
    tag_name: 'domain',
    key_name: 'name',
    key_value: '1042',
    user: '1042',
    domain: DOMAIN,
    action: 'sip_auth',
    ...overrides,
  }).toString();
}

async function post(
  app: FastifyInstance,
  options: { body?: string; key?: string | null } = {}
): Promise<{ statusCode: number; body: string; headers: Record<string, unknown> }> {
  const key = options.key === undefined ? INTERNAL_KEY : options.key;
  const response = await app.inject({
    method: 'POST',
    url: key === null ? '/api/v1/freeswitch/directory' : `/api/v1/freeswitch/directory?k=${key}`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: options.body ?? lookupBody(),
  });
  return {
    statusCode: response.statusCode,
    body: response.body,
    headers: response.headers as Record<string, unknown>,
  };
}

/** Whether a body is the "ask the next binding" document. */
function isNotFound(body: string): boolean {
  return /<section name="result">\s*<result status="not found"\/>\s*<\/section>/.test(body);
}

let app: FastifyInstance;
let previousKey: string | undefined;

beforeEach(async () => {
  previousKey = process.env.FREESWITCH_INTERNAL_KEY;
  process.env.FREESWITCH_INTERNAL_KEY = INTERNAL_KEY;

  mockLookup.mockReset();
  mockLookup.mockResolvedValue({
    extension: '1042',
    password: 'a-per-agent-secret',
    tenantId: 'agency-a',
    userId: 'agent-1',
  });

  app = Fastify({ logger: false });
  await app.register(registerFreeswitchDirectoryRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  if (previousKey === undefined) delete process.env.FREESWITCH_INTERNAL_KEY;
  else process.env.FREESWITCH_INTERNAL_KEY = previousKey;
});

/* ── The guard ─────────────────────────────────────────────────────────────── */

describe('the internal-key guard', () => {
  it('refuses a request with no key', async () => {
    const response = await post(app, { key: null });

    // Unguarded, this endpoint hands out the password for any extension named.
    expect(response.statusCode).toBe(401);
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('refuses a request with the wrong key', async () => {
    const response = await post(app, { key: 'not-the-key' });

    expect(response.statusCode).toBe(401);
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('accepts the key in the header, for callers that can send one', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/freeswitch/directory',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-internal-key': INTERNAL_KEY,
      },
      payload: lookupBody(),
    });

    expect(response.statusCode).toBe(200);
  });
});

/* ── A hit ─────────────────────────────────────────────────────────────────── */

describe('a directory hit', () => {
  it("returns the agent's own password, not a shared one", async () => {
    const response = await post(app);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<user id="1042">');
    expect(response.body).toContain('<param name="password" value="a-per-agent-secret"/>');

    // The thing that must never come back: the placeholder every static file
    // carried, which resolved to the one password the whole platform shared.
    expect(response.body).not.toContain('default_password');
  });

  it('answers in the domain it was asked about', async () => {
    const response = await post(app, { body: lookupBody({ domain: 'other.example.test' }) });

    // Answering in a different domain is a user FreeSWITCH cannot find, which
    // looks exactly like a correct password being rejected.
    expect(response.body).toContain('<domain name="other.example.test">');
  });

  it('carries the owning agency onto the channel', async () => {
    const response = await post(app);

    // So a call knows which agency it belongs to from the first INVITE rather
    // than being matched back to one afterwards.
    expect(response.body).toContain('<variable name="hopwhistle_tenant_id" value="agency-a"/>');
    expect(response.body).toContain('<variable name="hopwhistle_user_id" value="agent-1"/>');
  });

  it('reads the extension from `user` when `key_value` is absent', async () => {
    const body = new URLSearchParams({
      section: 'directory',
      user: '1042',
      domain: DOMAIN,
      action: 'user_call',
    }).toString();

    // FreeSWITCH populates different fields for different lookup reasons.
    await post(app, { body });
    expect(mockLookup).toHaveBeenCalledWith('1042', expect.anything());
  });

  it('reads the extension from `user` on a registration, where `key_value` is the domain', async () => {
    // What mod_xml_curl actually posts for a REGISTER's digest check.
    const body = lookupBody({
      tag_name: 'domain',
      key_name: 'name',
      key_value: DOMAIN,
      user: '1000',
      domain: DOMAIN,
      action: 'sip_auth',
    });

    await post(app, { body });
    expect(mockLookup).toHaveBeenCalledWith('1000', expect.anything());
  });

  it('escapes XML metacharacters in the password', async () => {
    mockLookup.mockResolvedValue({
      extension: '1042',
      password: 'a&b<c>d"e',
      tenantId: 'agency-a',
      userId: 'agent-1',
    });

    const response = await post(app);

    // An unescaped `&` is a document FreeSWITCH refuses to parse, and a refused
    // parse is an agent who cannot register.
    expect(response.body).toContain('value="a&amp;b&lt;c&gt;d&quot;e"');
    expect(XMLValidator.validate(response.body)).toBe(true);
  });
});

/* ── Falling through to the static XML ─────────────────────────────────────── */

describe('falling through', () => {
  it('answers not-found for an extension with no credential', async () => {
    mockLookup.mockResolvedValue(null);

    const response = await post(app);

    // This is what makes FreeSWITCH consult the files still on disk, so every
    // 1000..1019 file, vapi.xml and demo-agent.xml keep resolving.
    expect(response.statusCode).toBe(200);
    expect(isNotFound(response.body)).toBe(true);
  });

  it('answers not-found for a section it does not serve', async () => {
    const response = await post(app, { body: lookupBody({ section: 'dialplan' }) });

    // A directory document returned for a dialplan lookup is a parse error, not
    // a fall-through.
    expect(response.statusCode).toBe(200);
    expect(isNotFound(response.body)).toBe(true);
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('answers not-found when the lookup names no extension', async () => {
    const body = new URLSearchParams({ section: 'directory', domain: DOMAIN }).toString();
    const response = await post(app, { body });

    expect(isNotFound(response.body)).toBe(true);
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('answers not-found when the lookup names no domain', async () => {
    const body = new URLSearchParams({ section: 'directory', key_value: '1042' }).toString();
    const response = await post(app, { body });

    expect(isNotFound(response.body)).toBe(true);
  });

  it('answers 200 not-found when the lookup THROWS', async () => {
    mockLookup.mockRejectedValue(new Error('database is down'));

    const response = await post(app);

    /*
     * The property that matters most here. A 500 is not a fall-through to
     * mod_xml_curl -- it is a failed fetch, and a failed fetch on the directory
     * section takes down registration for every agent on the box, including the
     * ones still served from static files. A database outage must degrade to
     * "the static XML answers" rather than to "nobody registers".
     */
    expect(response.statusCode).toBe(200);
    expect(isNotFound(response.body)).toBe(true);
  });
});

/* ── Every answer is a document FreeSWITCH can parse ───────────────────────── */

describe('well-formedness', () => {
  it('returns parseable XML on a hit, a miss and a failure alike', async () => {
    const hit = await post(app);

    mockLookup.mockResolvedValue(null);
    const miss = await post(app);

    mockLookup.mockRejectedValue(new Error('database is down'));
    const failure = await post(app);

    // mod_xml_curl logs a parse failure and treats it as a hard failure, not as
    // a fall-through -- so a malformed body on ANY path is agents unable to
    // register, whichever path produced it.
    for (const response of [hit, miss, failure]) {
      expect(XMLValidator.validate(response.body)).toBe(true);
      expect(response.headers['content-type']).toMatch(/xml/);
    }
  });
});

/* ── The body parser ───────────────────────────────────────────────────────── */

describe('form parsing', () => {
  it('parses the form-encoded body mod_xml_curl actually sends', async () => {
    // Without @fastify/formbody registered in this plugin's scope, `request.body`
    // is undefined, every lookup reads an empty extension, and every agent
    // silently fails to register while the endpoint returns a cheerful 200.
    await post(app);
    expect(mockLookup).toHaveBeenCalledWith('1042', expect.anything());
  });
});
