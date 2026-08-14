/**
 * How often, and how many times, an uncertain attempt may be looked at again.
 *
 * ── Why this is a gate too ───────────────────────────────────────────────────
 *
 * The reconciler cannot place a call — it holds a port that refuses every
 * command that could. But it *can* end a reservation, and ending a reservation
 * returns a lead to the dialable pool. That is one step removed from dialing
 * somebody, so it gets the same treatment as the Hopper: off unless explicitly
 * enabled, and a value that is present but not exactly `true` or `false` is a
 * refusal that names the variable rather than a silent fallback.
 *
 * ── Why the numbers are parsed strictly ──────────────────────────────────────
 *
 * `parseInt('30s', 10)` is `30`. A deployment meaning thirty seconds would get
 * thirty milliseconds, and a reconciler that re-checks every thirty milliseconds
 * is a denial-of-service against its own database and, once a real port is
 * configured, against a production switch. Digits only, anchored, and the result
 * must be a safe integer inside a declared range.
 *
 * The boolean reader is duplicated from `hopper-gate.ts` rather than imported.
 * That module's error type is named for the Hopper, and a reconciler refusing to
 * start should not report a `HopperConfigurationError`; six lines is a smaller
 * cost than a misleading error class in an operator's logs.
 */

export type PolicyEnv = Record<string, string | undefined>;

/** The exact variable names. Operators grep for these. */
export const RECONCILER_ENV = {
  enabled: 'RECONCILER_ENABLED',
  initialDelayMs: 'RECONCILER_INITIAL_DELAY_MS',
  maxDelayMs: 'RECONCILER_MAX_DELAY_MS',
  backoffMultiplier: 'RECONCILER_BACKOFF_MULTIPLIER',
  maxAttempts: 'RECONCILER_MAX_ATTEMPTS',
  maxEvidenceAgeMs: 'RECONCILER_MAX_EVIDENCE_AGE_MS',
  leaseMs: 'RECONCILER_LEASE_MS',
  batchSize: 'RECONCILER_BATCH_SIZE',
} as const;

/** A configuration value the reconciler cannot act on. Names the variable, never the value. */
export class ReconciliationConfigurationError extends Error {
  constructor(
    readonly variable: string,
    readonly constraint: string
  ) {
    super(`${variable} is not usable: ${constraint}`);
    this.name = 'ReconciliationConfigurationError';
  }
}

/** Absent or empty is "not configured". Anything else must be exactly true/false. */
export function readStrictBoolean(env: PolicyEnv, name: string): boolean | undefined {
  const raw = env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  throw new ReconciliationConfigurationError(name, 'expected exactly "true" or "false"');
}

/** Digits only, anchored. No sign, no decimal point, no unit suffix, no whitespace inside. */
const DIGITS_ONLY = /^[0-9]+$/;

export function readStrictInteger(
  env: PolicyEnv,
  name: string,
  bounds: { min: number; max: number; fallback: number }
): number {
  const raw = env[name];
  if (raw === undefined) return bounds.fallback;
  const trimmed = raw.trim();
  if (trimmed === '') return bounds.fallback;

  if (!DIGITS_ONLY.test(trimmed)) {
    throw new ReconciliationConfigurationError(
      name,
      'expected a whole number of digits with no sign, unit, or separator'
    );
  }
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) {
    throw new ReconciliationConfigurationError(name, 'the value is too large to be exact');
  }
  if (value < bounds.min || value > bounds.max) {
    // The range is named; the value is not, in keeping with the rest of the
    // configuration surface never echoing what an operator typed.
    throw new ReconciliationConfigurationError(
      name,
      `expected a value between ${bounds.min} and ${bounds.max}`
    );
  }
  return value;
}

export interface ReconciliationPolicy {
  enabled: boolean;
  /** Delay before the first re-check. Never zero — see `HARD_MIN_DELAY_MS`. */
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  /** Total automatic runs, including the first. Past this, an operator decides. */
  maxAttempts: number;
  maxEvidenceAgeMs: number;
  /** How long one reconciler holds a claim before another may take it. */
  leaseMs: number;
  batchSize: number;
}

/**
 * A floor, not a default.
 *
 * A zero or near-zero initial delay turns the scheduler into a hot loop that
 * re-queries the same unresolvable attempt thousands of times a second. One
 * second is far below any plausible ingestion lag and far above a busy loop.
 */
export const HARD_MIN_DELAY_MS = 1_000;

export const DEFAULT_POLICY: Readonly<Omit<ReconciliationPolicy, 'enabled'>> = Object.freeze({
  initialDelayMs: 15_000,
  maxDelayMs: 300_000,
  backoffMultiplier: 2,
  maxAttempts: 6,
  // Six hours. Past this, ingestion lag is not a credible explanation and the
  // ledger window (were one to exist) would have rolled past the answer.
  maxEvidenceAgeMs: 6 * 60 * 60 * 1000,
  leaseMs: 30_000,
  batchSize: 25,
});

export type PolicyResolution =
  | { ok: true; policy: ReconciliationPolicy }
  | { ok: false; reason: string };

/**
 * Resolve the policy, failing closed.
 *
 * A malformed value disables the reconciler and reports why. It does not fall
 * back to the default: an operator who wrote `RECONCILER_MAX_ATTEMPTS=six` has
 * an opinion about the retry budget, and quietly substituting six is
 * indistinguishable from honouring them right up until it is not.
 */
export function resolveReconciliationPolicy(env: PolicyEnv): PolicyResolution {
  try {
    const enabled = readStrictBoolean(env, RECONCILER_ENV.enabled) === true;

    const initialDelayMs = readStrictInteger(env, RECONCILER_ENV.initialDelayMs, {
      min: HARD_MIN_DELAY_MS,
      max: 60 * 60 * 1000,
      fallback: DEFAULT_POLICY.initialDelayMs,
    });
    const maxDelayMs = readStrictInteger(env, RECONCILER_ENV.maxDelayMs, {
      min: HARD_MIN_DELAY_MS,
      max: 24 * 60 * 60 * 1000,
      fallback: DEFAULT_POLICY.maxDelayMs,
    });
    const backoffMultiplier = readStrictInteger(env, RECONCILER_ENV.backoffMultiplier, {
      min: 1,
      max: 10,
      fallback: DEFAULT_POLICY.backoffMultiplier,
    });
    const maxAttempts = readStrictInteger(env, RECONCILER_ENV.maxAttempts, {
      // At least one automatic look; an unbounded budget is not offered at all.
      min: 1,
      max: 100,
      fallback: DEFAULT_POLICY.maxAttempts,
    });
    const maxEvidenceAgeMs = readStrictInteger(env, RECONCILER_ENV.maxEvidenceAgeMs, {
      min: 60_000,
      max: 30 * 24 * 60 * 60 * 1000,
      fallback: DEFAULT_POLICY.maxEvidenceAgeMs,
    });
    const leaseMs = readStrictInteger(env, RECONCILER_ENV.leaseMs, {
      min: HARD_MIN_DELAY_MS,
      max: 60 * 60 * 1000,
      fallback: DEFAULT_POLICY.leaseMs,
    });
    const batchSize = readStrictInteger(env, RECONCILER_ENV.batchSize, {
      min: 1,
      max: 500,
      fallback: DEFAULT_POLICY.batchSize,
    });

    if (maxDelayMs < initialDelayMs) {
      return {
        ok: false,
        reason: `${RECONCILER_ENV.maxDelayMs} is smaller than ${RECONCILER_ENV.initialDelayMs}; the backoff ceiling cannot be below its floor`,
      };
    }

    return {
      ok: true,
      policy: {
        enabled,
        initialDelayMs,
        maxDelayMs,
        backoffMultiplier,
        maxAttempts,
        maxEvidenceAgeMs,
        leaseMs,
        batchSize,
      },
    };
  } catch (error) {
    return { ok: false, reason: (error as ReconciliationConfigurationError).message };
  }
}

/**
 * Delay before the run numbered `priorAttempts + 1`.
 *
 * Staged exponential, clamped at both ends. The floor matters as much as the
 * ceiling: a multiplier of 1 is legal (a fixed interval), and without the floor
 * a fixed interval of zero would be too.
 */
export function nextDelayMs(policy: ReconciliationPolicy, priorAttempts: number): number {
  const exponent = Math.max(0, Math.min(priorAttempts, 32));
  const raw = policy.initialDelayMs * Math.pow(policy.backoffMultiplier, exponent);
  if (!Number.isFinite(raw)) return policy.maxDelayMs;
  return Math.max(HARD_MIN_DELAY_MS, Math.min(policy.maxDelayMs, Math.floor(raw)));
}
