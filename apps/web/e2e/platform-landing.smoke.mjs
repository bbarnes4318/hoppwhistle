/**
 * Load every significant page in a real browser, under every role, and look.
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
 *   6. THE LIVE STRIP IS THERE, AND IT AGREES WITH THE PAGE. The strip renders
 *      above every page in the application, so a defect in it is a defect on
 *      every screen at once. Every load asserts it rendered with figures on
 *      it; the delivery pages additionally assert that each figure the strip
 *      and the page below both carry reads the SAME string for the same
 *      tenant, because two screens disagreeing about what tonight costs is
 *      worse than one screen being wrong; and an agency that is not enrolled
 *      in billing is asserted to be shown no money at all -- not zeroes, and
 *      not em dashes either.
 *
 * Then it signs out and drives the one page that runs before any of that: the
 * login screen, at desktop width and at 360px. It signs in with a keyboard and
 * nothing else, follows an invitation and sets a password, and gets each
 * refusal a person actually meets -- a wrong password, a suspended account, an
 * expired invitation, one already used -- asserting each arrives as a sentence
 * on a panel that is still legible. See "The front door" below for what that
 * blind spot had already cost.
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
import { randomBytes } from 'node:crypto';
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
 * ── The rest of the product, under every role ────────────────────────────────
 *
 * The three routes above are the platform admin's landing pages. Everything
 * below is the rest of the application, loaded as the people who actually use
 * it: an agency principal, an agent, a publisher and a buyer — each a member of
 * one agency and none of them NetEnroll staff — plus the platform admin inside
 * an agency. For each route the assertions are the same four: it rendered, the
 * URL did not move, no prompt appeared where it should not, and nothing was
 * refused. And, since the rebrand made the whole application light for the
 * first time, a fifth: the page is legible on a light ground. Every visible
 * run of text clears 3:1 against what it sits on, every visible border can be
 * told from the surface it sits on, and the document itself is light.
 *
 * Which routes: the ones in the navigation for that role, plus the detail and
 * sub-pages a person lands on daily. Not every route in the tree — a page
 * behind an external SSO iframe or a feature area the brief excludes is not
 * here, and adding one is a one-line change.
 */
const SWEEP = [
  {
    who: 'agency principal (ADMIN, inside one agency)',
    roles: ['ADMIN'],
    platform: false,
    // The reading the strip above every one of these pages must be.
    strip: 'agency',
    routes: [
      '/dashboard',
      '/call-center',
      '/calls',
      '/insurance-leads',
      '/insurance-leads/reports',
      '/campaigns',
      '/publishers',
      '/buyers',
      '/numbers',
      '/rating',
      '/delivery',
      '/delivery/settlements',
      '/billing',
      '/reports',
      '/flows',
      '/voice-studio',
      '/settings',
      '/settings/users',
      '/settings/webhooks',
      '/settings/dnc',
      '/settings/carriers',
      '/settings/quotas',
      '/admin/payroll',
      '/tools/recording-analyzer',
      '/tools/campaign-map',
    ],
  },
  {
    who: 'agent (AGENT, inside one agency)',
    roles: ['AGENT'],
    platform: false,
    // Their own day. No money, no rate, and no other agent.
    strip: 'agent',
    routes: [
      '/dashboard',
      '/call-center',
      '/calls',
      '/insurance-leads',
      '/delivery/me',
      '/payroll',
      '/settings',
    ],
  },
  {
    who: 'publisher (PUBLISHER, inside one agency)',
    roles: ['PUBLISHER'],
    platform: false,
    // Unchanged by the agency work: still GET /api/v1/live/metrics.
    strip: 'publisher',
    routes: [
      '/publisher/dashboard',
      '/publisher/calls',
      '/publisher/earnings',
      '/publisher/payouts',
      '/publisher/api-setup',
      '/publisher/docs',
      '/publisher/tester',
    ],
  },
  {
    who: 'buyer (BUYER, inside one agency)',
    roles: ['BUYER'],
    platform: false,
    strip: 'buyer',
    routes: [
      '/buyer/dashboard',
      '/buyer/calls',
      '/buyer/spend',
      '/buyer/targeting',
      '/buyer/billing',
      '/buyer/disputes',
    ],
  },
  {
    who: 'platform admin, no agency entered',
    roles: ['ADMIN'],
    platform: true,
    // Every agency at once, and no agency-scoped request behind it.
    strip: 'platform',
    routes: [
      '/admin/agencies',
      '/admin/onboarding',
      '/settings',
      '/settings/users',
      '/settings/quotas',
    ],
  },
  {
    who: 'platform admin, inside one agency',
    roles: ['ADMIN'],
    platform: true,
    actingTenant: true,
    // Inside an agency, staff carry that agency's administrator roles and get
    // that agency's reading -- the same one its own principal sees.
    strip: 'agency',
    routes: [
      '/dashboard',
      '/delivery',
      '/rating',
      '/delivery/settlements',
      '/calls',
      '/admin/agencies',
      // The one page whose controls only exist for this principal: staff
      // inside an agency administer that agency's ceilings, addressed to the
      // tenant they entered rather than to anything in the URL.
      '/settings/quotas',
    ],
  },
];

/**
 * ── The live strip, above every page ─────────────────────────────────────────
 *
 * It replaced four pay-per-call marketplace figures that had no source in an
 * agency portal: three rendered as em dashes and the fourth as $0.00. What is
 * there now answers the three questions an agency principal actually has -- am
 * I on pace, what is today costing me, where is my rate going -- with an agent
 * and a NetEnroll-staff reading beside it.
 *
 * Because it renders on EVERY page, a defect in it is a defect on every screen
 * at once, which is why it is asserted on every load of the sweep rather than
 * on one page of its own.
 *
 * The strip and the pages below it mark their figures with `data-figure-value`
 * (and `data-figure` / `data-figure-label` to say which figure), so this
 * compares the strings that were actually rendered rather than re-deriving
 * either number.
 */
const STRIP_SELECTOR = '[data-testid="live-strip"]';

/**
 * The one page with no strip, and it is not an oversight.
 *
 * `/call-center` returns from the dashboard layout before the chrome is built:
 * no sidebar, no topbar, a locked `h-screen w-screen overflow-hidden` viewport
 * and an integrated dialer. It has never carried the strip, in this shape or
 * the marketplace one it replaced, and putting a row above a deliberately
 * chrome-free screen an agent works a shift inside is a change to that page
 * rather than to the strip.
 *
 * Asserted ABSENT rather than skipped, so this stays a decision somebody made
 * instead of a hole in the sweep: adding the strip there means changing this
 * list on purpose.
 */
const NO_STRIP_ROUTES = ['/call-center'];

/**
 * Which strip figure is the same fact as which figure on the page below.
 *
 * A strip figure is compared against whichever of the listed labels the page
 * actually rendered; /delivery has three readings (an enrolled agency, an
 * agency that is not in the billing system, and NetEnroll staff across every
 * agency) and they do not all name a figure the same way.
 *
 * Absent from this map, deliberately: the projected charge and the current
 * rate on the agency's /delivery, and the agent's own closing percentage on
 * /delivery/me. Those are the pages' HERO figures and the strip drops them
 * there rather than repeating them -- which `MUST_NOT_APPEAR` below asserts.
 */
const STRIP_MATCHES_PAGE = {
  '/delivery': {
    applications: ['Applications', 'Applications today'],
    calls: ['Calls answered', 'Calls today'],
    block: ['Remaining on the block'],
    tracking: ['Tomorrow is tracking toward'],
  },
  '/delivery/me': {
    calls: ['Calls taken'],
    applications: ['Applications'],
  },
};

/**
 * Strip figures that must NOT be on the strip on a given page, by reading.
 *
 * These are the pages' HERO figures: the largest element on the screen. The
 * strip drops them there rather than repeating them.
 *
 * Keyed by reading and path, not by path alone, and that distinction is load
 * bearing. /delivery is two pages. The agency's own panel leads on the
 * projected charge at tonight's settlement and on the current rate, so the
 * strip drops both. The cross-agency page leads on "Settled today", which the
 * strip never carries — and the platform reading has a figure of its own
 * called `tonight`, a projection across every agency, which is exactly what
 * staff came to that page for.
 */
const MUST_NOT_APPEAR = {
  'agency:/delivery': ['tonight', 'rate'],
  'agent:/delivery/me': ['closing'],
};

/**
 * Labels and values that mean money.
 *
 * An agency that a platform admin has not enrolled in billing is not gated,
 * not metered and not settled. It must be shown the operational counts and
 * nothing else -- not a zero, and not an em dash either, because an em dash
 * under a label reading "tonight" still tells somebody they owe an unknown
 * amount.
 */
const BILLING_LABEL = /tonight|overrun|block|rate|debit|settlement|charge/i;

/** The strip as it was actually rendered: one entry per figure, in order. */
async function readStrip(page) {
  return page.evaluate(selector => {
    const strip = document.querySelector(selector);
    if (!strip) return null;
    return {
      scope: strip.dataset.scope ?? null,
      figures: Array.from(strip.querySelectorAll('[data-figure]')).map(el => ({
        id: el.dataset.figure,
        value: el.dataset.figureValue ?? '',
        // The label and the caveat as a person reads them, so an assertion can
        // be about what is on screen rather than about an attribute.
        text: el.innerText.replace(/\s+/g, ' ').trim(),
      })),
    };
  }, STRIP_SELECTOR);
}

/** The page's own figures, by label. */
async function readPageFigures(page) {
  return page.evaluate(() => {
    const out = {};
    for (const el of document.querySelectorAll('[data-figure-label]')) {
      const label = el.dataset.figureLabel;
      if (label && el.dataset.figureValue !== undefined) out[label] = el.dataset.figureValue;
    }
    return out;
  });
}

/**
 * Everything the strip has to satisfy on one page load.
 *
 * `waitForSelector` rather than trusting the settle: the strip appears when
 * its first poll answers, and a page that compiled slowly would otherwise
 * report a missing strip that is merely late.
 */
async function checkStrip(page, who, path, expectedScope = null, report = fail) {
  if (NO_STRIP_ROUTES.includes(path)) {
    if (await page.$(STRIP_SELECTOR)) {
      report(
        `${who}: the live strip rendered on a page that deliberately has no chrome. If that is ` +
          'intended, take the route out of NO_STRIP_ROUTES and say why the locked viewport can ' +
          'afford the row.'
      );
    }
    return null;
  }

  try {
    await page.waitForSelector(STRIP_SELECTOR, { timeout: 20_000 });
  } catch {
    report(
      `${who}: the live strip never rendered. It is supposed to be above every page in the ` +
        'application, and it is the first thing a principal, an agent or a NetEnroll operator ' +
        'looks at.'
    );
    return null;
  }

  const strip = await readStrip(page);
  const figures = strip?.figures ?? [];
  if (figures.length === 0) {
    report(`${who}: the live strip rendered with no figures on it, which is an empty band.`);
    return strip;
  }

  /*
   * The right reading for the person signed in.
   *
   * Asserted rather than inferred from the labels, because the whole point of
   * the strip is that a principal, an agent and NetEnroll staff are shown
   * different things — an agent must never be handed the agency's money, and
   * staff with no agency entered must never be handed one agency's.
   */
  if (expectedScope !== null && strip.scope !== expectedScope) {
    report(
      `${who}: the strip is the "${strip.scope}" reading; this session should get ` +
        `"${expectedScope}".`
    );
  }

  // Every figure says what it is. A bare number with no label is unreadable.
  for (const figure of figures) {
    if (!figure.text || figure.text.length === 0) {
      report(`${who}: the strip figure "${figure.id}" rendered with no text in it.`);
    }
    if (figure.value && !figure.text.includes(figure.value)) {
      report(
        `${who}: the strip figure "${figure.id}" carries ${JSON.stringify(figure.value)} but ` +
          `renders ${JSON.stringify(figure.text)}. The attribute the assertions read and the ` +
          'text a person reads have come apart.'
      );
    }
  }

  // It must not have grown back into a band of cards. One dense row.
  const height = await page.evaluate(
    selector => Math.round(document.querySelector(selector)?.getBoundingClientRect().height ?? 0),
    STRIP_SELECTOR
  );
  if (height > 64) {
    report(
      `${who}: the strip is ${height}px tall. It renders on every page in the application; at ` +
        'that height it is a band of cards again rather than one dense row.'
    );
  }

  const banned = MUST_NOT_APPEAR[`${strip.scope}:${path}`] ?? [];
  for (const id of banned) {
    if (figures.some(f => f.id === id)) {
      report(
        `${who}: the strip repeats "${id}", which this page already renders as its largest ` +
          'element. A figure the page below shows as its hero is not repeated in the strip on ' +
          'that page.'
      );
    }
  }

  // The strip and the page below, on the same figures, for the same tenant.
  const pairs = STRIP_MATCHES_PAGE[path];
  if (pairs) {
    const pageFigures = await readPageFigures(page);
    for (const [id, labels] of Object.entries(pairs)) {
      const figure = figures.find(f => f.id === id);
      if (!figure) continue;
      const label = labels.find(candidate => candidate in pageFigures);
      if (!label) continue;
      if (pageFigures[label] !== figure.value) {
        report(
          `${who}: the strip says ${JSON.stringify(figure.value)} for "${id}" and the page ` +
            `below says ${JSON.stringify(pageFigures[label])} for "${label}". Two screens ` +
            'disagreeing about the same tenant on the same day is worse than one being wrong.'
        );
      }
    }
  }

  return strip;
}

/**
 * The one dark screen. There is no live board page yet, so the mechanism is
 * checked where it is exercised: the design preview renders the same markup
 * under both themes, and the dark pane must come out dark while the document
 * around it stays light.
 */
const DARK_SCOPE_ROUTE = '/design-preview';

/**
 * ── The front door ───────────────────────────────────────────────────────────
 *
 * /login is the one page that runs before there is a session, and since
 * agents.netenroll.com redirects its root here (infra/nginx/agents.netenroll.com)
 * it is the first thing an agency ever sees. The sweep above cannot reach it:
 * every session there is signed in before the page loads, so the whole
 * signed-out surface -- and every way it can refuse someone -- was the one part
 * of the product this file rendered for nobody.
 *
 * That blind spot had already cost something. Signing in stored a token and
 * pushed to /dashboard, whose layout read the session provider's `user` -- still
 * null, because the provider asks `/api/auth/me` once when it mounts and it
 * mounted before the token existed -- and replaced the route straight back to
 * /login. Correct credentials, and the sign-in page again. Nothing here saw it,
 * because `openAsOperator` writes the token BEFORE the first page load, which
 * is the one state a person signing in is never in.
 *
 * So these checks drive the page the way a person does, at a desk and on a
 * phone: sign in and arrive somewhere, get a password wrong and be told,
 * follow an invitation and set a password, follow a spent one and be told. The
 * same legibility audit the rest of the product is held to runs on each,
 * including the error states -- a redesign that turns a clear refusal into a
 * blank panel is exactly the failure this file exists to catch.
 */
const LOGIN_ROUTE = '/login';

/** A desk and a phone. Agents check things on phones. */
const LOGIN_VIEWPORTS = [
  { label: 'desktop', width: 1280, height: 900 },
  { label: '360px', width: 360, height: 780 },
];

/** The login page settles in one render; it polls nothing and fetches nothing. */
const LOGIN_SETTLE_MS = Number(process.env.SMOKE_LOGIN_SETTLE_MS ?? 2500);

/**
 * The Google client id the page must carry with no environment variable set.
 *
 * Kept as a literal rather than read from the source, so that deleting the
 * default and reintroducing NEXT_PUBLIC_GOOGLE_CLIENT_ID as a requirement
 * fails here as well as in
 * apps/web/src/app/login/__tests__/google-client-id.test.ts. Production does
 * not set that variable; when it was the only source, a rebuild inlined an
 * empty string and the buttons silently stopped existing.
 */
const GOOGLE_CLIENT_ID = '196207148120-2navmspp2renu5cnvr06679jvhm5h12h.apps.googleusercontent.com';

const GSI_SCRIPT = 'https://accounts.google.com/gsi/client';

/**
 * accounts.google.com, stood in for.
 *
 * The real script cannot be part of an assertion: a CI runner may not reach
 * Google, and a credential minted by Google cannot be forged here anyway --
 * the API verifies every one against its own client id. What IS ours to assert
 * is the arrangement around it: that the page initialises the client with the
 * id it ships with rather than one an environment supplies, and that it hands
 * Google a slot the button fits inside at 360px. This stub records both.
 */
const GSI_STUB = `
  window.__gsi = { initialize: [], renderButton: [] };
  window.google = { accounts: { id: {
    initialize: config => window.__gsi.initialize.push(config),
    renderButton: (el, config) => {
      window.__gsi.renderButton.push({ id: el.id, width: config.width, text: config.text });
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Sign in with Google';
      button.style.cssText =
        'width:' + config.width + 'px;height:40px;border:1px solid #747775;' +
        'background:#fff;color:#1f1f1f;border-radius:4px;font:500 14px system-ui';
      el.appendChild(button);
    },
  } } };
`;

/**
 * What must not be on this page.
 *
 * A "forgot password" link is a promise to a route that does not exist, and a
 * refusal a person cannot act on is worse than no control at all.
 *
 * ── Why "create account" is no longer on this list ───────────────────────────
 *
 * It was, on the reasoning that `POST /api/auth/register` refuses without an
 * activation grant, so a create-account control was a door onto a corridor
 * with no rooms. That was wrong about who uses it. The grant is real and it is
 * held by the person, not by the link: an invitation code read out over the
 * phone, forwarded as text, or opened in a different browser leaves an invited
 * agent holding a working grant and, with no second tab, nowhere on the site
 * to spend it. The corridor has rooms; the door was missing.
 *
 * The refusal still stands where it belongs -- server-side, on a request with
 * no grant -- and `checkLoginTabs` below pins the door open.
 */
const ABSENT_FROM_LOGIN = [/forgot (your )?password/i, /reset (your )?password/i];

/**
 * What must be on it.
 *
 * Both halves of the front door, as tabs a person can see and click. This has
 * gone missing twice: once the Google button on the second panel, once the
 * whole panel with a redesign.
 */
const LOGIN_TABS = ['Sign in', 'Create account'];

/**
 * Refusals this sweep knows about, and will not fail on.
 *
 * ── Read this before adding to it ────────────────────────────────────────────
 *
 * One entry, a defect this sweep FOUND on its first run and older than the work
 * that added the sweep. It is listed here rather than quietly tolerated so that
 * the list is the record: anything not on it still fails, and it fails again
 * the moment its path or status changes.
 *
 * An entry is not permission to leave something broken. Fix the cause and
 * delete the entry. Do not add one without the same standard of evidence: the
 * exact path and status, and a diagnosis of the cause rather than a note that
 * it came out red.
 *
 * There were four. Three have left, every one by being fixed rather than
 * tolerated, which is what an entry leaving this list is supposed to look like:
 *
 *   - The lead-injection stream. `EventSource` cannot send an Authorization
 *     header, so that read-only GET now authenticates from the session cookie
 *     the app already maintains. See
 *     apps/api/src/middleware/session-cookie-auth.ts.
 *   - /settings/quotas, which asked three admin endpoints about tenant
 *     00000000-0000-0000-0000-000000000000 — a placeholder the page carried
 *     because it had no id and made one up. It reads
 *     `GET /api/v1/quota/summary` now, which names no tenant at all: the
 *     server answers for whoever is asking. The route is swept under all three
 *     principals below, agency and staff, with and without an agency entered.
 *   - The publisher portal, which answered 403 to every publisher on their own
 *     dashboard, earnings, keys and docs. `requirePublisherAccess` read roles
 *     and a publisher id off a token that carries neither, so it denied
 *     everyone. Roles and the publisher link are now resolved from the database
 *     on each authenticated request, in one place rather than at the dozen call
 *     sites. See apps/api/src/lib/principal.ts. The publisher principal below
 *     sweeps all seven of those pages with nothing allowed to be refused.
 *
 * The count above is part of the record. It once said "two" while the list held
 * four, because entries were appended without touching the sentence that
 * counted them — so if you change the list, change the number with it.
 */
const KNOWN_REFUSALS = [
  {
    path: '/api/v1/reports/profitability',
    status: 404,
    where: '/reports',
    why:
      'The campaign-profitability tab asks for an endpoint apps/api does not ' +
      'implement. The tab has never worked; building the report is a feature, ' +
      'not a repaint.',
  },
];

function isKnownRefusal(response, path) {
  return KNOWN_REFUSALS.some(known => {
    if (known.status !== response.status) return false;
    if (known.where !== null && known.where !== path) return false;
    return known.path instanceof RegExp
      ? known.path.test(response.path)
      : known.path === response.path;
  });
}

/** Settle time for the sweep. Shorter than the landing check; there are ~50 loads. */
const SWEEP_SETTLE_MS = Number(process.env.SMOKE_SWEEP_SETTLE_MS ?? 5000);

/**
 * `SMOKE_ONLY=agency principal` (a substring of `who`) narrows the sweep while
 * a page is being fixed. Never set in CI.
 */
const ONLY = process.env.SMOKE_ONLY ?? '';

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
const platform = process.env.SMOKE_PLATFORM !== '0';
const actingTenant = process.env.SMOKE_ACTING_TENANT === '1';

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

if (platform) {
  await prisma.platformAdmin.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id, grantedBy: user.id, note: 'platform landing smoke test' },
  });
} else {
  // An agency user: a member of one agency and not NetEnroll staff.
  await prisma.platformAdmin.deleteMany({ where: { userId: user.id } });
}

// Staff inside no agency is the landing state under test; staff inside an
// agency is the sweep's other reading of the same pages.
await prisma.platformActingTenant.deleteMany({ where: { userId: user.id } });
if (platform && actingTenant) {
  await prisma.platformActingTenant.create({ data: { userId: user.id, tenantId: tenant.id } });
}

/*
 * A publisher or buyer user is attached to a publisher or buyer record; the
 * portals read me.publisherId / me.buyerId and render their "nothing
 * attached" states otherwise, which is a different page from the one a real
 * publisher sees.
 */
const publisher = roles.includes('PUBLISHER')
  ? await prisma.publisher.upsert({
      where: { email: 'platform-smoke-publisher@netenroll.invalid' },
      update: {},
      create: {
        tenantId: tenant.id,
        name: 'Smoke Publisher',
        code: 'smoke-publisher-code-000000000000',
        email: 'platform-smoke-publisher@netenroll.invalid',
        status: 'ACTIVE',
      },
    })
  : null;
let buyer = null;
if (roles.includes('BUYER')) {
  buyer =
    (await prisma.buyer.findFirst({ where: { tenantId: tenant.id, code: 'smoke-buyer' } })) ??
    (await prisma.buyer.create({
      data: { tenantId: tenant.id, name: 'Smoke Buyer', code: 'smoke-buyer', status: 'ACTIVE' },
    }));
}
await prisma.user.update({
  where: { id: user.id },
  data: { publisherId: publisher?.id ?? null, buyerId: buyer?.id ?? null },
});

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

/*
 * Ceilings and a budget for the agency, so /settings/quotas is swept with
 * figures on it rather than only in its empty state.
 *
 * Without these rows the page renders "Unlimited" everywhere and a load proves
 * only that the empty path does not throw -- which is exactly the half that was
 * never broken. The spend figures are Decimal columns, and a Decimal read as a
 * string and formatted as a fixed-point number is how a money tile becomes
 * "NaN"; that only shows up when there is a number to render.
 *
 * Generous enough not to change any other page under test: nothing in the
 * sweep places a call, and the hard stop is off.
 */
await prisma.tenantQuota.upsert({
  where: { tenantId: tenant.id },
  update: {},
  create: {
    tenantId: tenant.id,
    maxConcurrentCalls: 25,
    maxMinutesPerDay: 1200,
    maxPhoneNumbers: 40,
    maxRecordingRetentionDays: 90,
    maxStorageGB: 50,
    enabled: true,
  },
});

await prisma.tenantBudget.upsert({
  where: { tenantId: tenant.id },
  update: {},
  create: {
    tenantId: tenant.id,
    monthlyBudget: 5000,
    dailyBudget: 250,
    currentMonthSpend: 1234.56,
    currentDaySpend: 78.9,
    alertThreshold: 80,
    alertEmails: ['finance@platform-smoke.invalid'],
    hardStopEnabled: false,
    enabled: true,
  },
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

async function seed(services, roles, options = {}) {
  await new Promise((ok, fail) => {
    const child = spawn('node', ['--input-type=module', '--eval', SEED], {
      cwd: API_DIR,
      stdio: ['ignore', 'inherit', 'inherit'],
      env: {
        ...process.env,
        DATABASE_URL: services.database,
        SMOKE_EMAIL: OPERATOR.email,
        SMOKE_PASSWORD: OPERATOR.password,
        SMOKE_ROLES: roles.join(','),
        SMOKE_PLATFORM: options.platform === false ? '0' : '1',
        SMOKE_ACTING_TENANT: options.actingTenant ? '1' : '0',
      },
    });
    child.on('exit', code => (code === 0 ? ok() : fail(new Error(`seed exited ${code}`))));
  });
}

async function signIn() {
  const res = await fetch(`${FRONT}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(OPERATOR),
  });
  const body = await res.json();
  if (!body?.token) throw new Error(`sign-in failed: ${res.status} ${JSON.stringify(body)}`);
  return body;
}

/** The addresses the fixture writes, and the password all of them share. */
const LOGIN_FIXTURE = {
  password: 'front-Door1!',
  activeEmail: 'login-agent@netenroll.invalid',
  suspendedEmail: 'login-suspended@netenroll.invalid',
  expiredEmail: 'login-expired@netenroll.invalid',
  redeemedEmail: 'login-redeemed@netenroll.invalid',
};

/**
 * The people the front door is checked against, and the links they arrive with.
 *
 * An agency of its own, so nothing here disturbs the sessions the sweep seeds:
 * one agent who can sign in, one whose account has been suspended, and three
 * activation grants -- one usable, one expired, one already redeemed. The
 * grants are written the way the service writes them, as a sha256 of the token
 * (see apps/api/src/services/tenant-activation.ts), because the plaintext is
 * returned once and never stored; a test that could read one back out of the
 * database would be testing a system this is not.
 */
const LOGIN_SEED = `
import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const hashToken = token => createHash('sha256').update(token).digest('hex');

const tenant = await prisma.tenant.upsert({
  where: { slug: 'login-smoke' },
  update: {},
  create: { name: 'Ridgeline Insurance', slug: 'login-smoke', status: 'ACTIVE' },
});

const role = await prisma.role.upsert({
  where: { name: 'AGENT' },
  update: {},
  create: { name: 'AGENT', permissions: [] },
});

const passwordHash = await bcrypt.hash(process.env.LOGIN_PASSWORD, 10);

const agent = await prisma.user.upsert({
  where: { email: process.env.LOGIN_ACTIVE_EMAIL },
  update: { passwordHash, status: 'ACTIVE', tenantId: tenant.id },
  create: {
    email: process.env.LOGIN_ACTIVE_EMAIL,
    passwordHash,
    firstName: 'Ada',
    lastName: 'Agent',
    status: 'ACTIVE',
    tenantId: tenant.id,
  },
});
await prisma.userRole.deleteMany({ where: { userId: agent.id } });
await prisma.userRole.create({ data: { userId: agent.id, roleId: role.id } });

// A suspended account: the credentials are right and the answer is still no.
await prisma.user.upsert({
  where: { email: process.env.LOGIN_SUSPENDED_EMAIL },
  update: { passwordHash, status: 'SUSPENDED', tenantId: tenant.id },
  create: {
    email: process.env.LOGIN_SUSPENDED_EMAIL,
    passwordHash,
    firstName: 'Sam',
    lastName: 'Suspended',
    status: 'SUSPENDED',
    tenantId: tenant.id,
  },
});

/*
 * The usable grant creates a real account when it is redeemed, so its invitee
 * is unique per run and the accounts previous runs made are cleared out first.
 * Grants before roles before users: redeemedByUserId and userRoles both point
 * at the row being removed.
 */
const previous = await prisma.user.findMany({
  where: { email: { startsWith: 'login-invitee-' } },
  select: { id: true },
});
const previousIds = previous.map(u => u.id);
await prisma.tenantActivationGrant.deleteMany({
  where: {
    OR: [
      { email: { startsWith: 'login-invitee-' } },
      { redeemedByUserId: { in: previousIds } },
    ],
  },
});
await prisma.userRole.deleteMany({ where: { userId: { in: previousIds } } });
await prisma.user.deleteMany({ where: { id: { in: previousIds } } });

// The two spent grants are keyed on a fixed address, so a re-run would stack
// another row against it rather than replace one.
await prisma.tenantActivationGrant.deleteMany({
  where: { email: { in: [process.env.LOGIN_EXPIRED_EMAIL, process.env.LOGIN_REDEEMED_EMAIL] } },
});

const grant = async (email, token, overrides) =>
  prisma.tenantActivationGrant.create({
    data: {
      tenantId: tenant.id,
      tokenHash: hashToken(token),
      email,
      roleName: 'AGENT',
      source: 'ADMIN_INVITE',
      expiresAt: new Date(Date.now() + 3600_000),
      ...overrides,
    },
  });

const invitee = \`login-invitee-\${Date.now()}@netenroll.invalid\`;
await grant(invitee, process.env.LOGIN_GRANT_USABLE, {});
await grant(process.env.LOGIN_EXPIRED_EMAIL, process.env.LOGIN_GRANT_EXPIRED, {
  expiresAt: new Date(Date.now() - 3600_000),
});
await grant(process.env.LOGIN_REDEEMED_EMAIL, process.env.LOGIN_GRANT_REDEEMED, {
  redeemedAt: new Date(),
});

process.stdout.write(JSON.stringify({ invitee }));
await prisma.$disconnect();
`;

/** The fixture, and the tokens the browser will arrive holding. */
async function seedLogin(services) {
  const tokens = {
    usable: randomBytes(32).toString('base64url'),
    expired: randomBytes(32).toString('base64url'),
    redeemed: randomBytes(32).toString('base64url'),
  };

  const invitee = await new Promise((ok, stop) => {
    const child = spawn('node', ['--input-type=module', '--eval', LOGIN_SEED], {
      cwd: API_DIR,
      stdio: ['ignore', 'pipe', 'inherit'],
      env: {
        ...process.env,
        DATABASE_URL: services.database,
        LOGIN_PASSWORD: LOGIN_FIXTURE.password,
        LOGIN_ACTIVE_EMAIL: LOGIN_FIXTURE.activeEmail,
        LOGIN_SUSPENDED_EMAIL: LOGIN_FIXTURE.suspendedEmail,
        LOGIN_EXPIRED_EMAIL: LOGIN_FIXTURE.expiredEmail,
        LOGIN_REDEEMED_EMAIL: LOGIN_FIXTURE.redeemedEmail,
        LOGIN_GRANT_USABLE: tokens.usable,
        LOGIN_GRANT_EXPIRED: tokens.expired,
        LOGIN_GRANT_REDEEMED: tokens.redeemed,
      },
    });
    let out = '';
    child.stdout.on('data', d => (out += String(d)));
    child.on('exit', code =>
      code === 0 ? ok(JSON.parse(out).invitee) : stop(new Error(`login seed exited ${code}`))
    );
  });

  return { ...LOGIN_FIXTURE, invitee, tokens };
}

// ─── The assertions ──────────────────────────────────────────────────────────

const failures = [];
const fail = message => failures.push(message);

async function openAsOperator(browser, session, path, settleMs = SETTLE_MS) {
  const context = await browser.newContext();
  await context.addInitScript(
    ([token, user]) => {
      localStorage.setItem('token', token);
      localStorage.setItem('user', user);
    },
    [session.token, JSON.stringify(session.user)]
  );
  /*
   * The same token as a cookie, because the server render reads that one.
   *
   * The buyer and publisher shells are server components: they gate on
   * `hw_session` (see src/lib/session-token.ts) before any markup is produced.
   * A browser that has only the localStorage copy is redirected to /login by
   * the server and `SessionCookieSync` never gets to run — which is exactly
   * what this test saw until the cookie was set here. A real browser has both:
   * login writes both, and a session predating the cookie gets one on its
   * first client render. Seeding only one of the two tested a state no user is
   * ever in.
   */
  await context.addCookies([
    {
      name: 'hw_session',
      value: session.token,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
    },
  ]);

  const page = await context.newPage();
  const responses = [];
  const opened = Date.now();
  page.on('response', r => {
    const url = new URL(r.url());
    // Every same-origin response, not only the API: a 404 for a logo the
    // rebrand renamed is exactly the kind of thing a page load catches.
    if (url.origin === FRONT) {
      responses.push({
        path: url.pathname,
        status: r.status(),
        at: Date.now() - opened,
        api: url.pathname.startsWith('/api/'),
      });
    }
  });

  // A generous navigation timeout: `next dev` compiles a route on first hit,
  // and on a cold CI runner that is comfortably longer than Playwright's
  // thirty-second default. The routes are warmed before any of this runs, so
  // reaching this timeout means something is actually wrong.
  await page.goto(`${FRONT}${path}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForTimeout(settleMs);
  return { context, page, responses };
}

// ─── Legibility on a light ground ────────────────────────────────────────────

/**
 * Runs inside the page. Walks every element with visible text and every
 * element with a visible border, resolves the background each one actually
 * sits on (the nearest painted ancestor, alpha composited), and returns the
 * ones that fail. Also returns what the document and its dark scopes are
 * painted, so the caller can assert light-by-default and dark-by-opt-in.
 *
 * Thresholds: text must clear 3:1 — WCAG's floor for large text, and well
 * below the 4.5:1 the tokens are designed to, so this catches white-on-white
 * and near-white-on-white without arguing about a 12px label at 3.6:1. A
 * border must clear 1.1:1, which is the difference between a hairline that
 * can be seen and one that cannot. Elements at reduced opacity are skipped:
 * that is how disabled controls are drawn, deliberately.
 */
function auditContrastInPage() {
  const parse = value => {
    const m = /^rgba?\(([^)]+)\)$/.exec(value || '');
    if (!m) return null;
    const parts = m[1]
      .split(/[\s,\/]+/)
      .filter(Boolean)
      .map(Number);
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };
  const lin = c => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luminance = c => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const ratio = (a, b) => {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const hex = c =>
    '#' + [c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

  const styleOf = new Map();
  const style = el => {
    let s = styleOf.get(el);
    if (!s) {
      s = getComputedStyle(el);
      styleOf.set(el, s);
    }
    return s;
  };

  // Backdrop: what an element's ancestors paint behind it, composited.
  const backdrop = el => {
    const layers = [];
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      const bg = parse(style(node).backgroundColor);
      if (bg && bg.a > 0) {
        layers.push(bg);
        if (bg.a >= 1) break;
      }
    }
    let out = { r: 255, g: 255, b: 255, a: 1 }; // the viewport's own white
    for (let i = layers.length - 1; i >= 0; i--) out = over(layers[i], out);
    return out;
  };

  const effectiveOpacity = el => {
    let o = 1;
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      o *= Number(style(node).opacity);
      if (o < 0.99) return o;
    }
    return o;
  };

  const visible = el => {
    const s = style(el);
    if (s.display === 'none' || s.visibility !== 'visible') return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    // sr-only and friends
    if (s.clipPath === 'inset(50%)' || (s.position === 'absolute' && r.width <= 1 && r.height <= 1))
      return false;
    return true;
  };

  const describe = el => {
    const parts = [];
    for (
      let node = el, depth = 0;
      node && depth < 4 && node.nodeType === 1;
      node = node.parentElement, depth++
    ) {
      let part = node.tagName.toLowerCase();
      if (node.id) part += `#${node.id}`;
      const cls = (node.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 4);
      if (cls.length) part += `.${cls.join('.')}`;
      parts.unshift(part);
    }
    return parts.join(' > ');
  };

  const text = [];
  const borders = [];
  const seen = new Set();
  const all = document.body.querySelectorAll('*');
  for (const el of all) {
    if (el.closest('[aria-hidden="true"], [data-contrast-exempt], script, style, svg')) continue;
    if (!visible(el)) continue;
    if (effectiveOpacity(el) < 0.99) continue;

    const own = Array.from(el.childNodes)
      .filter(n => n.nodeType === 3)
      .map(n => n.textContent)
      .join('')
      .trim();
    const s = style(el);
    if (own) {
      const fg = parse(s.color);
      const bg = backdrop(el);
      if (fg) {
        const composed = fg.a < 1 ? over(fg, bg) : fg;
        const r = ratio(composed, bg);
        if (r < 3) {
          const key = `${describe(el)}|${s.color}|${hex(bg)}`;
          if (!seen.has(key)) {
            seen.add(key);
            text.push({
              where: describe(el),
              text: own.slice(0, 40),
              color: hex(composed),
              background: hex(bg),
              ratio: Number(r.toFixed(2)),
            });
          }
        }
      }
    }

    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      const width = parseFloat(s[`border${side}Width`]);
      const st = s[`border${side}Style`];
      if (!width || st === 'none' || st === 'hidden') continue;
      const bc = parse(s[`border${side}Color`]);
      if (!bc || bc.a === 0) continue;
      // The border sits on the element's own background if it paints one,
      // otherwise on whatever is behind it.
      const ownBg = parse(s.backgroundColor);
      /*
       * A border the same colour as the fill it edges is deliberate — that is
       * how a filled control is drawn, and the agency switcher's "you are
       * inside one agency" state is exactly one. It is not an invisible
       * divider, which is what this check is looking for.
       */
      if (
        ownBg &&
        ownBg.a > 0 &&
        Math.abs(ownBg.r - bc.r) < 2 &&
        Math.abs(ownBg.g - bc.g) < 2 &&
        Math.abs(ownBg.b - bc.b) < 2
      ) {
        continue;
      }
      const ground =
        ownBg && ownBg.a > 0 ? over(ownBg, backdrop(el.parentElement || el)) : backdrop(el);
      const composed = bc.a < 1 ? over(bc, ground) : bc;
      const r = ratio(composed, ground);
      if (r < 1.1) {
        const key = `${describe(el)}|border|${hex(ground)}`;
        if (!seen.has(key)) {
          seen.add(key);
          borders.push({
            where: describe(el),
            side: side.toLowerCase(),
            color: hex(composed),
            background: hex(ground),
            ratio: Number(r.toFixed(2)),
          });
        }
      }
      break; // one report per element is enough
    }
  }

  const bodyBg = backdrop(document.body);
  const darkScopes = Array.from(document.querySelectorAll('[data-theme="dark"]')).map(el => ({
    where: describe(el),
    background: hex(backdrop(el)),
    luminance: Number(luminance(backdrop(el)).toFixed(3)),
  }));

  return {
    text,
    borders,
    document: {
      htmlClass: document.documentElement.className,
      htmlTheme: document.documentElement.getAttribute('data-theme'),
      bodyBackground: hex(bodyBg),
      bodyLuminance: Number(luminance(bodyBg).toFixed(3)),
    },
    darkScopes,
  };
}

/** Everything a page must satisfy to be legible on the light ground. */
async function checkLegibility(page, who, report = fail) {
  const audit = await page.evaluate(auditContrastInPage);

  // The document is light. Not "the tokens say light" — the pixels.
  if (
    audit.document.htmlClass.split(/\s+/).includes('dark') ||
    audit.document.htmlTheme === 'dark'
  ) {
    report(
      `${who}: the document is dark (html class "${audit.document.htmlClass}", data-theme ${audit.document.htmlTheme}). Light is the default.`
    );
  }
  if (audit.document.bodyLuminance < 0.8) {
    report(
      `${who}: the page ground is ${audit.document.bodyBackground} (luminance ${audit.document.bodyLuminance}), which is not a light page.`
    );
  }

  // A dark scope, where one exists, really is dark.
  for (const scope of audit.darkScopes) {
    if (scope.luminance > 0.2) {
      report(
        `${who}: a [data-theme="dark"] subtree at ${scope.where} is painted ${scope.background}, which is not dark.`
      );
    }
  }

  if (audit.text.length > 0) {
    report(
      `${who}: ${audit.text.length} run(s) of text do not clear 3:1 against their background:\n` +
        audit.text
          .slice(0, 25)
          .map(
            t =>
              `    ${t.ratio}:1  ${t.color} on ${t.background}  ${JSON.stringify(t.text)}\n           at ${t.where}`
          )
          .join('\n') +
        (audit.text.length > 25 ? `\n    … and ${audit.text.length - 25} more` : '')
    );
  }
  if (audit.borders.length > 0) {
    report(
      `${who}: ${audit.borders.length} border(s) cannot be told from the surface they sit on:\n` +
        audit.borders
          .slice(0, 25)
          .map(
            b =>
              `    ${b.ratio}:1  ${b.color} on ${b.background}  (${b.side})\n           at ${b.where}`
          )
          .join('\n') +
        (audit.borders.length > 25 ? `\n    … and ${audit.borders.length - 25} more` : '')
    );
  }
  return audit;
}

async function checkRoute(browser, session, roles, route) {
  const who = `${roles.join('+')} on ${route.path}`;
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
  reportRefusals(
    who,
    responses,
    'An agency-scoped endpoint must not be asked while there is no acting tenant'
  );

  // 5. Legible on a light ground.
  await checkLegibility(page, who);

  /*
   * 6. The strip above the page, and it is the PLATFORM reading.
   *
   * Every session here is NetEnroll staff with no agency entered, whatever
   * other roles they hold. An operator who also holds PUBLISHER getting the
   * publisher reading would mean the strip had asked an agency-scoped endpoint
   * with no agency — the 409-per-page-load loop assertion 4 above exists for.
   */
  await checkStrip(page, who, route.path, 'platform');

  await context.close();
}

function reportRefusals(who, responses, why, route = null, report = fail) {
  const refused = responses.filter(r => r.status >= 400 && !(route && isKnownRefusal(r, route)));
  if (refused.length === 0) return;
  const counted = {};
  for (const r of refused)
    counted[`${r.path} ${r.status}`] = (counted[`${r.path} ${r.status}`] ?? 0) + 1;
  report(
    `${who}: made ${refused.length} request(s) the server refused. ${why}:\n` +
      Object.entries(counted)
        .map(([k, n]) => `    ${k} x${n}`)
        .join('\n')
  );
}

/**
 * One route of the sweep, with one retry reserved for a server-side failure.
 *
 * `next dev` compiles a route the first time it is asked for, and this sweep
 * asks for about sixty of them while the API serves every request each one
 * makes. On a loaded machine that produced a scatter of 5xx which moved
 * between routes from run to run and reproduced on none of them when asked
 * directly — the local dev server under load, not the product.
 *
 * So a load that ends in a 5xx is repeated ONCE, in a fresh browser context,
 * and the second reading is the one reported. A failure that survives that is
 * not a flake. Nothing else gets a retry: a 4xx, a page that did not render
 * and an unreadable colour are all deterministic, and re-running them would
 * only be a way of not believing the answer.
 */
async function sweepRoute(browser, session, entry, path) {
  const first = await sweepRouteOnce(browser, session, entry, path);
  if (!first.serverFailed) {
    for (const message of first.failures) fail(message);
    return;
  }
  const second = await sweepRouteOnce(browser, session, entry, path);
  for (const message of second.failures) {
    fail(second.serverFailed ? `${message}\n  (both of two attempts)` : message);
  }
}

/** One load, collecting its failures rather than committing them. */
async function sweepRouteOnce(browser, session, entry, path) {
  const failures = [];
  const { serverFailed } = await inspectRoute(browser, session, entry, path, m => failures.push(m));
  return { failures, serverFailed };
}

/**
 * The assertions for one load. The page has no heading contract the way the
 * three landing routes do, so "rendered" is read the way a person reads it:
 * the shell is there, the main region has content, nothing is still spinning,
 * and the error boundary did not fire.
 */
async function inspectRoute(browser, session, entry, path, fail) {
  const who = `${entry.who} on ${path}`;
  const { context, page, responses } = await openAsOperator(
    browser,
    session,
    path,
    SWEEP_SETTLE_MS
  );

  const state = await page.evaluate(() => {
    const main = document.querySelector('main') ?? document.body;
    const spinning = Array.from(main.querySelectorAll('.animate-spin')).filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }).length;
    return {
      pathname: window.location.pathname,
      body: document.body.innerText,
      mainText: main.innerText.trim(),
      title: document.title,
      spinning,
    };
  });

  // 1. Rendered.
  if (state.body.includes('could not be displayed') || state.body.includes('Application error')) {
    fail(
      `${who}: the page threw. The error boundary is showing:\n  ${JSON.stringify(state.body.slice(0, 300))}`
    );
  } else if (state.mainText.length === 0) {
    fail(`${who}: the main region is empty after ${SWEEP_SETTLE_MS}ms.`);
  } else if (state.spinning > 0) {
    fail(
      `${who}: still loading after ${SWEEP_SETTLE_MS}ms (${state.spinning} spinner(s) visible).\n  saw: ${JSON.stringify(state.mainText.slice(0, 200))}`
    );
  }

  // 2. Still on the page asked for.
  if (state.pathname !== path) {
    fail(`${who}: was moved to ${state.pathname}.`);
  }

  // 3. No prompt: every session in the sweep either belongs to an agency or
  //    is on a platform-wide page.
  if (state.body.includes('Choose an agency')) {
    fail(`${who}: was shown the "Choose an agency" prompt.`);
  }

  // The tab is named after the page and the product.
  if (!state.title.includes('NetEnroll')) {
    fail(
      `${who}: the tab is titled ${JSON.stringify(state.title)}, which does not name the product.`
    );
  }

  // 4. Nothing refused — API or asset.
  reportRefusals(who, responses, 'Every request a page load makes must succeed', path, fail);

  // 5. Legible.
  await checkLegibility(page, who, fail);

  // 6. The strip above the page: it rendered, it is one row, and where it and
  //    the page carry the same figure they carry the same number.
  const strip = await checkStrip(page, who, path, entry.strip ?? null, fail);

  /*
   * 7. An agency not enrolled in billing is shown no money.
   *
   * The fixture's agency is deliberately never enrolled -- the seed writes no
   * `AgencyBillingProfile` -- so every agency reading in this sweep is one.
   *
   * Scoped to the agency reading, not to "not staff": the publisher and buyer
   * portals are a different product with their own earnings and spend, and
   * NetEnroll's own cross-agency reading is where tonight's projected
   * settlement across every agency belongs.
   */
  if (strip?.scope === 'agency') {
    /*
     * The premise, checked rather than assumed. If somebody enrols the fixture
     * agency, this fails here — with the reason — instead of the assertion
     * below quietly passing for the wrong reason.
     */
    if (path === '/delivery' && !state.body.includes('Billing is not enabled for this agency')) {
      fail(
        `${who}: the fixture agency is supposed to be unenrolled — the seed writes no ` +
          'AgencyBillingProfile — but /delivery does not say so. The "no billing figures for an ' +
          'unenrolled agency" checks below are then asserting nothing.'
      );
    }

    const money = strip.figures.filter(f => f.value.includes('$') || BILLING_LABEL.test(f.text));
    if (money.length > 0) {
      fail(
        `${who}: the strip shows billing figures to an agency that is not enrolled in billing:\n` +
          money.map(f => `    ${f.id}: ${JSON.stringify(f.text)}`).join('\n') +
          '\n  Billing is opt-in per agency and off by default. An unenrolled agency is not ' +
          'gated, not metered and not settled, and a zero or an em dash under a label about ' +
          'money tells a principal they owe an unknown amount.'
      );
    }
  }

  await context.close();
  return {
    serverFailed: responses.some(r => r.status >= 500 && !isKnownRefusal(r, path)),
  };
}

// ─── The front door ──────────────────────────────────────────────────────────

/**
 * A browser with no session at all, which is the state every one of these
 * checks needs and the one `openAsOperator` cannot produce.
 *
 * Google's script is stubbed for every load. Nothing about the assertions
 * depends on reaching accounts.google.com, and nothing should: a runner
 * without egress would otherwise report the sign-in button as missing, and a
 * runner with it would be testing Google's uptime.
 */
async function openSignedOut(browser, path, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
  });
  const page = await context.newPage();

  const responses = [];
  page.on('response', r => {
    const url = new URL(r.url());
    if (url.origin === FRONT) responses.push({ path: url.pathname, status: r.status() });
  });

  await page.route(GSI_SCRIPT, route =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: GSI_STUB })
  );

  await page.goto(`${FRONT}${path}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForTimeout(LOGIN_SETTLE_MS);
  return { context, page, responses };
}

/** The page is no wider than the window it is in. */
async function checkFits(page, who) {
  const fit = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  // One pixel of slack for sub-pixel layout; anything real is tens of pixels.
  if (fit.scrollWidth > fit.clientWidth + 1) {
    fail(
      `${who}: the page is ${fit.scrollWidth}px wide in a ${fit.clientWidth}px window, so it ` +
        'scrolls sideways.'
    );
  }
}

/**
 * The signed-out page itself: who it says it is, what it must not offer, and
 * whether it can be read.
 */
async function checkLoginPage(browser, viewport) {
  const who = `/login at ${viewport.label}`;
  const { context, page, responses } = await openSignedOut(browser, LOGIN_ROUTE, viewport);

  const state = await page.evaluate(() => ({
    title: document.title,
    body: document.body.innerText,
    main: (document.querySelector('main') ?? document.body).innerText.trim(),
    // The brand mark is artwork now, so its identity is the file it points at.
    logo: document.querySelector('[data-testid="logo"] img')?.getAttribute('src') ?? null,
    // Every control a person could follow away from signing in.
    controls: Array.from(document.querySelectorAll('main a, main button')).map(el =>
      (el.textContent || '').trim()
    ),
    tabs: Array.from(document.querySelectorAll('main [role="tab"]')).map(el =>
      (el.textContent || '').trim()
    ),
  }));

  // 1. It rendered.
  if (state.main.length === 0) {
    fail(`${who}: the page is empty after ${LOGIN_SETTLE_MS}ms.`);
  }

  // 2. It is NetEnroll's, in the mark the rebrand established.
  if (state.logo !== '/netenroll-logo.png') {
    fail(
      `${who}: the brand mark loads ${JSON.stringify(state.logo)} rather than ` +
        '"/netenroll-logo.png". The front door has to carry the supplied lockup, not a ' +
        'wordmark reconstructed from whatever font happens to load.'
    );
  }
  if (!state.title.includes('NetEnroll')) {
    fail(
      `${who}: the tab is titled ${JSON.stringify(state.title)}, which does not name the product.`
    );
  }

  // 3. It says what it is, so someone who arrived by mistake can tell.
  if (!/agent portal for licensed insurance agencies/i.test(state.body)) {
    fail(
      `${who}: nothing on the page says what this is. Someone landing on the root of the domain ` +
        'has to be able to tell within a couple of seconds whether it is for them.\n' +
        `  saw: ${JSON.stringify(state.body.slice(0, 300))}`
    );
  }

  // 4. No promise to a route that does not exist.
  for (const forbidden of ABSENT_FROM_LOGIN) {
    const offender = state.controls.find(label => forbidden.test(label));
    if (offender) {
      fail(
        `${who}: offers ${JSON.stringify(offender)}, and there is no password-reset route behind ` +
          'it. Saying who to ask is more use than a link that does not exist.'
      );
    }
  }

  // 5. Both doors, and both of them visible without hunting.
  for (const tab of LOGIN_TABS) {
    if (!state.tabs.includes(tab)) {
      fail(
        `${who}: there is no ${JSON.stringify(tab)} tab. The front door has two halves — signing ` +
          'in, and spending an invitation code — and an invited agent whose link was read out to ' +
          `them has nowhere to go without the second.\n  saw tabs: ${JSON.stringify(state.tabs)}`
      );
    }
  }

  // 6. It fits the window, and it is legible on the light ground.
  await checkFits(page, who);
  await checkLegibility(page, who);
  reportRefusals(who, responses, 'A signed-out page load must not be refused anything');

  await context.close();
}

/**
 * Sign in with a keyboard and nothing else, and arrive somewhere.
 *
 * Tab, type, tab, type, Enter — no click anywhere. The landing assertion is
 * the one that matters: a token in localStorage is not a session, and the
 * defect this replaces stored one and returned the person to this page.
 */
async function checkLoginByKeyboard(browser, fixture, viewport) {
  const who = `keyboard sign-in at ${viewport.label}`;
  const { context, page, responses } = await openSignedOut(browser, LOGIN_ROUTE, viewport);

  await page.keyboard.press('Tab');
  let reached = false;
  for (let hop = 0; hop < 15 && !reached; hop++) {
    reached = (await page.evaluate(() => document.activeElement?.id)) === 'signin-email';
    if (!reached) await page.keyboard.press('Tab');
  }
  if (!reached) {
    fail(`${who}: tabbing from the top of the document never reaches the email field.`);
    await context.close();
    return;
  }

  // The field a keyboard has landed on must show it. Either treatment counts:
  // globals.css draws an outline, the primitives draw a ring as a box-shadow.
  const focus = await page.evaluate(() => {
    const style = getComputedStyle(document.activeElement);
    return { outlineWidth: parseFloat(style.outlineWidth) || 0, boxShadow: style.boxShadow };
  });
  if (focus.outlineWidth < 1 && (focus.boxShadow === 'none' || !focus.boxShadow)) {
    fail(`${who}: the focused email field draws no visible focus indicator.`);
  }

  await page.keyboard.type(fixture.activeEmail);
  await page.keyboard.press('Tab');
  if ((await page.evaluate(() => document.activeElement?.id)) !== 'signin-password') {
    fail(`${who}: Tab from the email field does not reach the password field.`);
  }
  await page.keyboard.type(fixture.password);
  await page.keyboard.press('Enter');

  const landed = await settleOnPath(page, LOGIN_ROUTE);
  if (landed === LOGIN_ROUTE) {
    const alert = await page.evaluate(
      () => document.querySelector('main [role="alert"]')?.innerText ?? null
    );
    fail(
      `${who}: correct credentials, and still on the sign-in page.` +
        (alert ? ` It is showing ${JSON.stringify(alert)}.` : '') +
        '\n  A token that is stored but never becomes a session is the whole defect: the layout ' +
        'the redirect lands on reads the session provider, not localStorage.'
    );
  }
  if (!(await page.evaluate(() => Boolean(localStorage.getItem('token'))))) {
    fail(`${who}: no session token was stored.`);
  }
  reportRefusals(
    who,
    responses.filter(r => !r.path.startsWith('/api/v1/')),
    'Signing in must not be refused anything'
  );

  await context.close();
}

/** Wait for a client-side redirect off `from`, up to twenty seconds. */
async function settleOnPath(page, from) {
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(500);
    const at = await page.evaluate(() => window.location.pathname);
    if (at !== from) {
      // A guard further in can bounce the navigation straight back, which is
      // the failure being watched for; give it a moment to do so.
      await page.waitForTimeout(2000);
      return page.evaluate(() => window.location.pathname);
    }
  }
  return from;
}

/**
 * A refusal, rendered.
 *
 * Every one of these is a page a person actually reaches — the password was
 * wrong, the account is suspended, the invitation has been used — and each has
 * to arrive as a sentence they can read, on a panel that is still legible. A
 * redesign that turns a clear refusal into a blank panel passes every other
 * check in this file.
 */
async function checkLoginRefusal(browser, viewport, { who, path, fill, expect, allow }) {
  const label = `${who} at ${viewport.label}`;
  const { context, page, responses } = await openSignedOut(browser, path, viewport);

  await fill(page);

  let alert = null;
  try {
    await page.waitForSelector('main [role="alert"]', { timeout: 15_000 });
    alert = (await page.innerText('main [role="alert"]')).trim();
  } catch {
    const body = await page.evaluate(() => document.body.innerText);
    fail(
      `${label}: nothing was said. The page shows no alert at all.\n` +
        `  saw: ${JSON.stringify(body.slice(0, 300))}`
    );
    await context.close();
    return;
  }

  if (!alert) {
    fail(`${label}: the alert panel rendered with no text in it — a blank refusal.`);
  } else if (!expect.test(alert)) {
    fail(
      `${label}: the refusal reads ${JSON.stringify(alert)}, which does not match ${expect}. ` +
        'The message a person is shown is part of the contract, not a detail of the panel.'
    );
  }

  // The person is still here, and can try again.
  const at = await page.evaluate(() => window.location.pathname);
  if (at !== LOGIN_ROUTE) {
    fail(`${label}: a refused attempt moved the browser to ${at}.`);
  }

  await checkFits(page, label);
  await checkLegibility(page, label);
  reportRefusals(
    label,
    responses.filter(r => !(r.path === allow?.path && r.status === allow?.status)),
    'Only the refusal under test should come back 4xx'
  );

  await context.close();
}

/** Follow an invitation and set a password, which is the only way in. */
async function checkActivation(browser, fixture, viewport) {
  const who = `activation at ${viewport.label}`;
  const path =
    `${LOGIN_ROUTE}?activation=${encodeURIComponent(fixture.tokens.usable)}` +
    `&email=${encodeURIComponent(fixture.invitee)}`;
  const { context, page, responses } = await openSignedOut(browser, path, viewport);

  const body = await page.evaluate(() => document.body.innerText);
  // The agency the link names, read back from the preview. An agent following
  // a link has to be able to see they are joining the right agency.
  if (!body.includes('Ridgeline Insurance')) {
    fail(
      `${who}: the page does not name the agency the invitation is for.\n` +
        `  saw: ${JSON.stringify(body.slice(0, 400))}`
    );
  }

  await checkFits(page, who);
  await checkLegibility(page, who);

  // The link carried the code, so there is no code field to fill and there
  // must not be one: asking again for something already satisfied is how a
  // person concludes the link did not work.
  if (await page.isVisible('#create-invitation')) {
    fail(`${who}: the invitation code field is shown even though the link carried the code.`);
  }

  await page.fill('#create-firstname', 'Nia');
  await page.fill('#create-lastname', 'Newagent');
  await page.selectOption('#create-position', 'Licensed Agent');
  await page.fill('#create-password', 'Ridgeline1');
  await page.click('main form button[type="submit"]');

  const landed = await settleOnPath(page, LOGIN_ROUTE);
  if (landed === LOGIN_ROUTE) {
    const alert = await page.evaluate(
      () => document.querySelector('main [role="alert"]')?.innerText ?? null
    );
    fail(
      `${who}: a valid invitation did not produce a session.` +
        (alert ? ` The page is showing ${JSON.stringify(alert)}.` : '')
    );
  }
  reportRefusals(
    who,
    responses.filter(r => !r.path.startsWith('/api/v1/')),
    'Redeeming a valid invitation must not be refused anything'
  );

  await context.close();
}

/**
 * The client id, with nothing in the environment supplying it.
 *
 * The page must initialise Google with the id it ships with. When that value
 * came only from NEXT_PUBLIC_GOOGLE_CLIENT_ID -- which production does not set
 * -- a rebuild inlined an empty string and the buttons vanished with no error
 * anywhere. The width assertion is the other half: Google draws to a fixed
 * pixel width, and a button wider than the card is how a 360px phone gets a
 * sideways scrollbar.
 */
async function checkGoogleButton(browser, viewport) {
  const who = `Google sign-in at ${viewport.label}`;
  const { context, page } = await openSignedOut(browser, LOGIN_ROUTE, viewport);

  /*
   * `next/script` with strategy="lazyOnload" runs the tag after the window
   * load event, so the stub has not necessarily executed by the time the
   * settle above is over. Waited for rather than slept on: a fixed pause long
   * enough for a loaded CI runner is a pause on every run.
   */
  await page
    .waitForFunction(() => Boolean(window.__gsi?.renderButton?.length), null, { timeout: 20_000 })
    .catch(() => {});

  const gsi = await page.evaluate(() => window.__gsi ?? null);
  if (!gsi) {
    fail(`${who}: the page never loaded Google's script, so no button can exist.`);
    await context.close();
    return;
  }

  const ids = gsi.initialize.map(config => config.client_id);
  if (!ids.includes(GOOGLE_CLIENT_ID)) {
    fail(
      `${who}: initialised with ${JSON.stringify(ids)} rather than the id the page ships with.\n` +
        '  NEXT_PUBLIC_GOOGLE_CLIENT_ID is deliberately not required — the API hardcodes the same ' +
        'id, production does not set the variable, and treating it as environment-specific is ' +
        'what removed sign-in once already.'
    );
  }

  const drawn = gsi.renderButton.find(call => call.id === 'google-signin-button');
  if (!drawn) {
    fail(`${who}: Google was never asked to draw a button into the sign-in slot.`);
  } else {
    const slot = await page.evaluate(() => {
      const el = document.getElementById('google-signin-button');
      return el ? Math.round(el.getBoundingClientRect().width) : null;
    });
    if (slot !== null && drawn.width > slot + 1) {
      fail(
        `${who}: the button was drawn ${drawn.width}px wide into a ${slot}px slot, which overflows ` +
          'the card.'
      );
    }
    if (!(await page.isVisible('#google-signin-button button'))) {
      fail(`${who}: the slot exists but no button is visible in it.`);
    }
  }

  /*
   * And the same on the other half.
   *
   * This is the check that would have caught the original defect. The slot on
   * the second panel is mounted by a tab switch, long after Google's script
   * settled, and the effect that used to draw into it looked its container up
   * by id on the commit where the panel was not yet in the document — got
   * null, returned, and never ran again. Nothing about the sign-in panel can
   * see that: it is mounted on the first commit and has always worked.
   */
  await page.click('main [role="tab"]:has-text("Create account")');
  await page
    .waitForFunction(() => Boolean(document.querySelector('#google-signup-button button')), null, {
      timeout: 20_000,
    })
    .catch(() => {});

  const onCreate = await page.evaluate(() =>
    (window.__gsi?.renderButton ?? []).find(call => call.id === 'google-signup-button')
  );
  if (!onCreate) {
    fail(
      `${who}: Google was never asked to draw a button into the create-account slot. ` +
        'Signing up with Google is how most people have an account here at all.'
    );
  } else {
    const slot = await page.evaluate(() => {
      const el = document.getElementById('google-signup-button');
      return el ? Math.round(el.getBoundingClientRect().width) : null;
    });
    if (slot !== null && onCreate.width > slot + 1) {
      fail(
        `${who}: the create-account button was drawn ${onCreate.width}px wide into a ${slot}px ` +
          'slot, which overflows the card.'
      );
    }
    if (!(await page.isVisible('#google-signup-button button'))) {
      fail(`${who}: the create-account slot exists but no button is visible in it.`);
    }
  }

  await checkFits(page, who);
  await context.close();
}

/** Everything the front door has to do, at a desk and on a phone. */
async function checkFrontDoor(browser, services) {
  if (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID) {
    fail(
      'NEXT_PUBLIC_GOOGLE_CLIENT_ID is set in this run, so the check that the page works without ' +
        'it proves nothing. Unset it.'
    );
  }

  for (const viewport of LOGIN_VIEWPORTS) {
    // Each of these redeems or spends state, so the fixture is rebuilt per
    // viewport: the usable grant is single-use by design.
    const fixture = await seedLogin(services);

    await checkLoginPage(browser, viewport);
    await checkGoogleButton(browser, viewport);
    await checkLoginByKeyboard(browser, fixture, viewport);

    await checkLoginRefusal(browser, viewport, {
      who: 'a wrong password',
      path: LOGIN_ROUTE,
      fill: async page => {
        await page.fill('#signin-email', fixture.activeEmail);
        await page.fill('#signin-password', 'not-the-password');
        await page.click('main form button[type="submit"]');
      },
      expect: /invalid email or password/i,
      allow: { path: '/api/auth/login', status: 401 },
    });

    await checkLoginRefusal(browser, viewport, {
      who: 'a suspended account',
      path: LOGIN_ROUTE,
      fill: async page => {
        await page.fill('#signin-email', fixture.suspendedEmail);
        await page.fill('#signin-password', fixture.password);
        await page.click('main form button[type="submit"]');
      },
      expect: /not active/i,
      allow: { path: '/api/auth/login', status: 403 },
    });

    for (const [label, token, email] of [
      ['an expired invitation', fixture.tokens.expired, fixture.expiredEmail],
      ['an already-redeemed invitation', fixture.tokens.redeemed, fixture.redeemedEmail],
    ]) {
      const path = `${LOGIN_ROUTE}?activation=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
      // The preview answers before a password is typed, which is the point:
      // being refused after filling the form in is a worse refusal than being
      // refused on arrival.
      await checkLoginRefusal(browser, viewport, {
        who: label,
        path,
        fill: async () => {},
        expect: /not valid for this email address/i,
        allow: { path: '/api/auth/activation/preview', status: 400 },
      });
    }

    await checkActivation(browser, fixture, viewport);
  }
}

/** The dark scope: light document, dark pane. */
async function checkDarkScope(browser, session) {
  const who = `dark scope on ${DARK_SCOPE_ROUTE}`;
  const { context, page } = await openAsOperator(
    browser,
    session,
    DARK_SCOPE_ROUTE,
    SWEEP_SETTLE_MS
  );
  const audit = await checkLegibility(page, who);
  if (audit.darkScopes.length === 0) {
    fail(`${who}: no [data-theme="dark"] subtree rendered, so the dark scope was not exercised.`);
  }
  await context.close();
}

/**
 * Leave one page alone and watch whether it keeps asking.
 *
 * The live strip polled `/api/v1/live/metrics` every five seconds on a bare
 * `setInterval`, and for an operator with no agency every one of those was a
 * 409. It polls `/api/v1/live/strip` every thirty seconds now, which answers
 * the cross-agency reading for staff with no agency rather than refusing them,
 * so the honest assertion is that a quiet page stays quiet: a handful of
 * requests over three quarters of a minute is a page that has settled; dozens
 * is a loop.
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

  /*
   * Two pollers are correct on this page and nothing else is: /delivery's own
   * cross-agency view every 30s, and the live strip above it every 30s. Each
   * is jittered by ±15%, so over three quarters of a minute each can land
   * twice; one spare covers a boundary. Anything approaching a 5s cadence --
   * which is what the strip used to run at -- is not.
   */
  const ceiling = Math.ceil(IDLE_MS / 30_000) * 2 + 1;
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
      /*
       * The softphone's credential endpoint refuses with 503 when this is
       * unset, deliberately — a credential that cannot register is worse than
       * none. Every page an agent loads asks for one, so without this the
       * sweep measures an environment no agent works in, and a real failure of
       * that endpoint would be indistinguishable from the empty config.
       */
      SIP_AGENT_PASSWORD: process.env.SIP_AGENT_PASSWORD ?? 'platform-smoke-sip-password',
      /*
       * The API rate-limits to 100 requests a minute per IP. This sweep loads
       * about sixty pages, several requests each, from one address — traffic
       * no person generates and the limiter is right to find suspicious. It
       * showed up as pages bouncing to /login, because a refused /api/auth/me
       * reads to the client as a dead session.
       *
       * Raised rather than disabled: the limiter still runs, so a runaway poll
       * would still be caught. The 500-instead-of-429 this uncovered is fixed
       * in apps/api/src/index.ts.
       */
      RATE_LIMIT_MAX: process.env.RATE_LIMIT_MAX ?? '2000',
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
  const everyRoute = new Set([
    ...ROUTES.map(r => r.path),
    ...SWEEP.flatMap(entry => entry.routes),
    DARK_SCOPE_ROUTE,
    LOGIN_ROUTE,
  ]);
  for (const path of everyRoute) {
    await fetch(`${FRONT}${path}`, { redirect: 'manual' }).catch(() => null);
  }

  const browser = await chromium.launch({
    executablePath: process.env.SMOKE_CHROMIUM || undefined,
  });

  if (!ONLY) {
    for (const roles of ROLE_SETS) {
      await seed(services, roles);
      const session = await signIn();
      for (const route of ROUTES) await checkRoute(browser, session, roles, route);
    }
  }

  let sweptRoutes = 0;
  for (const entry of SWEEP) {
    if (ONLY && !entry.who.includes(ONLY)) continue;
    await seed(services, entry.roles, {
      platform: entry.platform,
      actingTenant: entry.actingTenant,
    });
    const session = await signIn();
    for (const path of entry.routes) {
      await sweepRoute(browser, session, entry, path);
      sweptRoutes++;
    }
  }

  // The front door, signed out. Last, because it seeds its own agency and
  // redeems an invitation, and nothing above should inherit either.
  if (!ONLY) await checkFrontDoor(browser, services);

  await seed(services, ['ADMIN']);
  const staff = await signIn();
  await checkDarkScope(browser, staff);
  if (!ONLY) await checkPollingSettles(browser, staff);

  await browser.close();

  if (failures.length > 0) {
    console.error(`\n${failures.length} failure(s):\n\n${failures.join('\n\n')}\n`);
    /*
     * The server's own account of it.
     *
     * A 5xx in the list above is a report that something failed, with no
     * evidence of why — and the process that knows why is one this script
     * started and is about to kill. Whoever reads a red CI job needs the
     * stack, not just the status code.
     */
    const lines = api.log.join('').split('\n');
    const keep = new Set();
    lines.forEach((line, i) => {
      // A 5xx logged as a completed request matters as much as one logged as
      // an error: the response the browser saw is the fact under test.
      if (
        (/"level":(50|60)|Error:|error:|ERROR/.test(line) || /statusCode":? 5\d\d/.test(line)) &&
        !line.includes('prisma:query')
      ) {
        // The line naming an error is rarely the line that locates it, so take
        // the stack around it as well.
        for (let j = Math.max(0, i - 2); j <= Math.min(lines.length - 1, i + 14); j++) {
          if (!lines[j].includes('prisma:query')) keep.add(j);
        }
      }
    });
    const serverErrors = [...keep]
      .sort((a, b) => a - b)
      .slice(-120)
      .map(i => lines[i]);
    if (serverErrors.length > 0) {
      console.error(
        `The API logged this while the failures above happened:\n${serverErrors.join('\n')}\n`
      );
    }
    process.exitCode = 1;
    return;
  }
  console.log(
    `browser smoke test passed: ${ROLE_SETS.length} role set(s) x ${ROUTES.length} landing route(s), ` +
      `${sweptRoutes} route load(s) across ${SWEEP.length} sessions, light and legible, ` +
      'no prompt, nothing refused, the live strip present and agreeing with the page below it, ' +
      'no billing figures for an agency that is not enrolled, dark scope dark, polling settles, ' +
      `and the front door signs people in at ${LOGIN_VIEWPORTS.map(v => v.label).join(' and ')}.`
  );
}

main()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(shutdown);
