/**
 * Screenshots of the white-label owner portal on the Life Leads Plus demo data.
 *
 *   SHOTS_DATABASE_URL=postgresql://test:test@localhost:5432/hopwhistle_test \
 *   SHOTS_REDIS_URL=redis://localhost:6379/4 \
 *   SHOTS_LABEL=after \
 *   node apps/web/e2e/overhaul-screenshots.mjs
 *
 * What it does, in order:
 *
 *   1. Reseeds the demo with scripts/seed/life-leads-plus-demo.sql (creating
 *      the Life Leads Plus tenant and the roles first if the database is new),
 *      so every shot is of data that is "today".
 *   2. Signs people in the way they really are: a Life Leads Plus OWNER + ADMIN
 *      with a password, a platform admin previewing the agency "As agency
 *      owner", a downline agency's owner, and a buyer and a publisher on the
 *      demo's first buyer and publisher.
 *   3. Boots the API and `next dev` behind one origin, as the smoke test does.
 *   4. Loads every screen and saves three shots: 1366×768 viewport, 1366 full
 *      page, and 390 wide full page, to docs/screenshots/overhaul/<label>/.
 *   5. Deletes today's demo calls, shoots Today with zero calls in the period,
 *      and reseeds.
 *
 * Iterating: SHOTS_SERVE=1 reseeds, boots the servers and keeps them up;
 * SHOTS_ATTACH=1 in a second shell shoots against those, without reseeding or
 * booting anything (SHOTS_ONLY=<regex> narrows it to some screens).
 *
 * Any 4xx/5xx from the API while a screen loads is printed, and the run exits
 * non-zero if there was one. Like the smoke test it only runs against a
 * loopback database with "test" in its name.
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');
/**
 * The checkout whose API and web app are shot. This one by default; point it
 * at a worktree of main (with this checkout's node_modules linked in) for the
 * "before" set. The seed, the harness and the output always come from here.
 */
const APP_ROOT = process.env.SHOTS_APP_ROOT ? resolve(process.env.SHOTS_APP_ROOT) : REPO;
const WEB_DIR = resolve(APP_ROOT, 'apps/web');
const API_DIR = resolve(APP_ROOT, 'apps/api');

/**
 * SHOTS_CLOCK=HH:MM runs everything as of that time in New York today: the
 * seed (its `llp.now`), the API and `next dev` (shift-clock.cjs) and the
 * browser. A Today screenshot taken in the middle of the night otherwise
 * shows a day with nothing in it.
 */
function newYorkToday(hours, minutes) {
  const now = new Date();
  const part = type =>
    Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
        .formatToParts(now)
        .find(p => p.type === type).value
    );
  const guess = Date.UTC(part('year'), part('month') - 1, part('day'), hours, minutes);
  const wall = zone => new Date(new Date(guess).toLocaleString('en-US', { timeZone: zone }));
  return new Date(guess + (wall('UTC') - wall('America/New_York')));
}
const CLOCK_OFFSET_MS = process.env.SHOTS_CLOCK
  ? newYorkToday(...process.env.SHOTS_CLOCK.split(':').map(Number)).getTime() - Date.now()
  : 0;
const fakeNow = () => new Date(Date.now() + CLOCK_OFFSET_MS);
const SHIFT_CLOCK = resolve(HERE, 'shift-clock.cjs');
const shiftedEnv = () =>
  CLOCK_OFFSET_MS === 0
    ? {}
    : {
        SHOTS_CLOCK_OFFSET_MS: String(CLOCK_OFFSET_MS),
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --require ${SHIFT_CLOCK}`.trim(),
      };

const API_PORT = Number(process.env.SHOTS_API_PORT ?? 3411);
const WEB_PORT = Number(process.env.SHOTS_WEB_PORT ?? 3410);
const FRONT_PORT = Number(process.env.SHOTS_FRONT_PORT ?? 3412);
const FRONT = `http://127.0.0.1:${FRONT_PORT}`;

const LABEL = process.env.SHOTS_LABEL ?? 'after';
const OUT = resolve(REPO, 'docs/screenshots/overhaul', LABEL);
const ONLY = process.env.SHOTS_ONLY ? new RegExp(process.env.SHOTS_ONLY) : null;
const SETTLE_MS = Number(process.env.SHOTS_SETTLE_MS ?? 3500);
const PASSWORD = 'screens-Passw0rd!';
const SERVE = process.env.SHOTS_SERVE === '1';
const ATTACH = process.env.SHOTS_ATTACH === '1';

const DATABASE = process.env.SHOTS_DATABASE_URL ?? '';
const REDIS = process.env.SHOTS_REDIS_URL ?? '';
{
  const url = DATABASE ? new URL(DATABASE) : null;
  if (
    !url ||
    !REDIS ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    !url.pathname.includes('test')
  ) {
    console.error('Set SHOTS_DATABASE_URL (loopback, "test" in the name) and SHOTS_REDIS_URL.');
    process.exit(1);
  }
}

/** Who signs in, and the email each one uses. */
const PEOPLE = {
  owner: 'owner@llp.screens.invalid',
  preview: 'platform@llp.screens.invalid',
  downline: 'owner@riverbend.screens.invalid',
  buyer: 'buyer@llp.screens.invalid',
  publisher: 'publisher@llp.screens.invalid',
};

/** Every screen, as the person it belongs to. `{child}` is Riverbend's tenant id. */
const SCREENS = [
  { id: 'today', who: 'owner', path: '/dashboard' },
  { id: 'today-yesterday', who: 'owner', path: '/dashboard?period=YESTERDAY' },
  { id: 'today-last-7-days', who: 'owner', path: '/dashboard?period=LAST_7_DAYS' },
  { id: 'calls', who: 'owner', path: '/calls' },
  {
    id: 'calls-filtered',
    who: 'owner',
    path: '/calls?outcome=AGENTS&disposition=APPLICATION_SUBMITTED',
  },
  { id: 'applications', who: 'owner', path: '/applications' },
  { id: 'crm', who: 'owner', path: '/insurance-leads' },
  { id: 'agents-floor', who: 'owner', path: '/agents?tab=floor' },
  { id: 'agents-performance', who: 'owner', path: '/agents?tab=performance' },
  { id: 'agents-period', who: 'owner', path: '/agents?tab=period' },
  { id: 'agents-roster', who: 'owner', path: '/agents?tab=roster' },
  { id: 'buyers', who: 'owner', path: '/buyers?tab=buyers' },
  { id: 'buyers-balances', who: 'owner', path: '/buyers?tab=wallets' },
  { id: 'buyers-returns', who: 'owner', path: '/buyers?tab=returns' },
  { id: 'publishers', who: 'owner', path: '/publishers?tab=publishers' },
  { id: 'publishers-payouts', who: 'owner', path: '/publishers?tab=payouts' },
  { id: 'revenue-overview', who: 'owner', path: '/revenue?tab=overview' },
  { id: 'revenue-reports', who: 'owner', path: '/revenue?tab=reports' },
  { id: 'revenue-statements', who: 'owner', path: '/revenue?tab=statements' },
  { id: 'routing-campaigns', who: 'owner', path: '/routing?tab=campaigns' },
  { id: 'routing-numbers', who: 'owner', path: '/routing?tab=numbers' },
  { id: 'agencies', who: 'owner', path: '/network/agencies' },
  { id: 'agency-detail', who: 'owner', path: '/network/agencies/{child}' },
  { id: 'settings', who: 'owner', path: '/settings' },
  { id: 'settings-plan', who: 'owner', path: '/settings?tab=plan' },
  { id: 'upgrades', who: 'owner', path: '/upgrades' },
  { id: 'preview-today', who: 'preview', path: '/dashboard' },
  { id: 'preview-calls', who: 'preview', path: '/calls' },
  { id: 'preview-crm', who: 'preview', path: '/insurance-leads' },
  { id: 'preview-agents', who: 'preview', path: '/agents?tab=roster' },
  { id: 'downline-dashboard', who: 'downline', path: '/dashboard' },
  { id: 'downline-calls', who: 'downline', path: '/calls' },
  { id: 'buyer-dashboard', who: 'buyer', path: '/buyer/dashboard' },
  { id: 'buyer-calls', who: 'buyer', path: '/buyer/calls' },
  { id: 'buyer-spend', who: 'buyer', path: '/buyer/spend' },
  { id: 'buyer-billing', who: 'buyer', path: '/buyer/billing' },
  { id: 'buyer-disputes', who: 'buyer', path: '/buyer/disputes' },
  { id: 'publisher-dashboard', who: 'publisher', path: '/publisher/dashboard' },
  { id: 'publisher-calls', who: 'publisher', path: '/publisher/calls' },
  { id: 'publisher-earnings', who: 'publisher', path: '/publisher/earnings' },
  { id: 'publisher-payouts', who: 'publisher', path: '/publisher/payouts' },
];

// ─── Data ────────────────────────────────────────────────────────────────────

function psql(args, input) {
  const result = spawnSync('psql', [DATABASE, '-v', 'ON_ERROR_STOP=1', '-q', ...args], {
    input,
    encoding: 'utf8',
    // The seed reads `llp.now` as the time to seed as of.
    env: { ...process.env, PGOPTIONS: `-c llp.now=${fakeNow().toISOString()}` },
  });
  if (result.status !== 0) throw new Error(`psql failed: ${result.stderr}`);
  return result.stdout;
}

/** The tenant and roles the seed's guard expects, on a database that has neither. */
const BOOTSTRAP = `
INSERT INTO roles (id, name, permissions, "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, n::"RoleName", '{}', now(), now()
FROM unnest(ARRAY['OWNER','ADMIN','AGENT','PUBLISHER','BUYER']) AS n
ON CONFLICT DO NOTHING;
INSERT INTO tenants (id, name, slug, status, "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'Life Leads Plus', 'life-leads-plus', 'ACTIVE', now(), now()
WHERE NOT EXISTS (SELECT 1 FROM tenants WHERE name = 'Life Leads Plus');
-- This harness's own people go first: one of them belongs to a child agency the
-- seed deletes and recreates.
DELETE FROM platform_acting_tenants WHERE "userId" IN (SELECT id FROM users WHERE email LIKE '%.screens.invalid');
DELETE FROM platform_admins WHERE "userId" IN (SELECT id FROM users WHERE email LIKE '%.screens.invalid');
DELETE FROM user_roles WHERE "userId" IN (SELECT id FROM users WHERE email LIKE '%.screens.invalid');
DELETE FROM users WHERE email LIKE '%.screens.invalid';
`;

function reseed() {
  psql([], BOOTSTRAP);
  psql(['-f', resolve(REPO, 'scripts/seed/life-leads-plus-demo.sql')]);
}

const PEOPLE_SEED = `
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const people = JSON.parse(process.env.SHOTS_PEOPLE);
const passwordHash = await bcrypt.hash(process.env.SHOTS_PASSWORD, 10);

const llp = await prisma.tenant.findFirstOrThrow({ where: { name: 'Life Leads Plus' } });
const child = await prisma.tenant.findFirstOrThrow({ where: { slug: 'llp-demo-riverbend' } });
const buyer = await prisma.buyer.findFirstOrThrow({ where: { tenantId: llp.id, code: 'LLPDEMOBUY1' } });
const publisher = await prisma.publisher.findFirstOrThrow({
  where: { tenantId: llp.id, code: 'LLPDEMOPUB1' },
});
const role = async name => prisma.role.findUniqueOrThrow({ where: { name } });

async function person(email, tenantId, roles, extra = {}) {
  const user = await prisma.user.create({
    data: {
      email, passwordHash, tenantId, status: 'ACTIVE', firstName: 'Screens',
      lastName: email.split('@')[0], ...extra,
    },
  });
  for (const name of roles) {
    await prisma.userRole.create({ data: { userId: user.id, roleId: (await role(name)).id } });
  }
  return user;
}

await person(people.owner, llp.id, ['OWNER', 'ADMIN']);
const staff = await person(people.preview, llp.id, ['ADMIN']);
await prisma.platformAdmin.create({
  data: { userId: staff.id, grantedBy: staff.id, note: 'overhaul screenshots' },
});
await prisma.platformActingTenant.create({
  data: { userId: staff.id, tenantId: llp.id, previewRole: 'OWNER' },
});
await person(people.downline, child.id, ['OWNER']);
await person(people.buyer, llp.id, ['BUYER'], { buyerId: buyer.id });
await person(people.publisher, llp.id, ['PUBLISHER'], { publisherId: publisher.id });

console.log(JSON.stringify({ child: child.id }));
await prisma.$disconnect();
`;

function seedPeople() {
  const result = spawnSync('node', ['--input-type=module', '--eval', PEOPLE_SEED], {
    cwd: API_DIR,
    encoding: 'utf8',
    env: {
      ...process.env,
      DATABASE_URL: DATABASE,
      SHOTS_PEOPLE: JSON.stringify(PEOPLE),
      SHOTS_PASSWORD: PASSWORD,
    },
  });
  if (result.status !== 0) throw new Error(`people seed failed: ${result.stderr}`);
  return JSON.parse(result.stdout.trim().split('\n').pop());
}

/** Today's demo calls and applications gone, for the zero-calls shot. */
const EMPTY_TODAY = `
BEGIN;
SET LOCAL TIME ZONE 'UTC';
CREATE TEMP TABLE today_calls ON COMMIT DROP AS
  SELECT c.id FROM calls c
  JOIN tenants t ON t.id = c."tenantId" AND t.name = 'Life Leads Plus'
  WHERE c."callSid" LIKE 'LLPDEMO-%'
    AND (c."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date
        = (COALESCE(NULLIF(current_setting('llp.now', true), '')::timestamptz, now())
           AT TIME ZONE 'America/New_York')::date;
DELETE FROM insurance_carrier_applications WHERE "callId" IN (SELECT id FROM today_calls);
DELETE FROM calls WHERE id IN (SELECT id FROM today_calls);
COMMIT;
`;

// ─── Processes ───────────────────────────────────────────────────────────────

const children = [];
let front = null;

function run(command, args, options) {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
  children.push(child);
  child.log = [];
  child.stdout.on('data', d => child.log.push(String(d)));
  child.stderr.on('data', d => child.log.push(String(d)));
  return child;
}

async function shutdown() {
  for (const child of children) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
  await new Promise(r => (front ? front.close(r) : r()));
}

async function waitFor(label, probe, timeoutMs, onTimeout) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error(`${label} did not come up within ${timeoutMs}ms\n${onTimeout?.() ?? ''}`);
}

const reachable = url =>
  fetch(url)
    .then(r => r.status < 500)
    .catch(() => false);

function startFrontDoor() {
  front = createServer((req, res) => {
    const port = req.url.startsWith('/api/') ? API_PORT : WEB_PORT;
    const up = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: `127.0.0.1:${port}` },
      },
      upstream => {
        res.writeHead(upstream.statusCode, upstream.headers);
        upstream.pipe(res);
      }
    );
    up.on('error', err => {
      res.writeHead(502);
      res.end(String(err));
    });
    req.pipe(up);
  });
  return new Promise(r => front.listen(FRONT_PORT, '127.0.0.1', r));
}

function flushTodayCache() {
  spawnSync('redis-cli', ['-u', REDIS, '--scan', '--pattern', 'wl:today:*'], {
    encoding: 'utf8',
  })
    .stdout.split('\n')
    .filter(Boolean)
    .forEach(key => spawnSync('redis-cli', ['-u', REDIS, 'DEL', key]));
}

// ─── Browser ─────────────────────────────────────────────────────────────────

async function signIn(email) {
  const res = await fetch(`${FRONT}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = await res.json();
  if (!body?.token) throw new Error(`sign-in failed for ${email}: ${res.status}`);
  return body;
}

async function contextFor(browser, session, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  if (CLOCK_OFFSET_MS !== 0) {
    // The browser's clock, moved the same distance as the servers'.
    await context.addInitScript(offset => {
      const RealDate = Date;
      class ShiftedDate extends RealDate {
        constructor(...args) {
          if (args.length === 0) super(RealDate.now() + offset);
          else super(...args);
        }
        static now() {
          return RealDate.now() + offset;
        }
      }
      globalThis.Date = ShiftedDate;
    }, CLOCK_OFFSET_MS);
  }
  await context.addInitScript(
    ([token, user]) => {
      localStorage.setItem('token', token);
      localStorage.setItem('user', user);
    },
    [session.token, JSON.stringify(session.user)]
  );
  await context.addCookies([
    { name: 'hw_session', value: session.token, domain: '127.0.0.1', path: '/', sameSite: 'Lax' },
  ]);
  return context;
}

const refusals = [];

/** Undo the fixed-height shell for a full-page shot. */
const FULL_PAGE_CSS = `
  div.h-screen { height: auto !important; min-height: 100vh; overflow: visible !important; }
  div.h-screen > div { min-width: 0 !important; }
  main { overflow: visible !important; flex: none !important; min-width: 0 !important; }
  div.h-screen > div.h-full { height: auto !important; }
  div.h-screen > div.h-full > * { height: 100% !important; }
`;

async function shoot(context, screen, path, sizes) {
  const page = await context.newPage();
  page.on('response', r => {
    const url = new URL(r.url());
    if (url.origin === FRONT && url.pathname.startsWith('/api/') && r.status() >= 400) {
      refusals.push(`${screen.id}: ${r.status()} ${url.pathname}`);
    }
  });
  await page.goto(`${FRONT}${path}`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => null);
  await page.waitForTimeout(SETTLE_MS);
  // The collapsed softphone and the Next dev indicator float over the page.
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  for (const size of sizes) {
    // The shell scrolls inside <main>, so a full-page shot first lets the
    // document grow to the height of the content.
    const unroll = size.full ? await page.addStyleTag({ content: FULL_PAGE_CSS }) : null;
    if (unroll) await page.waitForTimeout(300);
    await page.screenshot({
      path: resolve(OUT, `${screen.id}-${size.name}.png`),
      fullPage: size.full,
    });
    if (unroll) await unroll.evaluate(el => el.remove());
  }
  await page.close();
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  let child;
  if (ATTACH) {
    child = psql(['-tA', '-c', "SELECT id FROM tenants WHERE slug = 'llp-demo-riverbend'"]).trim();
  } else {
    reseed();
    child = seedPeople().child;
    await boot();
  }
  if (SERVE) {
    console.log(`serving on ${FRONT}`);
    await new Promise(() => {});
  }
  await shootAll(child);
}

async function boot() {
  const api = run('node', [resolve(REPO, 'node_modules/tsx/dist/cli.mjs'), 'src/index.ts'], {
    cwd: API_DIR,
    detached: true,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(API_PORT),
      DATABASE_URL: DATABASE,
      REDIS_URL: REDIS,
      JWT_SECRET: 'overhaul-screens-secret-overhaul-screens-secret',
      SIP_AGENT_PASSWORD: 'overhaul-screens-sip',
      RATE_LIMIT_MAX: '5000',
      FRONTER_SOCKET_PORT: String(API_PORT + 1000),
      ...shiftedEnv(),
    },
  });
  const web = run(
    'node',
    [resolve(REPO, 'node_modules/next/dist/bin/next'), 'dev', '-p', String(WEB_PORT)],
    {
      cwd: WEB_DIR,
      detached: true,
      env: {
        ...process.env,
        NEXT_PUBLIC_API_URL: `http://127.0.0.1:${API_PORT}`,
        ...shiftedEnv(),
      },
    }
  );
  await startFrontDoor();
  await waitFor(
    'the API',
    () => reachable(`http://127.0.0.1:${API_PORT}/health`),
    120_000,
    () => api.log.slice(-20).join('')
  );
  await waitFor(
    'the web app',
    () => reachable(`http://127.0.0.1:${WEB_PORT}/login`),
    240_000,
    () => web.log.slice(-20).join('')
  );
}

async function shootAll(child) {
  flushTodayCache();

  const screens = SCREENS.filter(s => !ONLY || ONLY.test(s.id)).map(s => ({
    ...s,
    path: s.path.replace('{child}', child),
  }));
  for (const path of new Set(screens.map(s => s.path.split('?')[0]))) {
    await fetch(`${FRONT}${path}`, { redirect: 'manual' }).catch(() => null);
  }

  const browser = await chromium.launch({
    executablePath: process.env.SHOTS_CHROMIUM || undefined,
  });
  const sessions = {};
  for (const [who, email] of Object.entries(PEOPLE)) sessions[who] = await signIn(email);

  const desk = { width: 1366, height: 768 };
  const phone = { width: 390, height: 844 };
  for (const screen of screens) {
    const deskContext = await contextFor(browser, sessions[screen.who], desk);
    await shoot(deskContext, screen, screen.path, [
      { name: '1366', full: false },
      { name: '1366-full', full: true },
    ]);
    await deskContext.close();
    const phoneContext = await contextFor(browser, sessions[screen.who], phone);
    await shoot(phoneContext, screen, screen.path, [{ name: '390', full: true }]);
    await phoneContext.close();
    console.log(`shot ${screen.id}`);
  }

  if (!ONLY || ONLY.test('today-zero')) {
    psql([], EMPTY_TODAY);
    flushTodayCache();
    const zero = { id: 'today-zero', who: 'owner', path: '/dashboard' };
    const deskContext = await contextFor(browser, sessions.owner, desk);
    await shoot(deskContext, zero, zero.path, [
      { name: '1366', full: false },
      { name: '1366-full', full: true },
    ]);
    await deskContext.close();
    const phoneContext = await contextFor(browser, sessions.owner, phone);
    await shoot(phoneContext, zero, zero.path, [{ name: '390', full: true }]);
    await phoneContext.close();
    console.log('shot today-zero');
    reseed();
    seedPeople();
  }

  await browser.close();
  if (refusals.length > 0) {
    console.error(`\n${refusals.length} refused API request(s):\n${refusals.join('\n')}`);
    process.exitCode = 1;
  }
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(shutdown);
