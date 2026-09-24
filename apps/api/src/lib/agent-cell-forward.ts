/**
 * Agent cell forwarding.
 *
 * An agency agent who takes calls on their own mobile rather than the browser
 * softphone stores that number in `users.metadata.cellForwardNumber`. Routing
 * then dials the cell as THAT AGENT's leg -- still held to their licence,
 * schedule, availability and busy checks -- and the CDR credits the answered
 * call to them (`calls.answeredByUserId`), so their numbers land on the
 * leaderboard and agent stats exactly as a softphone call would.
 *
 * Only NANP numbers are accepted: every carrier on the inbound waterfall is a
 * US trunk, and the FreeSWITCH leg builder renders destinations as 1XXXXXXXXXX.
 */

export const CELL_FORWARD_METADATA_KEY = 'cellForwardNumber';

/** `+1XXXXXXXXXX`, or null when the input is not a usable NANP number. */
export function normalizeCellForwardNumber(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || !/^[\d\s()+.-]+$/.test(trimmed)) return null;
  let digits = trimmed.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10) return null;
  // NANP area and exchange codes never start with 0 or 1.
  if (/^[01]/.test(digits) || /^[01]/.test(digits.slice(3))) return null;
  return `+1${digits}`;
}

/** The agent's cell-forward number from their `users.metadata`, if set and valid. */
export function readCellForwardNumber(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  return normalizeCellForwardNumber(
    (metadata as Record<string, unknown>)[CELL_FORWARD_METADATA_KEY]
  );
}

/** Last ten digits: the comparison key between a stored number and a dialed leg. */
export function cellKey(value: string | null | undefined): string {
  const digits = (value || '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/**
 * The number a bridged B-leg dialed, as a ten-digit key, from its channel name.
 *
 * Gateway legs are named `sofia/gateway/<gw>/<dest>` (sometimes with `@host`),
 * and `<dest>` may carry a carrier's tech prefix -- hence the last ten digits.
 * Internal softphone legs (`sofia/internal/...`) are not cell legs and give null.
 */
export function dialedKeyFromChannelName(channelName: string | null | undefined): string | null {
  const name = (channelName || '').trim();
  if (!name || name.startsWith('sofia/internal/')) return null;
  const lastSegment = name.split('/').pop() || '';
  const userPart = lastSegment.split('@')[0] || '';
  const key = cellKey(userPart);
  return key.length === 10 ? key : null;
}
