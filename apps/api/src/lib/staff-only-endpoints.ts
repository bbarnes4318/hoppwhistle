/**
 * The API surface only NetEnroll staff may reach.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 *
 * PR #123 took twelve screens out of the agency portal -- the call marketplace,
 * the flow builder, the voice tooling, carrier routing, the Tools group -- and
 * said plainly, in `apps/web/src/lib/staff-only-routes.ts`, that it was a
 * navigation boundary and not an authorization one. It removed the screens, the
 * links to them and the search results that led to them. It did not remove the
 * endpoints, so an agency principal holding OWNER could still create a
 * campaign, add a buyer, provision a number or rewrite carrier routing with
 * curl and a session token. This is the other half.
 *
 * ── Why it is not simply "the web list, on the server" ───────────────────────
 *
 * Because the mapping from screen to endpoint is not one-to-one, and three
 * separate things share these paths. Each was checked against the code rather
 * than assumed, and each changed the shape of the rule:
 *
 *   1. SCREENS THAT STAYED READ THE MARKETPLACE. The Calls ledger builds its
 *      campaign, publisher and buyer filters from `GET /api/v1/campaigns`,
 *      `/publishers` and `/buyers`. Reports fills its campaign dropdown the
 *      same way. Billing reads `/buyers?billingType=UPFRONT` and
 *      `/buyers/:id/transactions`. Locking these collections outright would
 *      break four screens an agency keeps, so READS STAY and only the
 *      management writes move.
 *
 *   2. THE PUBLISHER AND BUYER PORTALS WRITE UNDER THE SAME PREFIXES. A
 *      publisher creates and revokes its own API keys at
 *      `/publishers/:id/keys`; a buyer edits its own targets at
 *      `/buyers/:id/targets/:targetId`. Both are separate products for
 *      separate roles, both already scope themselves (`requirePublisherAccess`,
 *      `checkBuyerAccess`), and a blanket "writes under /publishers and
 *      /buyers are staff's" would have broken them. So those two collections
 *      are named route by route rather than by prefix.
 *
 *   3. TELEPHONY CALLS SOME OF THESE PATHS. The FreeSWITCH dialplan posts to
 *      `/api/v1/numbers/lookup` to resolve a DID, and the flow engine is driven
 *      over HTTP at `/api/v1/flows/execute` and `/api/v1/flows/events`. They sit
 *      under prefixes this file otherwise closes, they carry no operator
 *      session, and gating them would stop calls being routed. They are exempt,
 *      and the exemption is checked FIRST.
 *
 * ── What this does not do ────────────────────────────────────────────────────
 *
 * It refuses an AUTHENTICATED principal who is not staff. An anonymous request
 * is left to the refusal it already gets -- every handler behind these paths
 * resolves an acting tenant and turns away a caller who has none -- because
 * turning that 401/409 into a 403 would tell an unauthenticated caller that the
 * path exists and would change answers this change has no business changing.
 *
 * It is a capability check and nothing else: `isPlatformAdmin`, written onto
 * the principal by `middleware/api-v1-auth.ts` from a `PlatformAdmin` row keyed
 * on the authenticated user id. Not a role -- every agency has an OWNER. Not a
 * header or query parameter.
 *
 * Staff previewing an agency as one of its roles keep the capability and so
 * pass here, matching the web guard. They cannot write regardless: the
 * read-only preview hook refuses every non-GET for the life of the preview.
 *
 * ── An agency API key is not staff ───────────────────────────────────────────
 *
 * API keys belong to a tenant, never to the platform, so a key that used to
 * create campaigns, publishers or buyers now gets 403 on those calls. That is
 * the intended reading -- the marketplace is not the agency's, by whichever
 * credential -- but it is a behaviour change for any integration doing it, and
 * it is written down here rather than discovered in production.
 */

/** Matched as whole segments, never as a bare string prefix. */
interface StaffOnlyArea {
  /** This path and everything nested beneath it. */
  prefix: string;
  /** Omitted means every method. */
  methods?: readonly string[];
}

/** One route, matched with `:param` standing for exactly one segment. */
interface StaffOnlyRoute {
  pattern: string;
  methods: readonly string[];
}

const WRITES = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;

/**
 * Whole areas of the API that exist only to serve a screen an agency no longer
 * has. Every method, because there is no agency reading of any of them --
 * checked by grepping every caller in apps/web, apps/worker and the telephony
 * configs, which is also how the three exemptions below were found.
 */
export const STAFF_ONLY_AREAS: readonly StaffOnlyArea[] = [
  // Carrier routing (/settings/carriers). Deliberately the `carrier-routing`
  // prefix and not everything `routes/carrier-routing.ts` registers: that file
  // also serves `/api/v1/freeswitch/carrier-route` and `/carrier-result`, which
  // are the switch asking where to send a call.
  { prefix: '/api/v1/carrier-routing' },

  // The flow builder. `/flows/execute` and `/flows/events` are exempt below.
  { prefix: '/api/v1/flows' },

  // Voice agents and voice studio.
  { prefix: '/api/v1/aivoice' },
  { prefix: '/api/v1/fish' },

  // The Tools group.
  { prefix: '/api/v1/recording-analysis' },
  { prefix: '/api/v1/industry-research' },
  { prefix: '/api/v1/music-console' },

  // Number inventory and carrier procurement. `/numbers/lookup` is exempt
  // below -- it is the dialplan, not a person.
  { prefix: '/api/v1/numbers' },
  { prefix: '/api/v1/did-routes' },
  { prefix: '/api/v1/anveo' },
  { prefix: '/api/v1/bulkvs' },
  { prefix: '/api/v1/fractel' },

  // Campaigns: reads stay (the Calls ledger and Reports fill dropdowns from
  // them), every write goes. Safe as a prefix because nothing an agency keeps
  // and neither portal writes a campaign or an assignment under one.
  { prefix: '/api/v1/campaigns', methods: WRITES },
];

/**
 * Publishers and buyers, named one route at a time.
 *
 * A prefix rule cannot express these: the management writes and the two
 * portals' own writes live under the same path. What is staff's is creating,
 * editing and deleting the party itself, and crediting a buyer's balance --
 * the controls that were on the screens that went. What is NOT staff's, and is
 * absent from this list on purpose, is `/publishers/:id/keys`,
 * `/buyers/:id/targets` and everything else a publisher or buyer does to its
 * own record from its own portal.
 */
export const STAFF_ONLY_ROUTES: readonly StaffOnlyRoute[] = [
  { pattern: '/api/v1/publishers', methods: ['POST'] },
  { pattern: '/api/v1/publishers/:publisherId', methods: ['PATCH', 'PUT', 'DELETE'] },

  { pattern: '/api/v1/buyers', methods: ['POST'] },
  { pattern: '/api/v1/buyers/:buyerId', methods: ['PATCH', 'PUT', 'DELETE'] },
  { pattern: '/api/v1/buyers/:buyerId/credits', methods: ['POST'] },
];

/**
 * What a white-label agency's OWNER and ADMIN may reach inside the areas above.
 *
 * ── Why the tier opens part of the marketplace ───────────────────────────────
 *
 * A white-label agency also SELLS calls. It runs its own publishers, buyers and
 * campaigns and points its own numbers at them, so for its OWNER and ADMIN the
 * management writes above are its own business, not NetEnroll's. Exactly these
 * routes, matched by the same rules as the lists above: campaign writes,
 * creating, editing and deleting its publishers and buyers, crediting a
 * buyer, reading its numbers and editing one, and its DID routes.
 *
 * ── What it deliberately does not open ───────────────────────────────────────
 *
 * Buying or releasing numbers (`POST /numbers`, `/numbers/existing`,
 * `DELETE /numbers/:numberId`, `/anveo`, `/bulkvs`, `/fractel`) spends the
 * platform's carrier accounts and claims shared inventory. Flows, the voice
 * tooling, carrier routing and the Tools group are platform configuration.
 * All of that stays staff's, for everybody, the white-label tier included.
 *
 * ── It is a pass, not a scope ────────────────────────────────────────────────
 *
 * Passing here only means the request reaches its handler. Every handler
 * behind these routes still resolves the acting tenant and scopes its reads
 * and writes to it; a white-label owner reaches their own rows and nobody
 * else's. An AGENT of the same agency, and any API key, still gets 403: the
 * pass needs the role as well as the tier (`enforceStaffOnly`).
 */
type WhiteLabelAllowance = StaffOnlyArea | StaffOnlyRoute;

export const WHITE_LABEL_ALLOWED: readonly WhiteLabelAllowance[] = [
  { prefix: '/api/v1/campaigns', methods: WRITES },
  { pattern: '/api/v1/publishers', methods: ['POST'] },
  { pattern: '/api/v1/publishers/:publisherId', methods: ['PATCH', 'PUT', 'DELETE'] },
  { pattern: '/api/v1/buyers', methods: ['POST'] },
  { pattern: '/api/v1/buyers/:buyerId', methods: ['PATCH', 'PUT', 'DELETE'] },
  { pattern: '/api/v1/buyers/:buyerId/credits', methods: ['POST'] },
  { pattern: '/api/v1/numbers', methods: ['GET'] },
  { pattern: '/api/v1/numbers/:numberId', methods: ['GET', 'PATCH', 'PUT'] },
  { prefix: '/api/v1/did-routes' },
];

/**
 * Paths under a closed area that are machine callers, not operators.
 *
 * Checked before anything else. Each one carries no session, and refusing it
 * stops calls: `/numbers/lookup` is the FreeSWITCH dialplan resolving a DID
 * (apps/freeswitch/TESTING.md), and the two flow paths are how the routing
 * engine is driven for a live call.
 */
export const RUNTIME_EXEMPT_PATHS: readonly string[] = [
  '/api/v1/numbers/lookup',
  '/api/v1/flows/execute',
  '/api/v1/flows/events',
];

/** The path, with its query string and any trailing slash removed. */
function normalise(url: string): string {
  const path = (url ?? '').split('?')[0].split('#')[0];
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
  return path;
}

/** `prefix` itself, or anything nested under it. Never a partial segment. */
function underPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** Same segment count, with `:param` matching exactly one segment. */
function matchesPattern(path: string, pattern: string): boolean {
  const got = path.split('/');
  const want = pattern.split('/');
  if (got.length !== want.length) return false;
  return want.every((segment, i) => segment.startsWith(':') || segment === got[i]);
}

/**
 * True when this request belongs to NetEnroll staff and not to an agency.
 *
 * A missing method or url answers false: this decides whether to refuse, and
 * refusing on the strength of a value we do not have is the wrong direction.
 */
export function isStaffOnlyEndpoint(method: string | undefined, url: string | undefined): boolean {
  if (!method || !url) return false;

  const path = normalise(url);
  if (!path) return false;

  if (RUNTIME_EXEMPT_PATHS.includes(path)) return false;

  const verb = method.toUpperCase();

  for (const area of STAFF_ONLY_AREAS) {
    if (!underPrefix(path, area.prefix)) continue;
    if (!area.methods || area.methods.includes(verb)) return true;
  }

  for (const route of STAFF_ONLY_ROUTES) {
    if (route.methods.includes(verb) && matchesPattern(path, route.pattern)) return true;
  }

  return false;
}

/**
 * True when this request is one a white-label OWNER or ADMIN may make.
 *
 * Only consulted for a request `isStaffOnlyEndpoint` already closed, and only
 * for a principal who is on the tier and holds the role; see
 * `middleware/staff-only.ts`. A missing method or url answers false.
 */
export function isWhiteLabelAllowed(method: string | undefined, url: string | undefined): boolean {
  if (!method || !url) return false;

  const path = normalise(url);
  if (!path) return false;

  const verb = method.toUpperCase();

  return WHITE_LABEL_ALLOWED.some(rule => {
    if ('prefix' in rule) {
      return underPrefix(path, rule.prefix) && (!rule.methods || rule.methods.includes(verb));
    }
    return rule.methods.includes(verb) && matchesPattern(path, rule.pattern);
  });
}
