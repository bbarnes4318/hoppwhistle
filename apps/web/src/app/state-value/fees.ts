/**
 * Fee resolution for the State Value Evaluator.
 *
 * The cost of a non-resident licence is not a property of the target state
 * alone: a dozen jurisdictions charge a non-resident whatever that applicant's
 * *home* state charges one of theirs. So every amount here is a function of
 * (target state, resident state), never a fixed column.
 */

/**
 * NIPR's transaction fee, charged once per application.
 *
 * Never multiplied by lines of authority — only the state portion scales.
 * NIPR raises this periodically, which is exactly why it is one named constant
 * rather than a literal repeated across the fee table.
 */
export const NIPR_TRANSACTION_FEE = 5.6;

/** A fee whose last verification is older than this is surfaced as stale. */
export const STALE_AFTER_DAYS = 180;

/** The authoritative source for every figure below, and for refreshing them. */
export const NIPR_STATE_REQUIREMENTS_URL = 'https://nipr.com/licensing-center/state-requirements';

/**
 * How a figure got here.
 *
 * `owner-supplied` means it came from the product owner's fee table and has NOT
 * been read back from the source URL. Nothing in this file is `source-verified`
 * yet: the session that entered these figures had no network route to nipr.com,
 * so no amount could be confirmed against its published page. Verifying them is
 * a prerequisite to launch, not a nicety — see docs in the admin view.
 */
export type Provenance = 'owner-supplied' | 'source-verified';

export interface FeeRecord {
  /**
   * Posted non-resident fee for the Life line of authority, excluding the NIPR
   * transaction fee. For a retaliatory state this is only the default, used
   * when that state's schedule has no row for the applicant's resident state.
   */
  postedFee: number;
  /** Charged per line of authority rather than per licence. */
  perLoa?: true;
  /** The amount is not fixed (Illinois prorates to the expiration date). */
  variable?: true;
  variableNote?: string;
  /** Fee depends on the applicant's resident state. */
  retaliatory?: true;
  /** ISO date the retaliatory regime takes effect, when it is not already in force. */
  retaliatoryFrom?: string;
  sourceUrl: string;
  /** ISO date this figure was last checked against sourceUrl. */
  verifiedOn: string;
  provenance: Provenance;
}

/** One retaliatory state's published schedule, keyed by resident state code. */
export interface RetaliatorySchedule {
  sourceUrl: string;
  verifiedOn: string;
  provenance: Provenance;
  /** Resident state code -> fee that state's residents are charged. */
  fees: Record<string, number>;
}

const OWNER_SUPPLIED = {
  sourceUrl: NIPR_STATE_REQUIREMENTS_URL,
  verifiedOn: '2026-09-08',
  provenance: 'owner-supplied' as const,
};

/**
 * Posted non-resident fees, individual producer, Life line of authority,
 * excluding the NIPR transaction fee.
 *
 * Five jurisdictions are deliberately absent — Alaska, Hawaii, Missouri, Nevada
 * and New York. They have no sourced figure, and a guess in a tool agents spend
 * their own money against is worse than a visible gap, so they resolve to
 * `unsourced` and are excluded from ranking rather than given a placeholder.
 */
// prettier-ignore
export const FEES: Record<string, FeeRecord> = {
  AL: { postedFee: 80, ...OWNER_SUPPLIED },
  AZ: { postedFee: 120, ...OWNER_SUPPLIED },
  AR: { postedFee: 70, ...OWNER_SUPPLIED },
  CA: { postedFee: 188, ...OWNER_SUPPLIED },
  CO: { postedFee: 71, ...OWNER_SUPPLIED },
  CT: { postedFee: 140, ...OWNER_SUPPLIED },
  DE: { postedFee: 125, ...OWNER_SUPPLIED },
  DC: { postedFee: 100, ...OWNER_SUPPLIED },
  FL: { postedFee: 55, ...OWNER_SUPPLIED },
  GA: { postedFee: 120, ...OWNER_SUPPLIED },
  ID: { postedFee: 80, ...OWNER_SUPPLIED },
  IL: { postedFee: 331.07, variable: true, variableNote: 'Prorated by days remaining to the assigned expiration date; 331.07 is a point-in-time amount, not a rate.', ...OWNER_SUPPLIED },
  IN: { postedFee: 185, retaliatory: true, ...OWNER_SUPPLIED },
  IA: { postedFee: 50, retaliatory: true, ...OWNER_SUPPLIED },
  KS: { postedFee: 50, ...OWNER_SUPPLIED },
  KY: { postedFee: 100, ...OWNER_SUPPLIED },
  LA: { postedFee: 75, ...OWNER_SUPPLIED },
  ME: { postedFee: 55, ...OWNER_SUPPLIED },
  MD: { postedFee: 54, ...OWNER_SUPPLIED },
  MA: { postedFee: 225, ...OWNER_SUPPLIED },
  MI: { postedFee: 10, ...OWNER_SUPPLIED },
  MN: { postedFee: 60, ...OWNER_SUPPLIED },
  MS: { postedFee: 100, ...OWNER_SUPPLIED },
  MT: { postedFee: 100, ...OWNER_SUPPLIED },
  NE: { postedFee: 50, retaliatory: true, retaliatoryFrom: '2026-07-17', ...OWNER_SUPPLIED },
  NH: { postedFee: 210, ...OWNER_SUPPLIED },
  NJ: { postedFee: 170, ...OWNER_SUPPLIED },
  NM: { postedFee: 30, ...OWNER_SUPPLIED },
  NC: { postedFee: 94, ...OWNER_SUPPLIED },
  ND: { postedFee: 100, ...OWNER_SUPPLIED },
  OH: { postedFee: 10, ...OWNER_SUPPLIED },
  OK: { postedFee: 120, ...OWNER_SUPPLIED },
  OR: { postedFee: 75, ...OWNER_SUPPLIED },
  PA: { postedFee: 110, ...OWNER_SUPPLIED },
  RI: { postedFee: 130, ...OWNER_SUPPLIED },
  SC: { postedFee: 25, ...OWNER_SUPPLIED },
  SD: { postedFee: 30, retaliatory: true, ...OWNER_SUPPLIED },
  TN: { postedFee: 50, retaliatory: true, ...OWNER_SUPPLIED },
  TX: { postedFee: 50, ...OWNER_SUPPLIED },
  UT: { postedFee: 75, ...OWNER_SUPPLIED },
  VT: { postedFee: 215, retaliatory: true, ...OWNER_SUPPLIED },
  VA: { postedFee: 15, ...OWNER_SUPPLIED },
  WA: { postedFee: 55, ...OWNER_SUPPLIED },
  WI: { postedFee: 75, ...OWNER_SUPPLIED },
  WV: { postedFee: 50, ...OWNER_SUPPLIED },
  WY: { postedFee: 150, ...OWNER_SUPPLIED },
};

/**
 * Jurisdictions that charge a non-resident their home state's rate.
 *
 * New York is on this list but has no posted fee either, so it resolves as
 * `unsourced` until both its fee and its schedule are obtained.
 */
export const RETALIATORY_CODES = ['IN', 'IA', 'NE', 'NY', 'SD', 'TN', 'VT'] as const;

/**
 * Published retaliatory schedules, keyed by target state then resident state.
 *
 * EMPTY BY DESIGN, NOT BY OVERSIGHT. Each schedule is a published table of
 * per-resident-state amounts; none could be retrieved here, because the network
 * egress policy in the session that built this blocked in.gov, secure.in.gov and
 * nipr.com outright. Retaliation is deliberately NOT approximated with a formula
 * such as max(homeFee, targetFee): that is wrong for a meaningful share of state
 * pairs, and wrong in a direction that costs agents money.
 *
 * Until a schedule is loaded here, every retaliatory state resolves through
 * `retaliatory-fallback` — posted fee, flagged unverified in the UI.
 *
 * To load one, add an entry; no other code changes:
 *   IN: { sourceUrl: '…/non-resident-retaliatory-fees/', verifiedOn: '2026-…',
 *         provenance: 'source-verified', fees: { AL: 90, AK: 120, … } }
 */
export const RETALIATORY_SCHEDULES: Record<string, RetaliatorySchedule> = {};

export type FeeBasis = 'posted' | 'retaliatory-schedule' | 'retaliatory-fallback' | 'unsourced';

export interface ResolvedFee {
  basis: FeeBasis;
  /** State portion after any per-LOA multiplication. Null when unsourced. */
  stateFee: number | null;
  niprFee: number;
  /** stateFee + NIPR fee. Null when unsourced. */
  total: number | null;
  /** False when the figure is a fallback or a guess the UI must flag. */
  verified: boolean;
  /** True when the amount is not fixed (Illinois). */
  variable: boolean;
  note: string | null;
}

export interface ResolveOptions {
  /** Lines of authority on the application. Only per-LOA states multiply. */
  loaCount?: number;
  /** Evaluation date, for regimes with a future effective date. */
  asOf?: Date;
}

function isRetaliatoryOn(record: FeeRecord, asOf: Date): boolean {
  if (!record.retaliatory) return false;
  if (!record.retaliatoryFrom) return true;
  return asOf >= new Date(`${record.retaliatoryFrom}T00:00:00Z`);
}

/**
 * The cost for an agent resident in `residentCode` to licence in `targetCode`.
 *
 * Resolution order: unsourced -> retaliatory schedule -> retaliatory fallback
 * (unverified) -> posted fee.
 */
export function resolveFee(
  targetCode: string,
  residentCode: string,
  { loaCount = 1, asOf = new Date() }: ResolveOptions = {}
): ResolvedFee {
  const record = FEES[targetCode];

  if (!record) {
    return {
      basis: 'unsourced',
      stateFee: null,
      niprFee: NIPR_TRANSACTION_FEE,
      total: null,
      verified: false,
      variable: false,
      note: 'No sourced fee. Take it from this state’s NIPR non-resident individual page.',
    };
  }

  let basis: FeeBasis = 'posted';
  let baseFee = record.postedFee;
  let verified = true;
  let note: string | null = record.variableNote ?? null;

  if (isRetaliatoryOn(record, asOf)) {
    const scheduled = RETALIATORY_SCHEDULES[targetCode]?.fees[residentCode];
    if (scheduled != null) {
      basis = 'retaliatory-schedule';
      baseFee = scheduled;
    } else {
      basis = 'retaliatory-fallback';
      verified = false;
      note =
        'Retaliatory state: charges what your home state charges its non-residents. No schedule row loaded for this resident state, so the posted fee is shown as a placeholder.';
    }
  }

  // Only the state portion scales with lines of authority; the NIPR
  // transaction fee is charged once per application.
  const stateFee = record.perLoa ? baseFee * Math.max(1, loaCount) : baseFee;

  return {
    basis,
    stateFee,
    niprFee: NIPR_TRANSACTION_FEE,
    total: stateFee + NIPR_TRANSACTION_FEE,
    verified,
    variable: record.variable === true,
    note,
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
