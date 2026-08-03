#!/usr/bin/env node
/**
 * Dialer V2 — built-artifact smoke test.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 *
 * `tsup` exiting zero proves the bundler was satisfied. It does not prove the
 * artifact runs. The two come apart precisely where this service was broken:
 * the bundle inlined `@prisma/client`, which resolved on a developer machine
 * because an earlier `prisma generate` had left `node_modules/.prisma` on disk,
 * and failed everywhere else. Nothing in the dedicated workflow built the
 * package at all, so the first environment to find out would have been a
 * deployment.
 *
 * So this starts the real `dist/index.js` with `node` — not `tsx`, not Vitest,
 * not the TypeScript source — and asserts against the running process.
 *
 * ── Why readiness is asserted check by check ─────────────────────────────────
 *
 * `ready: false` on its own is worthless as a signal here: the production smoke
 * test EXPECTS readiness to fail, because ESL ingestion is deliberately off and
 * nothing has been reconstructed. A test that accepted any failure would pass
 * just as happily with a missing Prisma client, memory-backed sessions, or
 * unfenced decisions — the exact defects it is supposed to catch. So the caller
 * declares which checks may fail, and any other failing check fails the run.
 *
 * Usage:
 *   node scripts/smoke.mjs --mode test
 *   node scripts/smoke.mjs --mode production --allow-fail freeswitch_esl,state_reconstruction
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ARTIFACT = resolve(HERE, '..', 'dist', 'index.js');

const args = process.argv.slice(2);
const flag = name => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};

const mode = flag('mode') ?? 'test';
/**
 * The mode the running service is expected to REPORT.
 *
 * Differs from `--mode` only when the point of the run is that the value is
 * rejected: `--mode prodution --expect-mode unresolved` asserts that a typo
 * leaves the service unable to name its own mode, rather than silently
 * resolving to `test` and permitting memory backends.
 */
const expectMode = flag('expect-mode') ?? mode;
/** When set, the run REQUIRES readiness to be false. */
const expectNotReady = args.includes('--expect-not-ready');
/**
 * Accept any failing check.
 *
 * Only for the refusal scenario, where composition deliberately never happened
 * and every backend check failing is the correct consequence rather than a
 * finding. `--require-fail` still pins the checks that carry the actual claim,
 * so this cannot degrade into asserting nothing.
 */
const allowAnyFailure = args.includes('--allow-any-fail');
/** Checks that MUST be failing. Guards against a vacuous pass. */
const requiredFailures = (flag('require-fail') ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const allowedFailures = new Set(
  (flag('allow-fail') ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
);
const port = Number(flag('port') ?? 9192);
const startTimeoutMs = Number(flag('start-timeout') ?? 30_000);

const problems = [];
const note = message => process.stdout.write(`  ${message}\n`);
const fail = message => {
  problems.push(message);
  process.stdout.write(`  FAIL ${message}\n`);
};

if (!existsSync(ARTIFACT)) {
  process.stderr.write(`smoke: ${ARTIFACT} does not exist — run the build first\n`);
  process.exit(1);
}

process.stdout.write(`\nsmoke: starting ${ARTIFACT} in ${mode} mode on port ${port}\n`);

/**
 * The child's environment.
 *
 * Built from a deliberately narrow base rather than inheriting `process.env`.
 * Inheriting would let a variable set on the runner — `VITEST` above all, which
 * is the one signal that allows an unset runtime mode to resolve to `test` —
 * quietly change what is being tested. The point is to exercise the artifact as
 * a deployment would run it.
 */
const childEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  SystemRoot: process.env.SystemRoot,
  NODE_ENV: 'production',
  DIALER_V2_RUNTIME_MODE: mode,
  DIALER_V2_PORT: String(port),
  // Origination stays off, and ESL ingestion never connects to anything.
  TENANT_DIALER_V2_ORIGINATE_ENABLED: 'false',
  TENANT_DIALER_V2_ESL_INGEST_ENABLED: 'false',
  DIALER_V2_INTERNAL_TOKEN: 'smoke-internal-token-not-a-secret',
};

// Throwaway services only. Absent in the test-mode run, which must reach nothing.
if (process.env.SMOKE_REDIS_URL) childEnv.REDIS_URL = process.env.SMOKE_REDIS_URL;
if (process.env.SMOKE_DATABASE_URL) childEnv.DATABASE_URL = process.env.SMOKE_DATABASE_URL;
if (process.env.SMOKE_SIP_DOMAIN) childEnv.DIALER_V2_SIP_DOMAIN = process.env.SMOKE_SIP_DOMAIN;
if (process.env.SMOKE_ALLOWED_TENANT_IDS) {
  childEnv.DIALER_V2_ALLOWED_TENANT_IDS = process.env.SMOKE_ALLOWED_TENANT_IDS;
}

const child = spawn(process.execPath, [ARTIFACT], {
  env: childEnv,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
child.stdout.on('data', chunk => {
  stdout += chunk;
  process.stdout.write(`  [svc] ${chunk}`);
});
child.stderr.on('data', chunk => {
  stderr += chunk;
  process.stderr.write(`  [svc:err] ${chunk}`);
});

let exitedEarly = null;
child.on('exit', (code, signal) => {
  exitedEarly ??= { code, signal };
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

async function waitForLiveness() {
  const deadline = Date.now() + startTimeoutMs;
  while (Date.now() < deadline) {
    if (exitedEarly) {
      throw new Error(
        `the process exited before serving liveness (code=${exitedEarly.code} signal=${exitedEarly.signal})`
      );
    }
    try {
      const result = await get('/health/live');
      if (result.status === 200) return result;
      // A non-200 liveness is a real answer, not a reason to keep waiting.
      throw new Error(`/health/live answered ${result.status}`);
    } catch (error) {
      if (error.message.includes('/health/live answered')) throw error;
      await sleep(250);
    }
  }
  throw new Error(`/health/live did not answer within ${startTimeoutMs}ms`);
}

let exitCode = 0;

try {
  // ── 1. Liveness ──────────────────────────────────────────────────────────
  const live = await waitForLiveness();
  note(`/health/live → ${live.status}`);
  if (live.body?.live !== true) fail(`/health/live did not report live: ${JSON.stringify(live.body)}`);

  // ── 2. Readiness, check by check ─────────────────────────────────────────
  const ready = await get('/health/ready');
  note(`/health/ready → ${ready.status} (ready=${ready.body?.ready})`);

  const checks = Array.isArray(ready.body?.checks) ? ready.body.checks : [];
  if (checks.length === 0) fail('/health/ready returned no checks to inspect');

  const failing = checks.filter(c => c.status === 'fail').map(c => c.name);
  note(`failing checks: ${failing.length ? failing.join(', ') : '(none)'}`);

  if (!allowAnyFailure) {
    for (const name of failing) {
      if (!allowedFailures.has(name)) {
        const detail = checks.find(c => c.name === name)?.detail ?? '';
        fail(`unexpected failing check "${name}": ${detail}`);
      }
    }
  }

  for (const name of requiredFailures) {
    if (!failing.includes(name)) {
      fail(`expected check "${name}" to be failing, but it was not`);
    }
  }

  // ── 3. The mode the artifact actually resolved ───────────────────────────
  if (ready.body?.mode !== expectMode) {
    fail(`expected mode "${expectMode}", the running service reported "${ready.body?.mode}"`);
  }
  if (expectNotReady && ready.body?.ready !== false) {
    fail('expected this configuration to refuse readiness, but it reported ready');
  }

  // ── 4. Origination must not exist ────────────────────────────────────────
  if (ready.body?.originationImplemented !== false) {
    fail('the artifact claims origination is implemented');
  }
  if (ready.body?.originationPermitted !== false) {
    fail('the artifact permits origination');
  }

  // ── 5. Nothing that could be a credential reached stdout ─────────────────
  // The composition log carries backend names. A connection string in it would
  // be a credential in every log aggregator downstream.
  const leaks = [
    [/redis:\/\/[^\s"]*@/, 'a Redis URL with credentials'],
    [/postgres(ql)?:\/\/[^\s"]*@/, 'a PostgreSQL URL with credentials'],
    [/smoke-internal-token-not-a-secret/, 'the internal token'],
  ];
  for (const [pattern, what] of leaks) {
    if (pattern.test(stdout) || pattern.test(stderr)) fail(`${what} appeared in the service output`);
  }

  // ── 6. Mode-specific expectations ────────────────────────────────────────
  if (mode === 'production') {
    const b = ready.body ?? {};
    // These are the substitutions a production composition must never make. If
    // any of them were true the service would be running on single-instance
    // state while reporting numbers that read exactly like real ones.
    const mustBeShared = {
      sessionBackend: 'redis',
      agentStateBackend: 'redis',
      sipBackend: 'redis',
      observationBackend: 'redis',
      channelBackend: 'redis',
      dedupeBackend: 'redis',
      decisionBackend: 'redis',
      extensionSource: 'database',
      assignmentSource: 'database',
      lockBackend: 'redis',
    };
    for (const [field, expected] of Object.entries(mustBeShared)) {
      if (b[field] !== expected) fail(`${field} is "${b[field]}", expected "${expected}"`);
    }
    if (b.decisionsFenced !== true) fail('decisions are not fenced in a production composition');
    if (b.postgresConnected !== true) fail('postgres is not reported connected');
    if (b.redisConnected !== true) fail('redis is not reported connected');
  }

  if (exitedEarly) fail(`the process exited during the checks (code=${exitedEarly.code})`);
} catch (error) {
  fail(error.message);
} finally {
  // ── 7. Terminate cleanly ─────────────────────────────────────────────────
  if (!exitedEarly) {
    const stopped = new Promise(r => child.once('exit', (code, signal) => r({ code, signal })));
    child.kill('SIGTERM');
    const outcome = await Promise.race([stopped, sleep(10_000).then(() => 'timeout')]);
    if (outcome === 'timeout') {
      fail('the process did not exit within 10s of SIGTERM');
      child.kill('SIGKILL');
    } else {
      note(`exited cleanly on SIGTERM (code=${outcome.code} signal=${outcome.signal})`);
    }
  }
}

if (problems.length > 0) {
  process.stdout.write(`\nsmoke: FAILED with ${problems.length} problem(s):\n`);
  for (const p of problems) process.stdout.write(`  - ${p}\n`);
  exitCode = 1;
} else {
  process.stdout.write(`\nsmoke: the built artifact started and answered correctly in ${mode} mode\n`);
}

process.exit(exitCode);
