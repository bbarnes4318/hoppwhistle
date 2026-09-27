/**
 * The gates a BUYER endpoint must pass before inbound routing rings it.
 *
 * Agents have their own gates in `routing.ts` (licence, schedule,
 * registration, concurrency). Until these existed a buyer was held to almost
 * nothing on the inbound path: a buyer at its daily cap, closed for the night,
 * or out of prepaid money was rung anyway, and the call was either wasted on a
 * closed line or delivered to a buyer who could not pay for it.
 *
 * Each gate here mirrors a rule the ping/post path already enforces
 * (`auction-service.ts`, `post-service.ts`), so a buyer is held to the same
 * rules whichever door the call came in by.
 */

import { getRedisClient } from './redis.js';

export const DEFAULT_BUYER_TIMEZONE = 'America/New_York';

/** Split-shift hours: `{ mon: [{ start: '09:00', end: '17:00' }], ... }`. */
export type HoursOfOperation = Record<string, Array<{ start: string; end: string }>>;

export type CapPeriod = 'HOUR' | 'DAY' | 'MONTH';

interface LocalParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  weekday: string;
}

function localParts(now: Date, timezone: string): LocalParts {
  let tz = timezone || DEFAULT_BUYER_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    tz = DEFAULT_BUYER_TIMEZONE;
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    weekday: get('weekday').toLowerCase().slice(0, 3),
  };
}

function isHoursObject(value: unknown): value is HoursOfOperation {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Whether `now` falls inside one of today's windows, in the endpoint's zone.
 *
 * No hours configured means open around the clock -- the same reading the
 * auction uses. Hours configured with nothing for today means closed today.
 * Day keys are matched on their first three letters, so `mon` and `Monday`
 * both work.
 */
export function isWithinHoursOfOperation(
  hours: unknown,
  timezone: string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!isHoursObject(hours) || Object.keys(hours).length === 0) return true;

  const local = localParts(now, timezone || DEFAULT_BUYER_TIMEZONE);
  const current = `${local.hour}:${local.minute}`;

  const windows = Object.entries(hours)
    .filter(([day]) => day.toLowerCase().slice(0, 3) === local.weekday)
    .flatMap(([, value]) => (Array.isArray(value) ? value : []));

  return windows.some(
    window =>
      !!window &&
      typeof window.start === 'string' &&
      typeof window.end === 'string' &&
      current >= window.start &&
      current < window.end
  );
}

/** The period a delivery falls in, in the endpoint's zone, e.g. `DAY:2026-09-27`. */
export function capPeriodKey(
  period: string | null | undefined,
  timezone: string | null | undefined,
  now: Date = new Date()
): string {
  const local = localParts(now, timezone || DEFAULT_BUYER_TIMEZONE);
  switch (period) {
    case 'HOUR':
      return `HOUR:${local.year}-${local.month}-${local.day}T${local.hour}`;
    case 'MONTH':
      return `MONTH:${local.year}-${local.month}`;
    case 'DAY':
    default:
      return `DAY:${local.year}-${local.month}-${local.day}`;
  }
}

export function capCounterKey(endpointId: string, periodKey: string): string {
  return `routing:cap:${endpointId}:${periodKey}`;
}

/** Long enough to outlive its period, short enough not to pile up. */
function capCounterTtlSeconds(period: string | null | undefined): number {
  switch (period) {
    case 'HOUR':
      return 2 * 60 * 60;
    case 'MONTH':
      return 32 * 24 * 60 * 60;
    case 'DAY':
    default:
      return 2 * 24 * 60 * 60;
  }
}

/**
 * Calls this endpoint has taken in its current cap period.
 *
 * The Redis counter is the source; it is written by the CDR when this
 * endpoint answered. `null` means Redis could not be read, and the caller
 * falls back to `BuyerStats.capConsumedToday`.
 */
export async function readDeliveredCount(
  endpointId: string,
  period: string | null | undefined,
  timezone: string | null | undefined,
  now: Date = new Date()
): Promise<number | null> {
  try {
    const raw = await getRedisClient().get(
      capCounterKey(endpointId, capPeriodKey(period, timezone, now))
    );
    const parsed = raw === null || raw === undefined ? 0 : parseInt(String(raw), 10);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return null;
  }
}

/** Count one delivered call against the endpoint's cap. Never throws. */
export async function recordDelivery(
  endpointId: string,
  period: string | null | undefined,
  timezone: string | null | undefined,
  now: Date = new Date()
): Promise<void> {
  try {
    const redis = getRedisClient();
    const key = capCounterKey(endpointId, capPeriodKey(period, timezone, now));
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, capCounterTtlSeconds(period));
  } catch {
    // A lost increment under-counts one call; losing the CDR would be worse.
  }
}

type DecimalLike = { toString(): string } | number | string | null | undefined;

function toNumber(value: DecimalLike): number {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value.toString());
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * What the buyer would pay for this call, resolved in the order billing uses
 * (`billing-service.ts`): the campaign-buyer override, else the campaign's
 * default price, else -- when that is zero -- the endpoint's base price.
 */
export function expectedBuyerPrice(input: {
  campaignBuyerPrice?: DecimalLike;
  campaignDefaultPrice?: DecimalLike;
  endpointBasePrice?: DecimalLike;
}): number {
  let price =
    input.campaignBuyerPrice !== null && input.campaignBuyerPrice !== undefined
      ? toNumber(input.campaignBuyerPrice)
      : toNumber(input.campaignDefaultPrice);
  if (price === 0) price = toNumber(input.endpointBasePrice);
  return price;
}

/** An UPFRONT buyer must hold at least the price of the call it is about to take. */
export function hasFundsFor(
  billingType: string | null | undefined,
  walletBalance: DecimalLike,
  price: number
): boolean {
  if (billingType !== 'UPFRONT') return true;
  return toNumber(walletBalance) >= price;
}
