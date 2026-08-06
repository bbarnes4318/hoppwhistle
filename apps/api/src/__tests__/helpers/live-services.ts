/**
 * Gates for the suites that need a REAL Postgres or Redis.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 *
 * Several suites in this package are integration tests against a live database.
 * Two of them (`security.test.ts`, `pay-per-call-integration.test.ts`) begin by
 * running `TRUNCATE TABLE "tenants" CASCADE` and friends, which on this schema
 * cascades to essentially every row in the platform.
 *
 * They read `DATABASE_URL`, and `apps/api/.env` sets that to the PRODUCTION
 * host. Prisma loads that file automatically. So `npx vitest run` in this
 * package was one valid credential away from truncating production — the only
 * thing stopping it was that the password in that file no longer works.
 *
 * A test must not be able to do that by accident. These suites now run only
 * against a database you have explicitly nominated as disposable, and skip with
 * a stated reason otherwise. A skip that says why is honest; silently pointing
 * destructive SQL at whatever `DATABASE_URL` happens to hold is not.
 *
 * ── Running them for real ────────────────────────────────────────────────────
 *
 *   TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/hopwhistle_test
 *   TEST_REDIS_URL=redis://localhost:6379/1
 *
 * Both must point at a loopback host, and the database name must contain
 * "test". Set `ALLOW_REMOTE_TEST_SERVICES=1` to lift the loopback requirement
 * if you genuinely have a disposable remote instance — it is deliberately
 * awkward, because the failure mode it guards is unrecoverable.
 */

export interface ServiceGate {
  /** Whether the suite may run. */
  available: boolean;
  /** Why not, phrased for a developer reading a skipped suite. */
  reason: string;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function allowsRemote(): boolean {
  return process.env.ALLOW_REMOTE_TEST_SERVICES === '1';
}

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * Gate for suites that read and write a real database.
 *
 * On success this points `DATABASE_URL` at the nominated test database, so
 * `getPrismaClient()` — which builds its client lazily on first use — connects
 * there rather than to whatever `.env` supplied.
 */
export function databaseGate(envVar = 'TEST_DATABASE_URL'): ServiceGate {
  const raw = process.env[envVar];
  if (!raw) {
    return {
      available: false,
      reason: `${envVar} is not set. This suite writes to, and truncates, a real database, so it will not fall back to DATABASE_URL — that points at production. Set ${envVar} to a disposable local database to run it.`,
    };
  }

  const url = parse(raw);
  if (!url) {
    return { available: false, reason: `${envVar} is not a valid URL.` };
  }

  if (!LOOPBACK.has(url.hostname) && !allowsRemote()) {
    return {
      available: false,
      reason: `${envVar} points at "${url.hostname}", which is not loopback. These tests truncate tables. Set ALLOW_REMOTE_TEST_SERVICES=1 only if that host is genuinely disposable.`,
    };
  }

  const database = url.pathname.replace(/^\//, '');
  if (!/test/i.test(database) && !allowsRemote()) {
    return {
      available: false,
      reason: `${envVar} names the database "${database}", which does not look like a test database. Name it with "test" in it, or set ALLOW_REMOTE_TEST_SERVICES=1.`,
    };
  }

  process.env.DATABASE_URL = raw;
  return { available: true, reason: '' };
}

/** Gate for suites that need a real Redis. */
export function redisGate(envVar = 'TEST_REDIS_URL'): ServiceGate {
  const raw = process.env[envVar];
  if (!raw) {
    return {
      available: false,
      reason: `${envVar} is not set. This suite needs a real Redis, and will not fall back to REDIS_URL — that points at a shared instance. Set ${envVar} to a disposable local Redis to run it.`,
    };
  }

  const url = parse(raw);
  if (!url) {
    return { available: false, reason: `${envVar} is not a valid URL.` };
  }

  if (!LOOPBACK.has(url.hostname) && !allowsRemote()) {
    return {
      available: false,
      reason: `${envVar} points at "${url.hostname}", which is not loopback. Set ALLOW_REMOTE_TEST_SERVICES=1 only if that instance is genuinely disposable.`,
    };
  }

  process.env.REDIS_URL = raw;
  return { available: true, reason: '' };
}

/**
 * Reports a skipped suite once, so a green run never silently means "covered".
 */
export function announceSkip(suite: string, gate: ServiceGate): void {
  if (!gate.available) {
    console.warn(`[skipped] ${suite}: ${gate.reason}`);
  }
}
