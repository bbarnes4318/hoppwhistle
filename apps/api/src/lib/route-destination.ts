/**
 * Inbound routing destination string hygiene.
 *
 * A resolved destination is a failover chain: steps separated by `|`, parallel
 * legs within a step separated by `,`. Valid legs are:
 *   - a 4-digit internal softphone extension (e.g. "1002")
 *   - a legacy user UUID (translated to an extension downstream)
 *   - an external phone number (10+ digits, optionally formatted / E.164)
 *
 * Anything else — notably the literal "Campaign" sentinel that DidRoute rows
 * carry when a route is campaign-driven — must never reach FreeSWITCH: it used
 * to be bridged as sofia/gateway/<gw>/Campaign, a guaranteed dead call.
 */

const EXTENSION_RE = /^\d{4}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A leg may carry FreeSWITCH per-leg variables in front of it,
 * `[x_leg_party=buyer:<id>,x_leg_number=<n>,leg_timeout=30]<n>` -- see
 * `taggedLeg` in services/routing.ts. Those commas are not leg separators, so
 * every split here skips over a bracketed block.
 */
const LEG_VARS_RE = /^\[[^\]]*\]/;

/** Split on `separator` at bracket depth zero. */
export function splitOutsideBrackets(value: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of value) {
    if (ch === '[') depth += 1;
    else if (ch === ']') depth = Math.max(0, depth - 1);
    if (ch === separator && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

/** The leg with any `[...]` per-leg variables removed. */
export function stripLegVars(token: string): string {
  return token.trim().replace(LEG_VARS_RE, '').trim();
}

export function isRoutableLeg(token: string): boolean {
  const t = stripLegVars(token);
  if (!t) return false;
  if (EXTENSION_RE.test(t)) return true;
  if (UUID_RE.test(t)) return true;
  const digits = t.replace(/\D/g, '');
  // External PSTN leg: full NANP/international length, and mostly digits
  // (reject alphabetic sentinels like "Campaign" even if they contain digits).
  if (digits.length >= 10 && digits.length <= 15 && /^[\d\s()+.-]+$/.test(t)) return true;
  return false;
}

export interface SanitizedDestination {
  /** Cleaned chain, empty string when nothing routable remains */
  destination: string;
  /** Legs removed with their original text */
  dropped: string[];
}

export function sanitizeDestinationString(raw: string | null | undefined): SanitizedDestination {
  const dropped: string[] = [];
  if (!raw) return { destination: '', dropped };

  const steps = splitOutsideBrackets(raw, '|')
    .map(step =>
      splitOutsideBrackets(step, ',')
        .map(leg => leg.trim())
        .filter(leg => {
          if (!leg) return false;
          if (isRoutableLeg(leg)) return true;
          dropped.push(leg);
          return false;
        })
        .join(',')
    )
    .filter(Boolean);

  return { destination: steps.join('|'), dropped };
}

/** Ring time for a step holding an agent, and for a buyer-only step. */
export const DEFAULT_AGENT_RING_SECONDS = 20;
export const DEFAULT_BUYER_RING_SECONDS = 30;

/** Who a leg rings, for its per-leg variables. */
export interface LegTag {
  /** `buyer:<id>` or `agent:<userId>`; omitted when nobody can be named. */
  party?: string | null;
  /** The buyer endpoint the leg belongs to, for a buyer leg. */
  target?: string | null;
  /** Seconds this leg rings before the step gives up on it. */
  timeout?: number | null;
}

function legVarValue(value: string): string {
  return value.replace(/[[\],|'"\s]/g, '');
}

/**
 * Tag every untagged leg of a destination chain with the variables
 * inbound_route.lua reads back off whichever leg answers:
 * `[x_leg_party=...,x_leg_target=...,x_leg_number=<leg>,leg_timeout=<s>]<leg>`.
 * A leg that is already tagged is left exactly as it is.
 */
export function tagDestinationLegs(destination: string, tagFor: (leg: string) => LegTag): string {
  return splitOutsideBrackets(destination, '|')
    .map(step =>
      splitOutsideBrackets(step, ',')
        .map(raw => {
          const leg = raw.trim();
          if (!leg || LEG_VARS_RE.test(leg)) return leg;
          const tag = tagFor(leg);
          const vars: string[] = [];
          if (tag.party) vars.push(`x_leg_party=${legVarValue(tag.party)}`);
          if (tag.target) vars.push(`x_leg_target=${legVarValue(tag.target)}`);
          vars.push(`x_leg_number=${legVarValue(leg)}`);
          if (tag.timeout) vars.push(`leg_timeout=${tag.timeout}`);
          return `[${vars.join(',')}]${leg}`;
        })
        .filter(Boolean)
        .join(',')
    )
    .filter(Boolean)
    .join('|');
}

/** Whether a leg is an internal softphone (extension or legacy user id). */
export function isInternalLeg(token: string): boolean {
  const t = stripLegVars(token);
  return EXTENSION_RE.test(t) || UUID_RE.test(t);
}

/**
 * Static carrier gateway chain for external (PSTN) inbound-forwarding legs.
 *
 * Superseded by the configurable per-tenant INBOUND waterfall — see
 * `getInboundCarrierChain` in services/carrier-routing.ts, which is what the
 * FreeSWITCH lookup now calls. This remains as the value used when no tenant
 * can be determined, and honors the same env override it always did so an
 * operator can still pin the chain without touching the database.
 */
export function getInboundExternalGateways(): string {
  return (
    process.env.INBOUND_EXTERNAL_GATEWAYS || 'fractel1,fractel2,fractel3,fractel4,fractel5,fractel6'
  );
}

/**
 * Placeholder the inbound Lua substitutes with the 10-digit destination.
 *
 * The API builds the whole leg list — including each carrier's number format,
 * which differs between carriers — and hands the Lua a template rather than a
 * list of gateway names. Formatting per carrier in Lua would mean shipping the
 * carrier table into the dialplan.
 */
export const INBOUND_DEST_PLACEHOLDER = '{DEST}';
