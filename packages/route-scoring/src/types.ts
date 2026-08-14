/**
 * Phase 5 — adaptive route scoring: the data contract.
 *
 * Normative spec: `phase-5-route-scoring-spec.md`.
 *
 * Everything here is data. The scorer that consumes it is PURE: no I/O, no
 * `Date.now()`, no `Math.random()`. `nowMs` and `rng` are inputs. That is what
 * makes replay, shadow-mode comparison and the deterministic simulator
 * possible, and it means the highest-risk logic in the routing path is testable
 * on a Windows dev checkout with no Asterisk, no carrier and no lab box.
 *
 * This is the same contract `apps/dialer-v2/src/pacing/controller.ts` holds to,
 * for the same reasons. Read that file before changing anything here.
 */

/** Matches `Confidence` in the pacing controller. Deliberately the same three. */
export type Confidence = 'LOW' | 'MEDIUM' | 'HIGH';

/**
 * Which DID the dialplan picked, and why.
 *
 * `npa_match` is a DID local to the destination. `overflow` is anything else —
 * the pool for that NPA was exhausted and the call went out on a non-local
 * number. These are NOT the same experiment (§2.4) and are never pooled.
 */
export type DidSelectionReason = 'npa_match' | 'overflow';

/**
 * Composite key for the routing table and the traffic weights:
 * `<stratum>/<prefix>`.
 *
 * The scorer emits a table per (stratum, prefix), not per prefix alone. That is
 * possible because the dialplan knows which stratum it is in BEFORE route
 * selection: `SBC_DID_REASON` is assigned at extensions.conf.tpl:402/:409, the
 * DID pick Gosub runs at :403/:410, and the dial loop does not begin until
 * n(dial) at :451 — where the variable is still live (:458).
 *
 * It matters because production ran 60.6% overflow. Ranking on `npa_match`
 * alone would rank on a minority of live traffic, and the two strata routinely
 * disagree: the §2.4 fixture has one route at 60% npa_match and 5% overflow.
 *
 * This shape maps straight onto the astdb layout — `sbc/route/npa_match/<digits>`
 * and `sbc/route/overflow/<digits>` — so the dialplan still does three DB()
 * reads, with the stratum as a key prefix.
 */
export function tableKey(stratum: DidSelectionReason, prefix: string): string {
  return `${stratum}/${prefix}`;
}

/** Inverse of {@link tableKey}. Returns null for anything not in that shape. */
export function parseTableKey(key: string): { stratum: DidSelectionReason; prefix: string } | null {
  const slash = key.indexOf('/');
  if (slash <= 0) return null;
  const stratum = key.slice(0, slash);
  if (stratum !== 'npa_match' && stratum !== 'overflow') return null;
  return { stratum, prefix: key.slice(slash + 1) };
}

/**
 * One CDR row, as the scorer needs it.
 *
 * IMPORTANT: none of these columns exist in CDR yet. Phase 1 in the `voip` repo
 * is adding them and has not shipped. This interface is therefore the contract
 * that side is held to, not a description of something already emitted. If a
 * field here disagrees with what Phase 1 ships, this file is the spec and the
 * emitter is the bug.
 */
export interface RouteObservation {
  /**
   * Empty when the call reached a `Dial()`. ANY non-empty value excludes the row
   * entirely — from numerator and denominator both (§2.3).
   *
   * Known values at time of writing: KILLSWITCH, NOT_NANP, BLOCKED_NPA,
   * CPS_LIMIT, CONCURRENCY_CAP, BAD_CALLERID, NO_DID_AVAILABLE,
   * ALL_ROUTES_FAILED. Do NOT enumerate these defensively anywhere — a new
   * reject reason added upstream must exclude its rows automatically, and it
   * will only do that if the test is "non-empty", full stop. Matching against a
   * known-values list is how an unrecognised reason silently becomes an
   * answered-call denominator.
   */
  reject_reason: string;

  /** Stratum key. Never pooled across values. See {@link DidSelectionReason}. */
  did_selection_reason: DidSelectionReason;

  /**
   * Opaque hash of the active route and proxy set. Compare for equality only;
   * never parse it, never order by it, never extract meaning from its bytes.
   * A route's identity is not stable across a change to this (§2.2).
   */
  topology_epoch: string;

  /**
   * 1-based. Only `attempt_index === 1` feeds the production estimate (§2.5).
   * Later attempts are drawn from a systematically harder population — every one
   * of those calls already failed at least once — and are tracked separately.
   */
  attempt_index: number;

  /** Matches {@link RouteConfig.name}. */
  route_name: string;

  /** 3-digit NANP area code. Doubles as the routing-table prefix. */
  destination_npa: string;

  answered: boolean;

  sip_response: number | null;

  dialed_seconds: number;

  /**
   * When the attempt happened.
   *
   * NOT in the Phase 1 column list as originally handed over, and added here
   * deliberately: `windowStartMs` (§2.1) is meaningless without a per-row
   * timestamp to compare against. Without this the scorer cannot tell
   * post-Phase-0 rows from the pre-Phase-0 rows whose amplification made them
   * non-comparable, which is the whole point of having a window. Phase 1 must
   * emit it.
   */
  observedAtMs: number;
}

/** A route the scorer may place in the table. */
export interface RouteConfig {
  name: string;
  carrier: string;
  deck: string;
  /**
   * Cost per minute, keyed by prefix. A route with no entry for a prefix is not
   * a candidate for that prefix.
   */
  ratesByPrefix: Map<string, number>;
}

/**
 * Why the scorer produced the table it produced.
 *
 * Mirrors `PacingReason` in the pacing controller, and exists for the same
 * reason: every decision carries the constraint that actually bound it, so the
 * operator never has to guess which of a dozen inputs was the deciding one.
 */
export enum RouteReason {
  /** The post-deploy window does not hold enough rows to score at all (§2.1). */
  INSUFFICIENT_POST_DEPLOY_DATA = 'INSUFFICIENT_POST_DEPLOY_DATA',
  /** The topology epoch moved; prior-epoch evidence is weakened, not pooled (§2.2). */
  EPOCH_CHANGED = 'EPOCH_CHANGED',
  /** The blended-rate ceiling forced at least one prefix off its best route (§3.4). */
  BLEND_CEILING_BINDING = 'BLEND_CEILING_BINDING',
  /** No configured route carries a rate for a prefix that has traffic. */
  NO_ELIGIBLE_ROUTE = 'NO_ELIGIBLE_ROUTE',
  /** Candidates are statistically indistinguishable; ordering is arbitrary. */
  ALL_ROUTES_EQUIVALENT = 'ALL_ROUTES_EQUIVALENT',
  /** Thompson sampling put a route on top that the point estimate would not have (§3.3). */
  EXPLORATION_DRIVEN = 'EXPLORATION_DRIVEN',
  /** The new table did not beat the live one by the hold-down margin (§3.5). */
  HELD_AT_PREVIOUS_TABLE = 'HELD_AT_PREVIOUS_TABLE',
  /** Nothing bound the decision: the table is the measured ASR ordering. */
  SCORED_ON_MEASURED_ASR = 'SCORED_ON_MEASURED_ASR',
  /** An overflow cell had no data of its own; it inherited the npa_match order. */
  OVERFLOW_FALLBACK_TO_NPA_MATCH = 'OVERFLOW_FALLBACK_TO_NPA_MATCH',
}

/** Plain-English rendering, for the operator report. Mirrors `PACING_REASON_TEXT`. */
export const ROUTE_REASON_TEXT: Record<RouteReason, string> = {
  [RouteReason.INSUFFICIENT_POST_DEPLOY_DATA]:
    'Not enough post-deploy call data to score routes; the previous table stands.',
  [RouteReason.EPOCH_CHANGED]:
    'The route or proxy topology changed; prior observations are treated as a weak prior, not as evidence.',
  [RouteReason.BLEND_CEILING_BINDING]:
    'The blended-rate ceiling is binding; at least one prefix was moved off its best-performing route.',
  [RouteReason.NO_ELIGIBLE_ROUTE]: 'No configured route carries a rate for a prefix with traffic.',
  [RouteReason.ALL_ROUTES_EQUIVALENT]:
    'Candidate routes are statistically indistinguishable on the available data.',
  [RouteReason.EXPLORATION_DRIVEN]:
    'At least one prefix is being explored: an uncertain route was ranked above the current best estimate.',
  [RouteReason.HELD_AT_PREVIOUS_TABLE]:
    'The new table did not beat the live table by the required margin; nothing changed.',
  [RouteReason.SCORED_ON_MEASURED_ASR]:
    'Routes are ordered by measured answer-seizure ratio; no constraint was binding.',
  [RouteReason.OVERFLOW_FALLBACK_TO_NPA_MATCH]:
    'At least one overflow stratum has no observations of its own and is following the local-presence ordering.',
};

/**
 * Tunables. Every threshold in the scorer lives here rather than as a literal,
 * so that a policy change is a config diff and not a code change.
 */
export interface RouteScoringPolicy {
  /**
   * Mean of the top-level (fleet) prior, and its weight in pseudo-observations.
   *
   * Deliberately NOT `PRIOR_ALPHA = 2 / PRIOR_BETA = 18` from the pacing
   * controller. That prior encodes a 10% live-answer rate, which is right for
   * pacing and wrong for route ASR — an answer-seizure ratio in the 30–60% band
   * is the normal operating range. Reusing the pacing prior here would drag
   * every thin cell toward 10% and make good routes look broken.
   */
  fleetPriorMean: number;
  fleetPriorWeight: number;

  /**
   * Ceiling on the weight any parent level may lend its children.
   *
   * Without a ceiling a fleet with 200,000 observations would swamp a cell with
   * 300 of its own, and the hierarchy would silently become pooling — the exact
   * failure §2.4 and §2.5 exist to prevent, arriving vertically instead of
   * horizontally.
   */
  maxParentPriorWeight: number;

  /**
   * Fraction of a parent's evidence that counts toward a child's CONFIDENCE.
   *
   * Strictly below 1: a parent aggregates across the very strata its child
   * distinguishes, so parent evidence is genuinely worth less to the child than
   * the child's own. This is what stops a well-observed fleet from lending
   * unearned confidence to a cell nobody has dialled.
   */
  parentEvidenceDiscount: number;

  /**
   * Weight multiplier applied to observations from a superseded topology epoch.
   *
   * Below 1 and above 0: off-epoch rows are a weaker prior for the current
   * epoch, not equivalent evidence, and never silently pooled (§2.2).
   */
  offEpochWeight: number;

  /**
   * Half-life of an observation's weight, by age.
   *
   * The hard window start (§2.1) and this decay do different jobs and both are
   * needed. The window start is a CLIFF at the Phase 0 deploy: pre-deploy
   * attempts came from a different process — amplification 2.48x on 08-11
   * against 1.67x on 08-12 as the gateway count fell — and are not comparable at
   * any weight. Inside the window, evidence is comparable but not equally
   * current, and carrier route quality genuinely changes underneath you.
   *
   * Without decay the window only ever grows, so a route that degrades takes
   * progressively longer to correct: after 90 days of history, a week of bad
   * performance is 7% of the evidence. With a half-life the correction time is
   * constant no matter how long the window has been open.
   */
  halfLifeMs: number;

  /** Confidence ladder. Both the own-observation and total-evidence tests must pass. */
  minObservationsForMedium: number;
  minObservationsForHigh: number;
  minEvidenceForMedium: number;
  minEvidenceForHigh: number;

  /** In-window, in-epoch, first-attempt, non-rejected rows required to score at all. */
  minPostDeployObservations: number;

  /** Projected-ASR gain required before the live table is replaced (§3.5). */
  holdDownMargin: number;

  /**
   * Emergency cap on the share of prefixes that may be exploration-driven.
   * `null` means off, which is the default — Thompson sampling is
   * self-extinguishing and does not need an epsilon to tune (§3.3). This exists
   * only so an operator can clamp it during an incident.
   */
  explorePercentCap: number | null;

  /**
   * ACD carries an artifact rather than information until the 44–47s ceiling is
   * explained by the carrier (§2.6). Compute and report it; do not score on it.
   */
  useAcdInScore: boolean;
}

export const DEFAULT_ROUTE_SCORING_POLICY: RouteScoringPolicy = Object.freeze({
  // 35% is the middle of the observed ASR band, held at a weight of 40
  // pseudo-observations: firm enough to stop a 3-call cell reading as 100%,
  // weak enough to wash out inside a single night of real traffic.
  fleetPriorMean: 0.35,
  fleetPriorWeight: 40,
  maxParentPriorWeight: 60,
  parentEvidenceDiscount: 0.25,
  offEpochWeight: 0.25,
  // Seven days. Long enough that a quiet weekend does not erase the week, short
  // enough that a route which degrades is demoted inside a fortnight.
  halfLifeMs: 7 * 86_400_000,
  minObservationsForMedium: 30,
  minObservationsForHigh: 200,
  minEvidenceForMedium: 60,
  minEvidenceForHigh: 400,
  minPostDeployObservations: 200,
  holdDownMargin: 0.01,
  explorePercentCap: null,
  useAcdInScore: false,
});

/** Per-prefix change between the live table and the proposed one. */
export interface RoutePrefixDiff {
  prefix: string;
  from: string[];
  to: string[];
  /** True when the first entry changed — the only change that moves traffic today. */
  leadChanged: boolean;
}

export interface RouteTableDiff {
  changed: RoutePrefixDiff[];
  added: string[];
  removed: string[];
  /** True when nothing at all moved. */
  identical: boolean;
}

/** Retry performance, reported but never pooled into the production estimate (§2.5). */
export interface RetryStats {
  attempts: number;
  answered: number;
  /** Answer rate on attempts after the first. Informational only. */
  rescueRate: number;
}

/** What a route looked like on the data, per prefix. Carried for the report. */
export interface RouteScoreDetail {
  routeName: string;
  prefix: string;
  /** Which stratum this row scores. Scored and ranked separately (§2.4). */
  stratum: DidSelectionReason;
  /** Raw call count. What the operator means by "how many calls". */
  observations: number;
  answered: number;
  /**
   * Age-decayed call count — what the estimator actually weighted. Always at or
   * below `observations`; the gap is how stale this cell's evidence is.
   */
  effectiveObservations: number;
  posteriorMean: number;
  /** What Thompson sampling drew this run. Drives ranking (§3.3). */
  sampledAsr: number;
  /**
   * Upper credible bound. Weights the blend projection (§3.4) — billed minutes
   * scale with ASR, so understating it understates projected cost. See the note
   * on `SAFETY_Z` in `estimator.ts`; the sign is deliberate.
   */
  upperBoundAsr: number;
  /** Lower credible bound. Reported for interval width; drives the hold-down. */
  lowerBoundAsr: number;
  confidence: Confidence;
  ratePerMinute: number;
  /** `rate ÷ ASR` — the metric the operator actually needs (§5). */
  costPerConnectedMinute: number;
  /**
   * Average call duration on answered calls. Computed and reported, never
   * scored: calls cap at 44–47s across 8,000+ answered calls and the cause is
   * open with the carrier, so this currently carries an artifact rather than
   * information (§2.6). Gated behind `RouteScoringPolicy.useAcdInScore`.
   */
  acdSeconds: number;
  /** True when this row is an overflow cell following the npa_match ordering. */
  inheritedFromNpaMatch: boolean;
}

export interface RouteScoringInputs {
  nowMs: number;
  /** Phase 0 deploy time. NOT "7 days ago" — see §2.1. */
  windowStartMs: number;
  /** Topology hash considered current. Rows from other epochs are down-weighted. */
  currentEpoch: string;
  observations: RouteObservation[];
  routes: RouteConfig[];
  /** Blended-rate ceiling, dollars per minute. */
  maxBlend: number;
  /**
   * Recent call volume keyed by {@link tableKey} — per (stratum, prefix), not
   * per prefix. Weights the blend and the projected ASR.
   *
   * Per-stratum because the split is not incidental: production ran 60.6%
   * overflow, and the two strata can carry materially different ASR on the same
   * route. Weighting a minute-weighted blend by npa_match volume alone would
   * misprice the majority of live traffic.
   */
  trafficWeights: Map<string, number>;
  /** Injected and seeded, so the whole scorer stays deterministic and replayable. */
  rng: () => number;
  /** The table currently loaded in astdb, keyed by {@link tableKey}. */
  currentTable: Map<string, string[]>;
  policy: RouteScoringPolicy;
}

export interface RouteDecision {
  /**
   * {@link tableKey} -> ordered route names. The artifact that becomes
   * `routes.csv`, and thence `sbc/route/<stratum>/<prefix>` in astdb.
   */
  table: Map<string, string[]>;
  projectedBlend: number;
  projectedAsr: number;
  confidence: Confidence;
  /** The single constraint that bound this decision. */
  reason: RouteReason;
  /** Everything that applied, most-binding first. `reason` is `reasons[0]`. */
  reasons: RouteReason[];
  diff: RouteTableDiff;
  /** Per-route, per-prefix detail for the operator report. */
  details: RouteScoreDetail[];
  retry: RetryStats;
  /** Rows dropped for a non-empty `reject_reason`. Never scored (§2.3). */
  rejectedRows: number;
  /** Rows dropped for falling outside the post-deploy window (§2.1). */
  outOfWindowRows: number;
  /** Rows from a superseded topology epoch, down-weighted rather than pooled (§2.2). */
  offEpochRows: number;
  /** Rows scored: in-window, in-epoch, first-attempt, not rejected. */
  scoredRows: number;
  /** Table keys whose lead route came from exploration rather than the point estimate. */
  exploredPrefixes: string[];
  /**
   * Sum of age-decay weights over the scored rows. Compare against `scoredRows`
   * to see how current the evidence is: equal means everything is fresh, half
   * means the body of the evidence is about one half-life old.
   */
  effectiveScoredRows: number;
}
