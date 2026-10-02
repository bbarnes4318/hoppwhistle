/**
 * Licensing fees for the State Value Evaluator, read from the v3 data drop.
 *
 * The cost of a non-resident licence is not a property of the target state
 * alone: five jurisdictions charge a non-resident whatever that applicant's
 * home state charges one of theirs. Every amount is therefore a function of
 * (target state, resident state).
 *
 * `licensing-fees.json` is the published drop, kept verbatim so the next one
 * is a file swap. Nothing here fills gaps or guesses: a retaliatory state with
 * no schedule row for the applicant's home state THROWS rather than falling
 * back to a base rate, because a plausible wrong number in a tool agents spend
 * their own money against is worse than a loud failure.
 */
import raw from './licensing-fees.json';

export interface Jurisdiction {
  code: string;
  name: string;
  totalPopulation: number;
  /** Residents aged 55-80 — the final expense target market. */
  seniorPopulation55to80: number;
  /** Charges a non-resident whatever their home state charges. */
  isRetaliatory: boolean;
  /**
   * The posted fee, excluding the NIPR transaction fee.
   *
   * Null for all five retaliatory jurisdictions, by design rather than as a
   * gap: four of them publish no usable base rate, and Indiana's schedule
   * already folds its $90 base in wherever no higher retaliatory amount
   * applies. A null here is only ever read through a schedule.
   */
  flatFee: number | null;
  feeIsFallback: boolean;
  /** The state portion scales with lines of authority; the NIPR fee never does. */
  perLineOfAuthority: boolean;
  /** The amount is not fixed — Illinois prorates, New York halves and varies. */
  prorated: boolean;
  sourceUrl: string;
  /** ISO date this figure was last checked against sourceUrl. */
  lastVerified: string;
}

export interface LicensingFeeData {
  schemaVersion: number;
  lastVerified: string;
  niprTransactionFee: number;
  licenseClass: string;
  lineOfAuthority: string;
  transactionType: string;
  notes: Record<string, string>;
  jurisdictions: Jurisdiction[];
  /** Target state code -> resident state code -> that applicant's fee. */
  retaliatorySchedules: Record<string, Record<string, number>>;
}

export const DATA = raw as unknown as LicensingFeeData;

/**
 * NIPR's transaction fee, charged once per application and never multiplied by
 * lines of authority. Read from the drop so a rate change is a data edit.
 */
export const NIPR_TRANSACTION_FEE = DATA.niprTransactionFee;

/** A figure whose last verification is older than this is surfaced as stale. */
export const STALE_AFTER_DAYS = 180;

export const JURISDICTIONS: Jurisdiction[] = DATA.jurisdictions;

const BY_CODE = new Map(JURISDICTIONS.map(j => [j.code, j]));

export function jurisdiction(code: string): Jurisdiction | undefined {
  return BY_CODE.get(code);
}

/** Notes keyed loosely by state, for the prorated jurisdictions that need one. */
export const PRORATION_NOTES: Record<string, string> = {
  IL: DATA.notes.illinois,
  NY: DATA.notes.newYork,
};

export type FeeBasis = 'flat' | 'retaliatory';

export interface ResolvedFee {
  basis: FeeBasis;
  /** State portion after any per-line-of-authority multiplication. */
  stateFee: number;
  niprFee: number;
  total: number;
  /** True when the stored amount is an upper bound or varies per applicant. */
  prorated: boolean;
  perLineOfAuthority: boolean;
  sourceUrl: string;
  lastVerified: string;
}

export interface ResolveOptions {
  /** Lines of authority on the application. Only per-LOA states multiply. */
  loaCount?: number;
}

/**
 * The cost for an agent resident in `residentCode` to licence in `targetCode`.
 *
 * Throws rather than guessing when the data cannot answer: an unknown state, a
 * retaliatory state with no row for this home state, or a non-retaliatory
 * state with no posted fee. Each is a data defect, and a thrown error is how
 * it gets noticed instead of quietly becoming a wrong dollar amount.
 */
export function resolveFee(
  targetCode: string,
  residentCode: string,
  { loaCount = 1 }: ResolveOptions = {}
): ResolvedFee {
  const target = BY_CODE.get(targetCode);
  if (!target) {
    throw new Error(`No licensing record for ${targetCode}.`);
  }
  if (targetCode === residentCode) {
    // An agent needs no non-resident licence at home, and no retaliatory
    // schedule carries a row for its own state. Callers exclude the resident
    // state; reaching here is a bug, so it says so.
    throw new Error(`${targetCode} is the resident state — it has no non-resident fee.`);
  }

  let basis: FeeBasis;
  let baseFee: number;

  if (target.isRetaliatory) {
    const scheduled = DATA.retaliatorySchedules[targetCode]?.[residentCode];
    if (scheduled == null) {
      throw new Error(
        `${targetCode} is retaliatory but its schedule has no row for resident state ${residentCode}.`
      );
    }
    basis = 'retaliatory';
    baseFee = scheduled;
  } else {
    if (target.flatFee == null) {
      throw new Error(`${targetCode} is not retaliatory but carries no posted fee.`);
    }
    basis = 'flat';
    baseFee = target.flatFee;
  }

  // Only the state portion scales with lines of authority; the NIPR
  // transaction fee is charged once per application.
  const stateFee = target.perLineOfAuthority ? baseFee * Math.max(1, loaCount) : baseFee;

  return {
    basis,
    stateFee,
    niprFee: NIPR_TRANSACTION_FEE,
    total: stateFee + NIPR_TRANSACTION_FEE,
    prorated: target.prorated,
    perLineOfAuthority: target.perLineOfAuthority,
    sourceUrl: target.sourceUrl,
    lastVerified: target.lastVerified,
  };
}

/** Days since a figure was last verified. */
export function daysSince(isoDate: string, asOf: Date = new Date()): number {
  const then = new Date(`${isoDate}T00:00:00Z`).getTime();
  return Math.floor((asOf.getTime() - then) / 86_400_000);
}

export function isStale(isoDate: string, asOf: Date = new Date()): boolean {
  return daysSince(isoDate, asOf) > STALE_AFTER_DAYS;
}
