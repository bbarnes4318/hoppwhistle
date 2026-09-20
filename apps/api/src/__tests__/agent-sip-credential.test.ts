/**
 * Per-agent SIP identity: the properties that make multi-agency telephony safe.
 *
 * ── What was wrong ───────────────────────────────────────────────────────────
 *
 * An agent's SIP identity was `users.metadata.extension`, allocated by the
 * credentials endpoint from the fixed range 1000..1019 SCOPED TO THE AGENCY,
 * and the password was `SIP_AGENT_PASSWORD` -- one value shared by every agent
 * on the platform, matching `$${default_password}` in every static directory
 * file. FreeSWITCH's directory is one flat domain with no tenant dimension, so:
 *
 *   * two agencies were handed the same SIP username, and whichever browser
 *     registered last received BOTH agencies' calls;
 *   * every agent held a credential that authenticated every extension on the
 *     platform, including another agency's;
 *   * and the twenty-first agent of an agency silently fell back to extension
 *     '1000', taking over the first agent's registration.
 *
 * The assertions below are those three defects, stated as properties that must
 * hold. The first one is the one to preserve above all: `expect(b).not.toBe(a)`
 * for two agents in DIFFERENT agencies is the whole reason the unique index on
 * `extension` is global rather than scoped to `tenantId`.
 *
 * ── Why a fake and not the database ──────────────────────────────────────────
 *
 * These drive the real `issueCredential` and `lookupDirectoryPrincipal` against
 * an in-memory table that enforces the two unique constraints the migration
 * creates. That is what is being tested -- the allocator's behaviour AGAINST
 * those constraints, including the lost race -- and a fake can produce a lost
 * race deterministically where two real connections cannot.
 */

import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { decryptField, encryptField } from '../lib/field-encryption.js';
import {
  EXTENSION_MAX,
  EXTENSION_MIN,
  ExtensionRangeExhaustedError,
  isRoutableExtension,
  issueCredential,
  lookupDirectoryPrincipal,
  rotatePassword,
} from '../services/telephony/agent-sip-credential.js';

/* ── An in-memory `agent_sip_credentials` ──────────────────────────────────── */

/**
 * A real ciphertext for seeded rows.
 *
 * Seeding a placeholder like `'enc:v1:x:y:z'` is not a shortcut: the code under
 * test DECRYPTS what it reads, so a placeholder makes a passing path throw
 * `ERR_CRYPTO_INVALID_IV` and the test fails for a reason that has nothing to
 * do with what it is asserting.
 */
const SEEDED_PASSWORD = 'seeded-agent-password';
const SEEDED_CIPHERTEXT = encryptField(SEEDED_PASSWORD) as string;

interface Row {
  id: string;
  tenantId: string;
  userId: string;
  extension: string;
  passwordEncrypted: string | null;
  status: 'ACTIVE' | 'REVOKED';
  rotatedAt: Date;
}

/**
 * The two unique indexes the migration creates, and nothing else.
 *
 * `extension` is unique across the WHOLE table rather than per `tenantId`,
 * because that is where FreeSWITCH resolves the name. A fake that scoped it per
 * tenant would pass a test suite while the product it models re-created the
 * collision.
 */
function uniqueViolation(field: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target: [field] },
  });
}

class FakeTable {
  rows: Row[] = [];
  private nextId = 1;

  /** Set to run just before a create commits, to force a lost race. */
  onBeforeCreate: (() => void) | null = null;

  findUnique = vi.fn(async (args: { where: { userId?: string; extension?: string } }) => {
    await Promise.resolve();
    const { userId, extension } = args.where;
    return (
      this.rows.find(
        row =>
          (userId !== undefined && row.userId === userId) ||
          (extension !== undefined && row.extension === extension)
      ) ?? null
    );
  });

  findMany = vi.fn(async (args?: { where?: { tenantId?: string; status?: string } }) => {
    await Promise.resolve();
    const where = args?.where ?? {};
    return this.rows.filter(
      row =>
        (where.tenantId === undefined || row.tenantId === where.tenantId) &&
        (where.status === undefined || row.status === where.status)
    );
  });

  create = vi.fn(async (args: { data: Omit<Row, 'id' | 'status' | 'rotatedAt'> }) => {
    await Promise.resolve();
    this.onBeforeCreate?.();

    if (this.rows.some(row => row.userId === args.data.userId)) {
      throw uniqueViolation('userId');
    }
    if (this.rows.some(row => row.extension === args.data.extension)) {
      throw uniqueViolation('extension');
    }

    const row: Row = {
      id: `row-${this.nextId++}`,
      status: 'ACTIVE',
      rotatedAt: new Date(),
      ...args.data,
    };
    this.rows.push(row);
    return row;
  });

  update = vi.fn(async (args: { where: { userId: string }; data: Partial<Row> }) => {
    await Promise.resolve();
    const row = this.rows.find(candidate => candidate.userId === args.where.userId);
    if (!row) throw new Error(`No credential for ${args.where.userId}`);
    Object.assign(row, args.data);
    return row;
  });
}

function fakePrisma(table: FakeTable): Parameters<typeof issueCredential>[2]['prisma'] {
  return { agentSipCredential: table } as unknown as NonNullable<
    Parameters<typeof issueCredential>[2]
  >['prisma'];
}

let table: FakeTable;
let prisma: NonNullable<Parameters<typeof issueCredential>[2]>['prisma'];

beforeEach(() => {
  table = new FakeTable();
  prisma = fakePrisma(table);
});

/* ── The defect that mattered most ─────────────────────────────────────────── */

describe('extensions are unique across the platform, not within an agency', () => {
  it('gives two agents in DIFFERENT agencies different extensions', async () => {
    const a = await issueCredential('agency-a', 'agent-a', { prisma });
    const b = await issueCredential('agency-b', 'agent-b', { prisma });

    /*
     * The old allocator scanned `users.metadata.extension` WHERE tenantId = ...,
     * so both of these were '1000' -- one SIP user in FreeSWITCH, two agencies,
     * and the second browser to register took the first's calls. This single
     * assertion is the regression guard for that.
     */
    expect(b.extension).not.toBe(a.extension);
    expect(a.extension).toBe('1000');
    expect(b.extension).toBe('1001');
  });

  it('gives every agent their own password', async () => {
    const a = await issueCredential('agency-a', 'agent-a', { prisma });
    const b = await issueCredential('agency-b', 'agent-b', { prisma });

    // One shared SIP_AGENT_PASSWORD meant any agent could register as any
    // extension on the platform. Two agents must not share a secret.
    expect(b.password).not.toBe(a.password);
    expect(a.password.length).toBeGreaterThanOrEqual(24);
  });

  it('never stores the password in the clear', async () => {
    const issued = await issueCredential('agency-a', 'agent-a', { prisma });
    const stored = table.rows[0].passwordEncrypted;

    expect(stored).not.toBe(issued.password);
    expect(stored).toMatch(/^enc:v1:/);
    expect(decryptField(stored)).toBe(issued.password);
  });
});

/* ── Allocation ────────────────────────────────────────────────────────────── */

describe('allocation', () => {
  it('fills the lowest gap rather than always appending', async () => {
    await issueCredential('agency-a', 'agent-1', { prisma });
    await issueCredential('agency-a', 'agent-2', { prisma });
    await issueCredential('agency-a', 'agent-3', { prisma });

    // Agent 2 leaves and their credential is released.
    table.rows = table.rows.filter(row => row.userId !== 'agent-2');

    const replacement = await issueCredential('agency-a', 'agent-4', { prisma });
    expect(replacement.extension).toBe('1001');
  });

  it('treats a REVOKED credential as still holding its extension', async () => {
    await issueCredential('agency-a', 'agent-1', { prisma });
    table.rows[0].status = 'REVOKED';

    /*
     * A revoked identity keeps its name reserved. Reissuing it while a stale
     * softphone is still registered with the old secret would point a second
     * agent at a registration that is not theirs.
     */
    const next = await issueCredential('agency-a', 'agent-2', { prisma });
    expect(next.extension).toBe('1001');
  });

  it('returns the same credential on every fetch, without rotating it', async () => {
    const first = await issueCredential('agency-a', 'agent-1', { prisma });
    const second = await issueCredential('agency-a', 'agent-1', { prisma });

    // The softphone re-fetches on every page load. Rotating here would drop the
    // registration the agent is holding open, mid-shift.
    expect(second.extension).toBe(first.extension);
    expect(second.password).toBe(first.password);
    expect(second.provisioned).toBe(false);
  });

  it('refuses rather than falling back to a shared extension when the range is full', async () => {
    // The old code fell back to extension '1000' with the shared password when
    // its twenty-wide pool ran out -- which registered successfully as somebody
    // else. An exhausted range must be an error, not a silent collision.
    for (let n = EXTENSION_MIN; n <= EXTENSION_MAX; n++) {
      table.rows.push({
        id: `seed-${n}`,
        tenantId: 'agency-a',
        userId: `seed-user-${n}`,
        extension: String(n),
        passwordEncrypted: SEEDED_CIPHERTEXT,
        status: 'ACTIVE',
        rotatedAt: new Date(),
      });
    }

    await expect(issueCredential('agency-a', 'newcomer', { prisma })).rejects.toBeInstanceOf(
      ExtensionRangeExhaustedError
    );
  });
});

/* ── Losing the race ───────────────────────────────────────────────────────── */

describe('concurrent allocation', () => {
  it('retries onto the next free extension when another request takes the one it picked', async () => {
    /*
     * The allocator reads the taken set and picks a gap; two requests arriving
     * together read the same set and pick the same number. The unique index is
     * what settles it. Here the loser's create is beaten to '1000' by a row
     * that appears between its read and its write.
     */
    table.onBeforeCreate = () => {
      table.onBeforeCreate = null;
      table.rows.push({
        id: 'racer',
        tenantId: 'agency-b',
        userId: 'other-agent',
        extension: '1000',
        passwordEncrypted: SEEDED_CIPHERTEXT,
        status: 'ACTIVE',
        rotatedAt: new Date(),
      });
    };

    const issued = await issueCredential('agency-a', 'agent-1', { prisma });

    expect(issued.extension).toBe('1001');
    expect(table.rows.filter(row => row.extension === '1000')).toHaveLength(1);
  });

  it('returns the winning row when a concurrent request provisioned the SAME agent', async () => {
    table.onBeforeCreate = () => {
      table.onBeforeCreate = null;
      table.rows.push({
        id: 'racer',
        tenantId: 'agency-a',
        userId: 'agent-1',
        extension: '1007',
        passwordEncrypted: SEEDED_CIPHERTEXT,
        status: 'ACTIVE',
        rotatedAt: new Date(),
      });
    };

    const issued = await issueCredential('agency-a', 'agent-1', { prisma });

    // One agent, one identity. A second extension for the same agent is the
    // "whichever browser registered last wins" defect one level down, and the
    // credential handed back is the one that actually committed.
    expect(issued.extension).toBe('1007');
    expect(issued.password).toBe(SEEDED_PASSWORD);
    expect(table.rows.filter(row => row.userId === 'agent-1')).toHaveLength(1);
  });
});

/* ── Reservations left by the migration ────────────────────────────────────── */

describe('a reservation', () => {
  beforeEach(() => {
    // What the migration writes: the agent's pre-existing extension claimed so
    // the allocator cannot hand it to somebody else, with no secret, because
    // the only secret there was to migrate from was the global one.
    table.rows.push({
      id: 'reserved',
      tenantId: 'agency-a',
      userId: 'legacy-agent',
      extension: '1004',
      passwordEncrypted: null,
      status: 'ACTIVE',
      rotatedAt: new Date(),
    });
  });

  it('keeps the agents existing extension when it is finally issued', async () => {
    const issued = await issueCredential('agency-a', 'legacy-agent', { prisma });

    // The extension must survive: a softphone already configured for 1004, and
    // any routing that names it, keep working.
    expect(issued.extension).toBe('1004');
    expect(issued.provisioned).toBe(true);
    expect(issued.password).toBeTruthy();
    expect(table.rows[0].passwordEncrypted).toMatch(/^enc:v1:/);
  });

  it('cannot authenticate before it has been issued a secret', async () => {
    const principal = await lookupDirectoryPrincipal('1004', { prisma });

    // There is no password to check against, so "no such user" is the only
    // honest answer FreeSWITCH can be given.
    expect(principal).toBeNull();
  });
});

/* ── Cross-agency ──────────────────────────────────────────────────────────── */

describe('an agent whose credential belongs to another agency', () => {
  it('is refused rather than silently re-homed', async () => {
    await issueCredential('agency-a', 'agent-1', { prisma });

    /*
     * Re-pointing a live SIP identity at a different tenant is how one agency's
     * calls end up on another agency's floor. Moving an agent is deliberate
     * work, so this refuses and says so.
     */
    await expect(issueCredential('agency-b', 'agent-1', { prisma })).rejects.toThrow(
      /different agency/i
    );
  });
});

/* ── The directory lookup ──────────────────────────────────────────────────── */

describe('lookupDirectoryPrincipal', () => {
  it('returns the decrypted password for an active credential', async () => {
    const issued = await issueCredential('agency-a', 'agent-1', { prisma });
    const principal = await lookupDirectoryPrincipal(issued.extension, { prisma });

    expect(principal).toEqual({
      extension: issued.extension,
      password: issued.password,
      tenantId: 'agency-a',
      userId: 'agent-1',
    });
  });

  it('refuses a REVOKED credential', async () => {
    const issued = await issueCredential('agency-a', 'agent-1', { prisma });
    table.rows[0].status = 'REVOKED';

    expect(await lookupDirectoryPrincipal(issued.extension, { prisma })).toBeNull();
  });

  it('refuses anything outside the range the dialplan routes', async () => {
    // Never reaches the database: `^1[0-9]{3}$` is what
    // apps/freeswitch/conf/dialplan/default.xml matches on.
    expect(await lookupDirectoryPrincipal('2000', { prisma })).toBeNull();
    expect(await lookupDirectoryPrincipal('0999', { prisma })).toBeNull();
    expect(await lookupDirectoryPrincipal('sip:evil@host', { prisma })).toBeNull();
    expect(table.findUnique).not.toHaveBeenCalled();
  });
});

describe('isRoutableExtension', () => {
  it('accepts the range the dialplan matches and nothing else', () => {
    expect(isRoutableExtension('1000')).toBe(true);
    expect(isRoutableExtension('1999')).toBe(true);
    expect(isRoutableExtension('0999')).toBe(false);
    expect(isRoutableExtension('2000')).toBe(false);
    expect(isRoutableExtension('10000')).toBe(false);
    expect(isRoutableExtension('1a00')).toBe(false);
  });
});

/* ── Rotation ──────────────────────────────────────────────────────────────── */

describe('rotatePassword', () => {
  it('replaces the secret and keeps the extension', async () => {
    const before = await issueCredential('agency-a', 'agent-1', { prisma });
    const after = await rotatePassword('agent-1', { prisma });

    expect(after.extension).toBe(before.extension);
    expect(after.password).not.toBe(before.password);
    expect(decryptField(table.rows[0].passwordEncrypted)).toBe(after.password);
  });
});
