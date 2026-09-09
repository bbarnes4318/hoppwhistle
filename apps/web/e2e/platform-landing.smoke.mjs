/**
 * Load the platform admin's landing pages in a real browser and look at them.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 *
 * Three consecutive phases shipped a defect that one load of the page as a
 * platform admin would have caught: the `.map` crash that unmounted the
 * dashboard, fourteen routes answering 401, and the "Choose an agency" prompt
 * on a page that is supposed to be cross-agency. Every one of them passed CI.
 *
 * They passed because nothing in this repository ever rendered these pages.
 * `apps/api` tests drove the endpoints, which were correct. `apps/web` tests ran
 * in a `node` environment with no DOM, and the one test that covered this
 * decision read `layout.tsx` as TEXT and regex-matched the shape of the
 * expression -- so it kept passing while the expression it matched was being
 * evaluated against a value that had not loaded yet. A test that reads source
 * cannot see a race, and a test that mocks the browser cannot see a redirect.
 *
 * So this boots the real API against a disposable database, boots the real web
 * app, signs in as a platform admin who has entered no agency, and loads each
 * of the three routes in Chromium. It asserts what an operator would see:
 *
 *   1. THE PAGE ACTUALLY RENDERED. Named first because it is the assertion that
 *      keeps the other two honest. An app that fails to compile shows no
 *      prompt and fires no refused request, and would otherwise pass every
 *      check below -- which is not a hypothetical, it happened while this file
 *      was being written.
 *   2. THE URL DID NOT MOVE. The layout used to redirect an operator who also
 *      held PUBLISHER or BUYER off /delivery before the platform context had
 *      loaded, and the prompt on the page they landed on was correct.
 *   3. THE PROMPT IS ABSENT.
 *   4. NOTHING WAS REFUSED. No 4xx or 5xx from any API request the page load
 *      made -- 409 NO_ACTING_TENANT included, which is what agency-scoped
 *      polling produced dozens of.
 *   5. THE POLLING SETTLES. After the page is left alone, the request count
 *      stops climbing. A loop that retries a terminal refusal forever is its
 *      own defect regardless of what is on screen.
 *
 * ── The publisher portal ─────────────────────────────────────────────────────
 *
 * The same five assertions then run again over the four publisher pages, signed
 * in as an ordinary PUBLISHER linked to a publisher record -- no platform
 * capability, no agency to enter, exactly the account the portal is for.
 *
 * That sweep exists because of what it caught. `requirePublisherAccess()` read
 * `user.roles` and `user.publisherId` from a JWT that carries neither, so it
 * returned false for every caller: the dashboard, earnings and API-credentials
 * pages each answered 403, for every publisher, always. `apps/api` had tests
 * over those endpoints and they all passed, because they asked as an
 * administrator. Loading the page as the person it belongs to is what shows it.
 *
 * ── Running it ───────────────────────────────────────────────────────────────
 *
 *   SMOKE_DATABASE_URL=postgresql://user:pass@localhost:5432/hopwhistle_test \
 *   SMOKE_REDIS_URL=redis://localhost:6379/3 \
 *   node apps/web/e2e/platform-landing.smoke.mjs
 *
 * It seeds and reads a database, so like the DB-backed suites in `apps/api` it
 * only runs against one explicitly nominated as disposable -- loopback host,
 * and "test" in the name. Without that it refuses. In CI it refuses LOUDLY:
 * `CI=true` with no nominated services exits non-zero, because a smoke test
 * that silently skips inside a blocking job is a green tick that means nothing,
 * and that is exactly how this class of defect kept reaching production.
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = resolve(HERE, '..');
const API_DIR = resolve(HERE, '../../api');
const REPO = resolve(HERE, '../../..');

const API_PORT = Number(process.env.SMOKE_API_PORT ?? 3401);
const WEB_PORT = Number(process.env.SMOKE_WEB_PORT ?? 3400);
const FRONT_PORT = Number(process.env.SMOKE_FRONT_PORT ?? 3402);
const FRONT = `http://127.0.0.1:${FRONT_PORT}`;

const OPERATOR = { email: 'platform-smoke@netenroll.invalid', password: 'smoke-Passw0rd!' };
const PUBLISHER = { email: 'publisher-smoke@netenroll.invalid', password: 'smoke-Passw0rd!' };

/**
 * The routes that must render platform-wide, and the heading that proves each
 * one did. Kept beside `PLATFORM_WIDE_LANDING_ROUTES` in
 * `src/lib/platform-routes.ts`; the guard below fails if they drift apart.
 */
const ROUTES = [
  { path: '/delivery', heading: 'Delivery — every agency' },
  { path: '/rating', heading: 'Rate — every agency' },
  { path: '/delivery/settlements', heading: 'Settlements — every agency' },
];

/**
 * The roles to run every route under.
 *
 * PUBLISHER and BUYER are not decoration. A platform admin who also holds one
 * of them is the case that broke: the layout's role-based redirect ran before
 * `/api/v1/platform/context` answered, read `isPlatformAdmin` as false because
 * it had not loaded, and moved the operator to /publisher/dashboard -- a page
 * with no cross-agency reading, which then correctly showed the prompt. With
 * only ADMIN in this list the bug reproduces on nobody.
 */
const ROLE_SETS = [['ADMIN'], ['PUBLISHER'], ['BUYER'], ['AGENT']];

/**
 * The publisher portal, and the heading that proves each page rendered.
 *
 * Three of the four ask the API for `/api/v1/publishers/:id/stats`, `/keys` or
 * `/docs` on load, and every one of those answered 403 to the publisher who
 * owns them. `/publisher/docs` is static and asks for nothing -- it is here
 * because it is one of the four pages the portal is made of, and a page that
 * stops rendering is a failure whether or not it fetches.
 */
const PUBLISHER_ROUTES = [
  { path: '/publisher/dashboard', heading: 'Publisher Overview' },
  { path: '/publisher/earnings', heading: 'Earnings & Payouts' },
  { path: '/publisher/api-setup', heading: 'API Credentials' },
  { path: '/publisher/docs', heading: 'Support & Documentation' },
];

/**
 * Latency added to `/api/v1/platform/context`, and why there has to be any.
 *
 * The defect this file exists for lives in the window between the auth check
 * answering and the platform context answering: the layout read
 * `isPlatformAdmin` as false because it had not loaded yet, and redirected an
 * operator who also held PUBLISHER off /delivery. On this machine the API and
 * the database are the same machine and that window is a couple of
 * milliseconds wide, so the bug does not reproduce locally even with the fix
 * removed -- verified by removing it. Production is a network and a database
 * away.
 *
 * So the front door holds this one response back. It is not a trick to make a
 * test fail; it is the only way a localhost run tests the ordering that
 * production actually has. Raise it if a fix ever looks green here and broken
 * there.
 */
const CONTEXT_LATENCY_MS = Number(process.env.SMOKE_CONTEXT_LATENCY_MS ?? 400);

/** How long to sit on a loaded page before counting what it asked for. */
const SETTLE_MS = 8000;
/** How long to leave one page completely alone, watching for a polling loop. */
const IDLE_MS = 45_000;

// ─── Services must be nominated as disposable ────────────────────────────────

function nominatedServices() {
  const database = process.env.SMOKE_DATABASE_URL ?? '';
  const redis = process.env.SMOKE_REDIS_URL ?? '';
  if (!database || !redis) {
    return { ok: false, why: 'SMOKE_DATABASE_URL and SMOKE_REDIS_URL are not both set' };
  }

  let parsed;
  try {
    parsed = new URL(database);
  } catch {
    return { ok: false, why: 'SMOKE_DATABASE_URL is not a URL' };
  }

  const loopback = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  if (!loopback && process.env.ALLOW_REMOTE_TEST_SERVICES !== '1') {
    return { ok: false, why: `SMOKE_DATABASE_URL host ${parsed.hostname} is not loopback` };
  }
  if (!parsed.pathname.slice(1).includes('test')) {
    return { ok: false, why: 'SMOKE_DATABASE_URL database name does not contain "test"' };
  }

  return { ok: true, database, redis };
}

// ─── Process plumbing ────────────────────────────────────────────────────────

const children = [];
let front = null;

function run(command, args, options) {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
  children.push(child);
  const log = [];
  child.stdout.on('data', d => log.push(String(d)));
  child.stderr.on('data', d => log.push(String(d)));
  child.log = log;
  return child;
}

async function shutdown() {
  for (const child of children) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
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

/**
 * One origin in front of both, the way production serves them.
 *
 * `useAuth` calls `/api/auth/me` as a same-origin relative URL, and the app's
 * own rewrite only forwards `/api/v1/*`. Pointing the browser straight at the
 * dev server therefore 404s the auth check, every page bounces to /login, and
 * the whole run passes vacuously against a signed-out browser. Ask how that was
 * discovered.
 */
function startFrontDoor() {
  front = createServer((req, res) => {
    const port = req.url.startsWith('/api/') ? API_PORT : WEB_PORT;
    const hold = req.url.startsWith('/api/v1/platform/context') ? CONTEXT_LATENCY_MS : 0;
    const up = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: `127.0.0.1:${port}` },
      },
      upstream => {
        setTimeout(() => {
          res.writeHead(upstream.statusCode, upstream.headers);
          upstream.pipe(res);
        }, hold);
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

// ─── The operator ────────────────────────────────────────────────────────────

/**
 * A platform admin holding `roles`, with NO acting tenant. Written through
 * Prisma rather than through the API because there is no endpoint that grants
 * the platform capability, and there should not be one.
 */
const SEED = `
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const roles = (process.env.SMOKE_ROLES ?? 'ADMIN').split(',').filter(Boolean);

const tenant = await prisma.tenant.upsert({
  where: { slug: 'platform-smoke' },
  update: {},
  create: { name: 'Platform Smoke Agency', slug: 'platform-smoke', status: 'ACTIVE' },
});

const passwordHash = await bcrypt.hash(process.env.SMOKE_PASSWORD, 10);
const user = await prisma.user.upsert({
  where: { email: process.env.SMOKE_EMAIL },
  update: { passwordHash, status: 'ACTIVE' },
  create: {
    email: process.env.SMOKE_EMAIL,
    passwordHash,
    firstName: 'Platform',
    lastName: 'Smoke',
    status: 'ACTIVE',
    tenantId: tenant.id,
  },
});

await prisma.platformAdmin.upsert({
  where: { userId: user.id },
  update: {},
  create: { userId: user.id, grantedBy: user.id, note: 'platform landing smoke test' },
});

// The state under test: staff, inside no agency.
await prisma.platformActingTenant.deleteMany({ where: { userId: user.id } });

/*
 * The curve and settings rows the 20260908000000_add_rating_engine migration
 * seeds. Recreated here for the same reason apps/api's rating suite recreates
 * them: CI builds its database with \`prisma db push\`, which applies the schema
 * and none of the migrations' data, so /rating has no curve to read and the
 * platform overview answers 500. Production has these rows; a smoke test that
 * only ever ran against a database missing them would be asserting against a
 * page nobody has.
 */
if (!(await prisma.rateCurveVersion.findUnique({ where: { version: 1 } }))) {
  await prisma.rateCurveVersion.create({
    data: {
      id: '00000000-0000-4000-8000-00000000c001',
      version: 1,
      label: 'Launch curve',
      minimumClosingPct: 5,
      flatFromClosingPct: 15,
      anchors: {
        create: [
          { closingPct: 5, rate: 264 },
          { closingPct: 6, rate: 234 },
          { closingPct: 7, rate: 204 },
          { closingPct: 8, rate: 184 },
          { closingPct: 9, rate: 169 },
          { closingPct: 10, rate: 159 },
          { closingPct: 11, rate: 159 },
          { closingPct: 12, rate: 149 },
          { closingPct: 13, rate: 144 },
          { closingPct: 14, rate: 139 },
          { closingPct: 15, rate: 134 },
        ],
      },
    },
  });
}

await prisma.ratingSettings.upsert({
  where: { id: 'global' },
  create: {
    id: 'global',
    windowDeliveryDays: 3,
    activeCurveVersionId: '00000000-0000-4000-8000-00000000c001',
  },
  update: { activeCurveVersionId: '00000000-0000-4000-8000-00000000c001' },
});

await prisma.userRole.deleteMany({ where: { userId: user.id } });
for (const name of roles) {
  const role = await prisma.role.upsert({
    where: { name },
    update: {},
    create: { name, permissions: [] },
  });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
}

await prisma.$disconnect();
`;

async function seed(services, roles) {
  await runSeed(SEED, services, {
    SMOKE_EMAIL: OPERATOR.email,
    SMOKE_PASSWORD: OPERATOR.password,
    SMOKE_ROLES: roles.join(','),
  });
}

async function seedPublisher(services) {
  await runSeed(PUBLISHER_SEED, services, {
    SMOKE_EMAIL: PUBLISHER.email,
    SMOKE_PASSWORD: PUBLISHER.password,
  });
}

/**
 * An ordinary publisher: the PUBLISHER role, linked to a Publisher row, in an
 * agency, with no platform capability.
 *
 * The link is the part that matters. `User.publisherId` is what decides which
 * publisher's data this account may reach, and a publisher user without one
 * must reach nothing -- so seeding it is what makes a passing sweep mean the
 * portal works, rather than meaning the checks were skipped.
 */
const PUBLISHER_SEED = `
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const tenant = await prisma.tenant.upsert({
  where: { slug: 'publisher-smoke' },
  update: {},
  create: { name: 'Publisher Smoke Agency', slug: 'publisher-smoke', status: 'ACTIVE' },
});

const publisher = await prisma.publisher.upsert({
  where: { tenantId_code: { tenantId: tenant.id, code: 'SMOKEPUB' } },
  update: { status: 'ACTIVE' },
  create: { tenantId: tenant.id, name: 'Publisher Smoke Source', code: 'SMOKEPUB' },
});

const role = await prisma.role.upsert({
  where: { name: 'PUBLISHER' },
  update: {},
  create: { name: 'PUBLISHER', permissions: [] },
});

const passwordHash = await bcrypt.hash(process.env.SMOKE_PASSWORD, 10);
const user = await prisma.user.upsert({
  where: { email: process.env.SMOKE_EMAIL },
  update: { passwordHash, status: 'ACTIVE', tenantId: tenant.id, publisherId: publisher.id },
  create: {
    email: process.env.SMOKE_EMAIL,
    passwordHash,
    firstName: 'Publisher',
    lastName: 'Smoke',
    status: 'ACTIVE',
    tenantId: tenant.id,
    publisherId: publisher.id,
  },
});

// No platform capability, and only the PUBLISHER role: the account the portal
// is built for, and the one every check refused.
await prisma.platformAdmin.deleteMany({ where: { userId: user.id } });
await prisma.userRole.deleteMany({ where: { userId: user.id } });
await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });

await prisma.$disconnect();
`;

function runSeed(script, services, env) {
  return new Promise((ok, fail) => {
    const child = spawn('node', ['--input-type=module', '--eval', script], {
      cwd: API_DIR,
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, DATABASE_URL: services.database, ...env },
    });
    child.on('exit', code => (code === 0 ? ok() : fail(new Error(`seed exited ${code}`))));
  });
}

async function signIn(who = OPERATOR) {
  const res = await fetch(`${FRONT}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(who),
  });
  const body = await res.json();
  if (!body?.token) throw new Error(`sign-in failed: ${res.status} ${JSON.stringify(body)}`);
  return body;
}

// ─── The assertions ──────────────────────────────────────────────────────────

const failures = [];
const fail = message => failures.push(message);

async function openAsOperator(browser, session, path) {
  const context = await browser.newContext();

  /*
   * Both halves of a signed-in browser, because the app uses both.
   *
   * `login` writes the token to localStorage AND to the `hw_session` cookie,
   * and the server components read the cookie: the layout under /publisher
   * resolves the session server-side and redirects to /login without it. Seeding
   * only localStorage produced a browser that client components considered
   * signed in and every server guard considered signed out -- which is not a
   * state any real session is ever in, and would have reported the entire
   * publisher portal as broken no matter what the API answered.
   */
  await context.addCookies([
    { name: 'hw_session', value: session.token, url: FRONT, sameSite: 'Lax' },
  ]);

  await context.addInitScript(
    ([token, user]) => {
      localStorage.setItem('token', token);
      localStorage.setItem('user', user);
    },
    [session.token, JSON.stringify(session.user)]
  );

  const page = await context.newPage();
  const responses = [];
  const opened = Date.now();
  page.on('response', r => {
    const url = new URL(r.url());
    if (url.pathname.startsWith('/api/')) {
      responses.push({ path: url.pathname, status: r.status(), at: Date.now() - opened });
    }
  });

  // A generous navigation timeout: `next dev` compiles a route on first hit,
  // and on a cold CI runner that is comfortably longer than Playwright's
  // thirty-second default. The routes are warmed before any of this runs, so
  // reaching this timeout means something is actually wrong.
  await page.goto(`${FRONT}${path}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForTimeout(SETTLE_MS);
  return { context, page, responses };
}

/**
 * The five assertions, over one route, for whoever `session` belongs to.
 *
 * Shared by the platform sweep and the publisher sweep on purpose: "the page
 * rendered, the URL did not move, no prompt, nothing refused" is the same claim
 * for both, and a second copy of it would be a second thing to let drift.
 */
async function checkRoute(browser, session, who, route) {
  const { context, page, responses } = await openAsOperator(browser, session, route.path);

  const text = await page.evaluate(() => document.body.innerText);
  const landed = await page.evaluate(() => window.location.pathname);

  // 1. The page rendered. Everything else is vacuous without this.
  if (!text.includes(route.heading)) {
    fail(
      `${who}: the platform-wide view did not render.\n` +
        `  expected the heading ${JSON.stringify(route.heading)}\n` +
        `  saw: ${JSON.stringify(text.slice(0, 400))}`
    );
  }

  // 2. Still on the page they asked for.
  if (landed !== route.path) {
    fail(`${who}: was moved to ${landed} before the page could render.`);
  }

  // 3. No prompt.
  if (text.includes('Choose an agency')) {
    fail(`${who}: was shown the "Choose an agency" prompt on a cross-agency page.`);
  }

  // 4. Nothing refused.
  const refused = responses.filter(r => r.status >= 400);
  if (refused.length > 0) {
    const counted = {};
    for (const r of refused)
      counted[`${r.path} ${r.status}`] = (counted[`${r.path} ${r.status}`] ?? 0) + 1;
    fail(
      `${who}: made ${refused.length} request(s) the server refused. A page must not ask\n` +
        `  for something the caller cannot have -- an agency-scoped endpoint while there\n` +
        `  is no acting tenant, or its own publisher's data while the check that guards\n` +
        `  it cannot see the caller's role:\n` +
        Object.entries(counted)
          .map(([k, n]) => `    ${k} x${n}`)
          .join('\n')
    );
  }

  await context.close();
}

/**
 * Leave one page alone and watch whether it keeps asking.
 *
 * The live strip polled `/api/v1/live/metrics` every five seconds on a bare
 * `setInterval`, and for an operator with no agency every one of those was a
 * 409. Nothing on this page is agency-scoped now, so the honest assertion is
 * that a quiet page stays quiet: a handful of requests over three quarters of a
 * minute is a page that has settled; dozens is a loop.
 */
async function checkPollingSettles(browser, session) {
  const { context, page, responses } = await openAsOperator(browser, session, '/delivery');
  const atSettle = responses.length;

  await page.waitForTimeout(IDLE_MS);
  const since = responses.slice(atSettle);

  const refused = since.filter(r => r.status >= 400);
  if (refused.length > 0) {
    fail(
      `idle on /delivery: kept asking for something the server refuses. ` +
        `${refused.length} refusal(s) in ${IDLE_MS / 1000}s. The whole page load, in order:\n` +
        responses.map(r => `    +${String(r.at).padStart(6)}ms  ${r.path} ${r.status}`).join('\n')
    );
  }

  // /delivery's own platform-wide view polls every 30s by design, so a couple
  // of requests here are correct. Anything approaching a 5s cadence is not.
  const ceiling = Math.ceil(IDLE_MS / 10_000);
  if (since.length > ceiling) {
    const counted = {};
    for (const r of since)
      counted[`${r.path} ${r.status}`] = (counted[`${r.path} ${r.status}`] ?? 0) + 1;
    fail(
      `idle on /delivery: ${since.length} requests in ${IDLE_MS / 1000}s, more than the ${ceiling} a\n` +
        `  settled page should make:\n` +
        Object.entries(counted)
          .map(([k, n]) => `    ${k} x${n}`)
          .join('\n')
    );
  }

  await context.close();
}

/** `PLATFORM_WIDE_LANDING_ROUTES` as `src/lib/platform-routes.ts` declares it. */
function declaredLandingRoutes() {
  const source = readFileSync(resolve(WEB_DIR, 'src/lib/platform-routes.ts'), 'utf8');
  const block = /PLATFORM_WIDE_LANDING_ROUTES\s*=\s*\[([^\]]*)\]/.exec(source);
  if (!block)
    throw new Error('PLATFORM_WIDE_LANDING_ROUTES not found in src/lib/platform-routes.ts');
  return [...block[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
}

// ─── Run ─────────────────────────────────────────────────────────────────────

async function main() {
  const services = nominatedServices();
  if (!services.ok) {
    if (process.env.CI) {
      console.error(
        `platform landing smoke test cannot run: ${services.why}.\n` +
          'It is refusing rather than skipping, because a smoke test that skips inside a\n' +
          'blocking job is a green tick that means nothing -- which is how three\n' +
          'consecutive phases shipped a broken page.'
      );
      process.exit(1);
    }
    console.log(`SKIPPED: ${services.why}. See the header of this file for how to run it.`);
    return;
  }

  /*
   * The route list here and the one the layout decides from must be the same
   * list. Read out of the TypeScript source rather than imported, because Node
   * cannot import a .ts module and a swallowed import error would turn this
   * guard into a no-op that always agrees.
   */
  const declared = declaredLandingRoutes();
  if (
    declared.sort().join() !==
    ROUTES.map(r => r.path)
      .sort()
      .join()
  ) {
    throw new Error(
      `PLATFORM_WIDE_LANDING_ROUTES is ${JSON.stringify(declared)} but this file checks ` +
        `${JSON.stringify(ROUTES.map(r => r.path))}. Add the new route here with the heading that proves it rendered.`
    );
  }

  const api = run('node', [resolve(REPO, 'node_modules/tsx/dist/cli.mjs'), 'src/index.ts'], {
    cwd: API_DIR,
    detached: true,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(API_PORT),
      DATABASE_URL: services.database,
      REDIS_URL: services.redis,
      JWT_SECRET: process.env.JWT_SECRET ?? 'platform-smoke-secret-platform-smoke-secret',
      // The fronter bot's socket defaults to 8021, which is also FreeSWITCH's
      // ESL port. Moved out of the way so this can run beside a real one.
      FRONTER_SOCKET_PORT: String(API_PORT + 1000),
    },
  });

  const web = run(
    'node',
    [resolve(REPO, 'node_modules/next/dist/bin/next'), 'dev', '-p', String(WEB_PORT)],
    {
      cwd: WEB_DIR,
      detached: true,
      // `next dev`, not a production build: `next build` in this repository fails
      // on an unrelated route handler and its CI step is advisory. The client
      // decisions under test -- the layout's redirect, the prompt, which requests
      // fire -- are the same code either way.
      env: { ...process.env, NEXT_PUBLIC_API_URL: `http://127.0.0.1:${API_PORT}` },
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

  /*
   * Compile each route before anything is measured.
   *
   * `next dev` builds a route the first time it is asked for, which on a cold
   * runner takes longer than a page load has any business taking. Doing it here
   * keeps that cost out of the navigation the assertions depend on, and out of
   * the idle window that counts requests. The response is not checked -- these
   * are unauthenticated hits whose only job is to make the compiler run.
   */
  for (const route of [...ROUTES, ...PUBLISHER_ROUTES]) {
    await fetch(`${FRONT}${route.path}`, { redirect: 'manual' }).catch(() => null);
  }

  const browser = await chromium.launch({
    executablePath: process.env.SMOKE_CHROMIUM || undefined,
  });

  for (const roles of ROLE_SETS) {
    await seed(services, roles);
    const session = await signIn();
    for (const route of ROUTES) {
      await checkRoute(browser, session, `${roles.join('+')} on ${route.path}`, route);
    }
  }

  // The publisher portal, as a publisher. Nothing here is cross-agency: the
  // account has one agency and one publisher, and the only question is whether
  // it is allowed to see its own.
  await seedPublisher(services);
  const publisherSession = await signIn(PUBLISHER);
  for (const route of PUBLISHER_ROUTES) {
    await checkRoute(browser, publisherSession, `PUBLISHER on ${route.path}`, route);
  }

  await seed(services, ['ADMIN']);
  await checkPollingSettles(browser, await signIn());

  await browser.close();

  if (failures.length > 0) {
    console.error(`\n${failures.length} failure(s):\n\n${failures.join('\n\n')}\n`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `platform landing smoke test passed: ${ROLE_SETS.length} role set(s) x ${ROUTES.length} route(s), ` +
      `plus the ${PUBLISHER_ROUTES.length} publisher portal page(s) as a publisher -- ` +
      'no prompt, nothing refused, polling settles.'
  );
}

main()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(shutdown);
