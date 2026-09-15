/**
 * Which US states an AGENT is licensed to operate in, and the one place that
 * decides whether a given operation is inside that set.
 *
 * ── The defect this exists for ───────────────────────────────────────────────
 *
 * An insurance agent may only work a prospect in a state they hold a licence
 * for. Nothing on the server knew that. The only thing resembling a licensed
 * state anywhere in the product was a state dropdown in the browser, and a
 * dropdown is a suggestion: `POST /api/v1/agent/call/originate` took a phone
 * number, `POST /api/v1/prospects/intake` took `body.state`, and the CRM
 * endpoints served any lead in the tenant to any agent in it. An agent licensed
 * in Tennessee could dial, capture, read and edit a Florida prospect by typing
 * a different number into the same form.
 *
 * ── Why this is not a second authorization system ────────────────────────────
 *
 * It is one more constraint on top of the ones that already exist, never a
 * replacement for any of them, and never a grant. Every enforcement point below
 * runs AFTER the tenant has been resolved by `lib/tenant-context.ts` and after
 * whatever ownership rule that route already applies. Licensing can only ever
 * narrow what a caller already reached:
 *
 *     authorized = tenant ∧ role ∧ ownership ∧ licensed-state
 *
 * So "this agent is assigned to the campaign" does NOT license them for the
 * campaign's states, and "this agent is licensed in TN" does NOT get them into
 * another agency's TN leads. The two questions are asked separately and both
 * must answer yes.
 *
 * ── Where the answer comes from ──────────────────────────────────────────────
 *
 * `User.metadata.licensedStates`, read from the database on the request, in the
 * acting tenant. Never a token claim, never a header, never a request body.
 *
 * `metadata` rather than a new column or a new model because the schema can
 * already carry this and a migration cannot be taken back: `User.metadata` is
 * an existing Json column, it is already authorization-bearing in this codebase
 * (`lib/principal.ts` falls back to `metadata.publisherId`), and every write
 * path into it is key-controlled. `PATCH /api/v1/users/:userId` merges a
 * metadata object and is gated on `isAdminOrOwner`; `PATCH /api/auth/me/settings`
 * is the only self-service writer and it copies three named keys
 * (`position`, `defaultScript`, `customScripts`) rather than spreading the body.
 * An AGENT therefore has no path to its own licence list -- which is the single
 * property that makes storing it here safe.
 *
 * The cost is that the column is untyped, so nothing at the database layer stops
 * a malformed value being stored. That is answered by normalising on BOTH sides:
 * the admin write path validates (see `routes/index.ts`), and every read here
 * re-normalises and silently drops anything it cannot resolve to a canonical
 * code. A licence list that has rotted reads as a shorter list, never as a
 * wider one.
 *
 * ── Default deny ─────────────────────────────────────────────────────────────
 *
 * For a principal this module considers state-restricted, every one of these is
 * a refusal:
 *
 *   * no `licensedStates` key at all;
 *   * an empty list;
 *   * a list that normalises to empty;
 *   * a target state that is absent, unknown or not a real jurisdiction;
 *   * a target state that is valid and simply not in the list.
 *
 * Note the third-from-last: `permits(authority, null)` is FALSE. A caller that
 * cannot determine the state of an operation must not therefore skip the check.
 * Where an operation genuinely carries no state -- a toll-free number has no
 * jurisdiction to be licensed in -- the CALLER decides that and does not ask, and
 * says so at the call site. That keeps "there is no state here" a deliberate,
 * reviewable classification instead of a silent fallthrough.
 *
 * ── Why not `isCallerStateAccepted()` ────────────────────────────────────────
 *
 * `lib/geo.ts` already compares a state against a list, and it is the wrong
 * function for this: it fails OPEN twice over -- an empty list means "national,
 * accept everything" and an unknown caller state is allowed through. Those are
 * the correct semantics for buyer geo-routing, where the list is a preference
 * and dropping a call costs money. They are the exact inverse of a licence,
 * where an empty list means "not licensed anywhere" and an unknown state means
 * "cannot show this is permitted". The two must not share an implementation.
 */

import { getStateFromPhoneNumber } from './geo.js';
import { getPrismaClient } from './prisma.js';

/**
 * Every jurisdiction an agent can hold a licence in.
 *
 * This is the union of the two lists the codebase already carries -- the 50
 * states plus DC from `lib/geo.ts#isValidStateCode`, and the five territories
 * `services/insurance-lead-validator.ts` accepts on an inbound lead. The union
 * is deliberate: a lead can already be ingested with `state: 'PR'`, and a set
 * that could not express a Puerto Rico licence would make that lead
 * permanently unworkable by every agent rather than workable by the licensed
 * ones.
 *
 * It is not a second representation. The representation is, here and
 * everywhere else in this codebase, the uppercase two-letter code.
 */
const LICENSABLE_JURISDICTIONS = new Set([
  'AL',
  'AK',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'DE',
  'FL',
  'GA',
  'HI',
  'ID',
  'IL',
  'IN',
  'IA',
  'KS',
  'KY',
  'LA',
  'ME',
  'MD',
  'MA',
  'MI',
  'MN',
  'MS',
  'MO',
  'MT',
  'NE',
  'NV',
  'NH',
  'NJ',
  'NM',
  'NY',
  'NC',
  'ND',
  'OH',
  'OK',
  'OR',
  'PA',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VT',
  'VA',
  'WA',
  'WV',
  'WI',
  'WY',
  'DC',
  'PR',
  'VI',
  'GU',
  'AS',
  'MP',
]);

/**
 * Full names, for input that arrives spelled out.
 *
 * A browser form posts what the user picked, and the state pickers in this
 * product are not consistent about which they send -- `lib/us-states.ts` sends
 * codes, `components/retention/CustomerIntakeForm.tsx` has its own list.
 * Resolving the name HERE is what keeps the comparison in one place. The
 * alternative already exists and is a bug worth not repeating:
 * `normalizeState()` in the insurance validator is `toUpperCase().slice(0, 2)`,
 * which turns "Tennessee" into "TE" -- not a state, and silently not the one
 * the user chose.
 */
const NAME_TO_CODE: Record<string, string> = {
  ALABAMA: 'AL',
  ALASKA: 'AK',
  ARIZONA: 'AZ',
  ARKANSAS: 'AR',
  CALIFORNIA: 'CA',
  COLORADO: 'CO',
  CONNECTICUT: 'CT',
  DELAWARE: 'DE',
  FLORIDA: 'FL',
  GEORGIA: 'GA',
  HAWAII: 'HI',
  IDAHO: 'ID',
  ILLINOIS: 'IL',
  INDIANA: 'IN',
  IOWA: 'IA',
  KANSAS: 'KS',
  KENTUCKY: 'KY',
  LOUISIANA: 'LA',
  MAINE: 'ME',
  MARYLAND: 'MD',
  MASSACHUSETTS: 'MA',
  MICHIGAN: 'MI',
  MINNESOTA: 'MN',
  MISSISSIPPI: 'MS',
  MISSOURI: 'MO',
  MONTANA: 'MT',
  NEBRASKA: 'NE',
  NEVADA: 'NV',
  'NEW HAMPSHIRE': 'NH',
  'NEW JERSEY': 'NJ',
  'NEW MEXICO': 'NM',
  'NEW YORK': 'NY',
  'NORTH CAROLINA': 'NC',
  'NORTH DAKOTA': 'ND',
  OHIO: 'OH',
  OKLAHOMA: 'OK',
  OREGON: 'OR',
  PENNSYLVANIA: 'PA',
  'RHODE ISLAND': 'RI',
  'SOUTH CAROLINA': 'SC',
  'SOUTH DAKOTA': 'SD',
  TENNESSEE: 'TN',
  TEXAS: 'TX',
  UTAH: 'UT',
  VERMONT: 'VT',
  VIRGINIA: 'VA',
  WASHINGTON: 'WA',
  'WEST VIRGINIA': 'WV',
  WISCONSIN: 'WI',
  WYOMING: 'WY',
  'DISTRICT OF COLUMBIA': 'DC',
  'WASHINGTON DC': 'DC',
  'WASHINGTON, D.C.': 'DC',
  'PUERTO RICO': 'PR',
  'VIRGIN ISLANDS': 'VI',
  'U.S. VIRGIN ISLANDS': 'VI',
  GUAM: 'GU',
  'AMERICAN SAMOA': 'AS',
  'NORTHERN MARIANA ISLANDS': 'MP',
};

/**
 * The canonical two-letter code for a state, or `null` if there isn't one.
 *
 * `null` is the answer for every kind of junk -- a number, an object, an empty
 * string, "XX", "Tennesee" -- and every caller treats `null` as "cannot be
 * authorized". Nothing here guesses: a two-letter code must be a real
 * jurisdiction and a longer string must match a full name exactly once
 * punctuation-insensitive whitespace folding has been applied.
 */
export function normalizeStateCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;

  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  const upper = trimmed.toUpperCase();

  if (upper.length === 2) {
    return LICENSABLE_JURISDICTIONS.has(upper) ? upper : null;
  }

  // "new  york" and "New York" are the same choice; "N.Y." is not a name.
  const folded = upper.replace(/\s+/g, ' ');
  return NAME_TO_CODE[folded] ?? null;
}

/** Every jurisdiction a licence may name. Exported for the admin write path. */
export function isLicensableState(code: string): boolean {
  return LICENSABLE_JURISDICTIONS.has(code);
}

/**
 * A stored licence list, split into what enforcement will honour and what it
 * will silently drop.
 *
 * The `rejected` half exists for the operator, not for the enforcement: a list
 * reading `["Tennesee", "XX"]` grants nothing, and an administrator looking at
 * a blocked agent needs to see WHY rather than an empty column. It is what
 * `cli/agent-licenses.ts` and `scripts/licensed-states-report.sh` report on, and
 * keeping it here rather than in the CLI is what stops the tool that reports
 * readiness from disagreeing with the code that enforces it.
 */
export interface LicencePartition {
  /** Canonical codes, sorted and de-duplicated. What `permits()` will match. */
  licensed: string[];
  /** Entries that resolve to no jurisdiction. They grant nothing. */
  rejected: unknown[];
}

/**
 * Split a stored licence list. Anything that is not an array is wholly
 * rejected rather than treated as absent -- `licensedStates: "TN"` is a
 * configuration mistake with a visible cause, and reporting it as "no licence"
 * would send somebody looking for a missing row instead of a wrong type.
 */
export function partitionLicensedStates(raw: unknown): LicencePartition {
  if (raw === undefined || raw === null) return { licensed: [], rejected: [] };
  if (!Array.isArray(raw)) return { licensed: [], rejected: [raw] };

  const codes = new Set<string>();
  const rejected: unknown[] = [];

  for (const entry of raw) {
    const code = normalizeStateCode(entry);
    if (code) codes.add(code);
    else rejected.push(entry);
  }

  return { licensed: [...codes].sort(), rejected };
}

/**
 * Normalize a whole licence list, dropping everything unrecognisable.
 *
 * Used on the read side here and on the admin write side in `routes/index.ts`,
 * so what an administrator is told they saved is exactly what will be enforced.
 */
export function normalizeLicensedStates(raw: unknown): string[] {
  return partitionLicensedStates(raw).licensed;
}

/** The fields of `request.user` this module reads. Nothing else is consulted. */
export interface LicensedStatePrincipal {
  userId?: string;
  roles?: string[];
  isPlatformAdmin?: boolean;
  previewRole?: string | null;
}

type MaybeAuthenticatedRequest = { user?: LicensedStatePrincipal };

/**
 * Roles that are never narrowed by a licence.
 *
 * An agency's principal and its administrators run the agency; they are not
 * working a book of business and the product has never asked them for a licence
 * number. Narrowing them would lock an owner out of their own CRM on the first
 * request. ANALYST, PUBLISHER, BUYER and READONLY are not listed because they
 * are not listed anywhere here -- only AGENT is restricted, so every other role
 * keeps exactly the behaviour it had.
 */
const UNRESTRICTED_ROLES = new Set(['OWNER', 'ADMIN']);

/**
 * Is this principal subject to licensed-state authorization?
 *
 * True only for a principal whose RESOLVED roles (from `lib/principal.ts`, i.e.
 * the database, not the token) contain AGENT and contain neither ADMIN nor
 * OWNER. An account holding both AGENT and ADMIN is an administrator who also
 * takes calls; the wider grant wins, as it does everywhere else in this RBAC.
 *
 * A platform operator is exempt -- their capability is deliberately outside the
 * tenant dimension and they hold no licence anywhere -- with one exception: an
 * operator who has explicitly entered a role PREVIEW as AGENT is asking the
 * question "what does an agent here actually see?", and the honest answer
 * includes this narrowing. The preview is read-only (`middleware/read-only-preview.ts`),
 * so this can only ever hide rows from them, never refuse them a write.
 */
export function isStateRestrictedAgent(principal: LicensedStatePrincipal | undefined): boolean {
  if (!principal?.userId) return false;

  const roles = Array.isArray(principal.roles) ? principal.roles : [];

  if (principal.isPlatformAdmin && principal.previewRole !== 'AGENT') return false;
  if (roles.some(role => UNRESTRICTED_ROLES.has(role))) return false;

  return roles.includes('AGENT');
}

/**
 * What a request may do, state-wise.
 *
 * `restricted: false` is "this principal is not an agent" and must be treated as
 * "do not apply any state rule at all" -- NOT as "licensed everywhere", which
 * would be the same thing here but not at the call sites, where an unrestricted
 * principal must also not have its result set filtered.
 */
export type StateAuthority =
  | { restricted: false }
  | { restricted: true; licensed: ReadonlySet<string> };

export const UNRESTRICTED: StateAuthority = { restricted: false };

/**
 * The agent's licensed states, from the database, in the acting tenant.
 *
 * Scoped by `tenantId` as well as `id`: the user id comes from a verified token
 * but the acting tenant can be changed by a platform operator, and a lookup by
 * id alone would read one tenant's licence list while serving another tenant's
 * rows. A mismatch returns the empty set, which denies.
 */
export async function loadLicensedStates(
  userId: string,
  tenantId: string
): Promise<ReadonlySet<string>> {
  const user = await getPrismaClient().user.findFirst({
    where: { id: userId, tenantId },
    select: { metadata: true },
  });

  if (!user) return new Set();

  const metadata = user.metadata as { licensedStates?: unknown } | null;
  return new Set(normalizeLicensedStates(metadata?.licensedStates));
}

/**
 * Resolve the state authority for a request that has already had its tenant
 * resolved. `tenantId` is passed in rather than re-derived so that this cannot
 * disagree with the tenant the handler is about to query with.
 */
export async function resolveStateAuthority(
  request: unknown,
  tenantId: string
): Promise<StateAuthority> {
  const principal = (request as MaybeAuthenticatedRequest).user;

  if (!isStateRestrictedAgent(principal)) return UNRESTRICTED;

  return {
    restricted: true,
    licensed: await loadLicensedStates(principal!.userId!, tenantId),
  };
}

/**
 * May this authority operate on this state?
 *
 * `state` is raw, untrusted input as far as this function is concerned -- a
 * body field, a query parameter or a column -- and is normalised before the
 * comparison, so a caller cannot pass "tn" or "Tennessee" and get a different
 * answer than "TN".
 *
 * Returns false for `null`/unresolvable input when restricted. See the header:
 * "no state" is not "any state".
 */
export function permits(authority: StateAuthority, state: unknown): boolean {
  if (!authority.restricted) return true;

  const code = normalizeStateCode(state);
  if (!code) return false;

  return authority.licensed.has(code);
}

/** The refusal an agent gets for a state they do not hold a licence in. */
export const STATE_NOT_LICENSED = {
  code: 'STATE_NOT_LICENSED',
  message: 'You are not licensed to work records in this state.',
} as const;

/**
 * Refuse, and say so.
 *
 * 403 rather than 404: the caller is authenticated and inside the right agency,
 * and the record they named is one of their agency's. Hiding it as a 404 would
 * be a lie their own administrator has to debug. The message names no state,
 * no record and no other agency, so it carries nothing across a tenant
 * boundary -- a cross-tenant request never reaches here, because tenant scoping
 * has already answered it with 404.
 */
export function sendStateRefusal(reply: {
  code: (status: number) => { send: (body: unknown) => unknown };
}): void {
  void reply.code(403).send({ error: STATE_NOT_LICENSED });
}

/**
 * The single guard a route calls when one state decides the whole request.
 *
 * Returns true when the handler may proceed. When it returns false the refusal
 * has already been sent and the handler must return without sending another.
 */
export async function enforceLicensedState(
  request: unknown,
  reply: { code: (status: number) => { send: (body: unknown) => unknown } },
  tenantId: string,
  state: unknown
): Promise<boolean> {
  const authority = await resolveStateAuthority(request, tenantId);

  if (permits(authority, state)) return true;

  sendStateRefusal(reply);
  return false;
}

/**
 * What jurisdiction a dialled number reaches, from authoritative data only.
 *
 * Three answers, because two would lose the one that matters:
 *
 *   `state`        a jurisdiction was established. It must be licensed.
 *   `unresolvable` the agency's own record names a state this module cannot
 *                  read ("XX", an empty string, a typo). Authoritative data is
 *                  present and says something; failing to parse it is not
 *                  permission to ignore it, so this DENIES.
 *   `none`         no jurisdiction exists to be licensed in -- a toll-free or
 *                  otherwise non-geographic number the CRM has never seen.
 *                  This is not a state-bearing operation and is allowed.
 *
 * Order matters. A CRM record is what the agency itself recorded about this
 * person and beats an inference from the area code; the area code is the
 * fallback for a number no record matches. Both are server-side: nothing here
 * reads the request.
 */
export type PhoneStateResolution =
  | { kind: 'state'; state: string }
  | { kind: 'unresolvable' }
  | { kind: 'none' };

export async function resolveStateForPhone(
  tenantId: string,
  phoneNumber: string
): Promise<PhoneStateResolution> {
  const digits = phoneNumber.replace(/\D/g, '');
  const last10 = digits.length >= 10 ? digits.slice(-10) : digits;

  if (last10.length === 10) {
    const prisma = getPrismaClient();

    const insuranceLead = await prisma.insuranceLead.findFirst({
      where: { tenantId, phone: { endsWith: last10 } },
      select: { state: true },
      orderBy: { createdAt: 'desc' },
    });
    if (insuranceLead?.state) return fromRecord(insuranceLead.state);

    const lead = await prisma.lead.findFirst({
      where: { tenantId, phoneNumber: { endsWith: last10 } },
      select: { state: true },
      orderBy: { createdAt: 'desc' },
    });
    if (lead?.state) return fromRecord(lead.state);
  }

  const inferred = normalizeStateCode(getStateFromPhoneNumber(phoneNumber));
  return inferred ? { kind: 'state', state: inferred } : { kind: 'none' };
}

function fromRecord(raw: string): PhoneStateResolution {
  const code = normalizeStateCode(raw);
  return code ? { kind: 'state', state: code } : { kind: 'unresolvable' };
}
