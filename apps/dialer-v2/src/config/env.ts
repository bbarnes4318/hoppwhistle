/**
 * Dialer V2 — strict environment parsing.
 *
 * ── Why `parseInt` is the wrong tool for configuration ───────────────────────
 *
 * Three separate readers in this service used it, all with the same shape:
 *
 *     const n = Number.parseInt(env[name] ?? '', 10);
 *     return Number.isFinite(n) && n > 0 ? n : fallback;
 *
 * `parseInt` is a *prefix* parser. It reads as many leading digits as it finds
 * and discards the rest without complaint, so every one of these was accepted:
 *
 *     "200ms"      → 200      the unit is dropped; looks deliberate
 *     "10 seconds" → 10       ten milliseconds, not ten seconds
 *     "1.9"        → 1        truncated
 *     "0x10"       → 0        then rejected as non-positive, so → fallback
 *     "1e3"        → 1        one, not one thousand
 *
 * Two failure modes, both silent. A value like `"200ms"` is honoured as a
 * *different number* than the operator wrote. A value like `"abc"` falls through
 * to the fallback, so the config file says one thing and the process does
 * another, and nothing anywhere reports the disagreement. `"10 seconds"` is the
 * worst of them: it produces a 10ms interval — a thousand times faster than
 * intended — and every downstream symptom looks like a load problem.
 *
 * Configuration is not user input to be salvaged. If a deployment asks for
 * something this service cannot provide, the honest response is to refuse and
 * name the variable, not to pick a number the operator never chose.
 *
 * ── Why the value never appears in the error ─────────────────────────────────
 *
 * These parsers are applied to whatever the environment holds, and this service
 * reads `FREESWITCH_ESL_PASSWORD`, `DIALER_V2_INTERNAL_TOKEN`, `REDIS_URL` and
 * `DATABASE_URL` from the same map. A parser that echoes the offending value
 * into an error message is one paste away from writing a credential to a log the
 * moment somebody sets the wrong variable. Errors here name the variable and the
 * constraint. They never quote what was found.
 */

/** A configuration value this service cannot use. Names the variable, not the value. */
export class ConfigurationError extends Error {
  readonly code = 'DIALER_V2_INVALID_CONFIGURATION';

  constructor(
    readonly variable: string,
    readonly constraint: string
  ) {
    super(`${variable} is not usable: ${constraint}`);
    this.name = 'ConfigurationError';
  }
}

export type EnvMap = Record<string, string | undefined>;

/** Digits and nothing else, anchored at both ends. No sign, point, exponent, or unit. */
const DIGITS_ONLY = /^[0-9]+$/;

/**
 * Read an integer, distinguishing absent from invalid.
 *
 * Returns `undefined` when the variable is unset or empty — deployment tooling
 * routinely emits an empty string for "not configured", and treating that as a
 * fault would break valid deployments. Anything else present must be a complete,
 * unsigned, base-ten integer within the safe range, or this throws.
 */
function readIntegerOrAbsent(env: EnvMap, name: string, minimum: number): number | undefined {
  const raw = env[name];
  if (raw === undefined) return undefined;

  const trimmed = raw.trim();
  if (trimmed === '') return undefined;

  if (!DIGITS_ONLY.test(trimmed)) {
    throw new ConfigurationError(
      name,
      `expected a base-ten integer of digits only, at least ${minimum}`
    );
  }

  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) {
    throw new ConfigurationError(name, 'the value exceeds the safe integer range');
  }
  if (value < minimum) {
    throw new ConfigurationError(name, `expected a value of at least ${minimum}`);
  }
  return value;
}

/** A count or duration that must be greater than zero. Absent returns `undefined`. */
export function readPositiveInt(env: EnvMap, name: string): number | undefined {
  return readIntegerOrAbsent(env, name, 1);
}

/**
 * A limit where zero is a meaningful setting rather than a mistake.
 *
 * Used for the CPS and concurrency caps, where `0` is the safe default and means
 * "permit nothing". Rejecting it would make the safest configuration unwritable.
 */
export function readNonNegativeInt(env: EnvMap, name: string): number | undefined {
  return readIntegerOrAbsent(env, name, 0);
}

/** Positive integer with a default applied when absent. Invalid still throws. */
export function positiveIntWithDefault(env: EnvMap, name: string, fallback: number): number {
  return readPositiveInt(env, name) ?? fallback;
}

/** Non-negative integer with a default applied when absent. Invalid still throws. */
export function nonNegativeIntWithDefault(env: EnvMap, name: string, fallback: number): number {
  return readNonNegativeInt(env, name) ?? fallback;
}

/** A TCP port. Same strictness, plus the range a port can actually occupy. */
export function portWithDefault(env: EnvMap, name: string, fallback: number): number {
  const value = readPositiveInt(env, name);
  if (value === undefined) return fallback;
  if (value > 65_535) {
    throw new ConfigurationError(name, 'expected a TCP port between 1 and 65535');
  }
  return value;
}
