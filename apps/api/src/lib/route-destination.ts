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

export function isRoutableLeg(token: string): boolean {
  const t = token.trim();
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

  const steps = raw
    .split('|')
    .map(step =>
      step
        .split(',')
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
    process.env.INBOUND_EXTERNAL_GATEWAYS ||
    'fractel1,fractel2,fractel3,fractel4,fractel5,fractel6'
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
