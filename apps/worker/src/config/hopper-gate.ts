/**
 * Legacy Hopper startup gate.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 *
 * `apps/worker/src/index.ts` used to call `dialerWorker.start()` unconditionally.
 * No environment variable, no feature flag, no tenant allowlist, no kill switch.
 * The Hopper polls roughly every second, selects up to fifty `NEW` leads per
 * cycle, and originates real calls through FreeSWITCH.
 *
 * The only thing that stopped it dialing was audit finding F-1: it wrote
 * `'DIALING'::"LeadStatus"` and the enum had no such member, so PostgreSQL
 * raised `invalid_text_representation` on the first lead of every batch and
 * `originateCall()` was never reached.
 *
 * An accident is not a control. This module is the control, and it exists
 * BEFORE F-1 is repaired precisely so that repairing F-1 cannot start a dialer.
 *
 * ── Why the parser refuses rather than guesses ───────────────────────────────
 *
 * Every other flag in this repository treats an unrecognised value as "use the
 * default". That is right for a flag whose default is safe and whose wrong value
 * costs nothing. It is wrong here in a specific way: an operator who writes
 * `LEGACY_HOPPER_ENABLED=1` intends the dialer ON. Silently reading that as OFF
 * leaves them debugging a dialer that will not start; silently reading it as ON
 * places telephone calls nobody authorised. Neither is acceptable, so a value
 * that is present and not exactly `true` or `false` is a startup refusal that
 * names the variable.
 *
 * Absent or empty is different, and is NOT an error: it is the shipped state of
 * every environment that has never been asked to run the Hopper, and it means
 * disabled.
 */

/** What the gate decided, reported through the worker health surface. */
export enum HopperState {
  /** Not enabled. The ordinary, shipped state. */
  DISABLED = 'disabled',
  /** Configuration is contradictory or malformed. Names the problem. */
  REFUSED_CONFIGURATION = 'refused_configuration',
  /** Configuration is valid, but the startup preflight said no. */
  PREFLIGHT_BLOCKED = 'preflight_blocked',
  /** Authorised for a named tenant/campaign scope, not yet started. */
  ENABLED_SCOPED = 'enabled_scoped',
  /** The polling loop is live. Never inferred from the process being alive. */
  RUNNING = 'running',
  /** Started and then failed. */
  FAILED = 'failed',
}

export interface HopperScope {
  tenantIds: readonly string[];
  campaignIds: readonly string[];
}

export interface HopperGateDecision {
  state: HopperState;
  /** Sanitized. Never contains a value read from the environment. */
  reason: string;
  scope: HopperScope;
  /** Whether actual origination is permitted. Requires its own switch. */
  originationEnabled: boolean;
}

export type GateEnv = Record<string, string | undefined>;

/** The exact variable names. Documented here because operators grep for them. */
export const HOPPER_ENV = {
  enabled: 'LEGACY_HOPPER_ENABLED',
  tenants: 'LEGACY_HOPPER_ALLOWED_TENANT_IDS',
  campaigns: 'LEGACY_HOPPER_ALLOWED_CAMPAIGN_IDS',
  origination: 'LEGACY_HOPPER_ORIGINATION_ENABLED',
  emergencyStop: 'LEGACY_HOPPER_EMERGENCY_STOP',
  testAuthorized: 'LEGACY_HOPPER_TEST_AUTHORIZED',
} as const;

const EMPTY_SCOPE: HopperScope = Object.freeze({
  tenantIds: Object.freeze([]),
  campaignIds: Object.freeze([]),
});

/** A configuration value this worker cannot act on. Names the variable, never the value. */
export class HopperConfigurationError extends Error {
  constructor(
    readonly variable: string,
    readonly constraint: string
  ) {
    super(`${variable} is not usable: ${constraint}`);
    this.name = 'HopperConfigurationError';
  }
}

/**
 * Strictly boolean.
 *
 * Absent or empty is `undefined` — "not configured", which callers read as the
 * safe default. Anything else must be exactly `true` or `false`. `1`, `yes`,
 * `on`, `TRUE`, `ture` and `enabled` all throw, because each of them is an
 * operator saying something specific that this worker must not reinterpret.
 */
export function readStrictBoolean(env: GateEnv, name: string): boolean | undefined {
  const raw = env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  throw new HopperConfigurationError(name, 'expected exactly "true" or "false"');
}

/** A comma-separated allowlist. Blank entries are dropped, not treated as wildcards. */
export function readAllowlist(env: GateEnv, name: string): string[] {
  const raw = env[name];
  if (raw === undefined) return [];
  return raw
    .split(',')
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0);
}

/** Is a recognised test runner driving this process? */
export function isTestRunner(env: GateEnv): boolean {
  return (
    env.VITEST === 'true' ||
    env.VITEST_WORKER_ID !== undefined ||
    env.NODE_TEST_CONTEXT !== undefined
  );
}

/**
 * Resolve whether the legacy Hopper may start.
 *
 * Order matters and is deliberate:
 *
 *   1. Malformed configuration refuses, before anything is interpreted.
 *   2. The emergency stop wins over every other setting, including enable.
 *   3. Not explicitly enabled is disabled.
 *   4. Enabled with no scope refuses — "on, for everyone" must not be reachable
 *      by omission. Under the old code, "everyone" was the only option.
 *   5. A test runner needs its own explicit authorization, so that merely
 *      running the suite can never arm a dialer.
 *
 * Origination is resolved separately and defaults to off even when the Hopper
 * itself is enabled, so selection and reservation can be exercised in a
 * controlled environment without a command ever reaching a gateway.
 */
export function resolveHopperGate(env: GateEnv): HopperGateDecision {
  let enabled: boolean | undefined;
  let emergencyStop: boolean | undefined;
  let origination: boolean | undefined;
  let testAuthorized: boolean | undefined;

  try {
    enabled = readStrictBoolean(env, HOPPER_ENV.enabled);
    emergencyStop = readStrictBoolean(env, HOPPER_ENV.emergencyStop);
    origination = readStrictBoolean(env, HOPPER_ENV.origination);
    testAuthorized = readStrictBoolean(env, HOPPER_ENV.testAuthorized);
  } catch (error) {
    return {
      state: HopperState.REFUSED_CONFIGURATION,
      reason: (error as HopperConfigurationError).message,
      scope: EMPTY_SCOPE,
      originationEnabled: false,
    };
  }

  if (emergencyStop === true) {
    return {
      state: HopperState.DISABLED,
      reason: `${HOPPER_ENV.emergencyStop} is engaged; it overrides every other setting`,
      scope: EMPTY_SCOPE,
      originationEnabled: false,
    };
  }

  if (enabled !== true) {
    return {
      state: HopperState.DISABLED,
      reason: `${HOPPER_ENV.enabled} is not "true"`,
      scope: EMPTY_SCOPE,
      originationEnabled: false,
    };
  }

  const tenantIds = readAllowlist(env, HOPPER_ENV.tenants);
  const campaignIds = readAllowlist(env, HOPPER_ENV.campaigns);

  if (tenantIds.length === 0 && campaignIds.length === 0) {
    // The dangerous configuration is "enabled, scope omitted", because omission
    // is what the previous code effectively had: every tenant, every campaign.
    return {
      state: HopperState.REFUSED_CONFIGURATION,
      reason: `${HOPPER_ENV.enabled} is "true" but neither ${HOPPER_ENV.tenants} nor ${HOPPER_ENV.campaigns} names anything; there is no way to enable the Hopper for everything`,
      scope: EMPTY_SCOPE,
      originationEnabled: false,
    };
  }

  if (isTestRunner(env) && testAuthorized !== true) {
    return {
      state: HopperState.REFUSED_CONFIGURATION,
      reason: `a test runner is present; set ${HOPPER_ENV.testAuthorized}="true" to authorize the Hopper inside a test`,
      scope: EMPTY_SCOPE,
      originationEnabled: false,
    };
  }

  return {
    state: HopperState.ENABLED_SCOPED,
    reason: `scoped to ${tenantIds.length} tenant(s) and ${campaignIds.length} campaign(s)`,
    scope: Object.freeze({
      tenantIds: Object.freeze([...tenantIds]),
      campaignIds: Object.freeze([...campaignIds]),
    }),
    // Second, independent interlock. Enabling the Hopper does NOT enable calls.
    originationEnabled: origination === true,
  };
}

/** Whether the decision permits the polling loop to run at all. */
export function permitsStartup(decision: HopperGateDecision): boolean {
  return decision.state === HopperState.ENABLED_SCOPED;
}
