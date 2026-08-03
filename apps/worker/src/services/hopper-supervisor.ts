/**
 * The one place the legacy Hopper may be started from.
 *
 * Extracted from `index.ts` so the decision is testable against a fake worker.
 * While it lived inline, the only way to assert "a disabled Hopper does not
 * start, and the rest of the worker is unaffected" was to read the file and
 * believe it — which is how it went years with no gate at all.
 *
 * The CI guard (`scripts/ci/hopper-kill-switch-guard.mjs`) asserts that this is
 * the ONLY call site of `dialerWorker.start(`, so a second entrypoint cannot
 * quietly appear beside it without the same gate.
 */

import {
  HopperState,
  permitsStartup,
  resolveHopperGate,
  type GateEnv,
} from '../config/hopper-gate.js';

/** The surface the supervisor needs. Narrow, so tests need no real worker. */
export interface StartableHopper {
  start(options: {
    scope: { tenantIds: readonly string[]; campaignIds: readonly string[] };
    originationEnabled: boolean;
  }): Promise<void>;
}

export interface SupervisorLog {
  info(record: Record<string, unknown>): void;
  warn(record: Record<string, unknown>): void;
  error(record: Record<string, unknown>): void;
}

export interface HopperStatus {
  state: HopperState;
  /** Sanitized: built from variable names and counts, never from a value. */
  detail: string;
}

/**
 * Decide, and if permitted, start.
 *
 * **Never throws.** A Hopper that cannot start must not take billing, the
 * ClickHouse ETL, or industry research down with it — those are unrelated
 * services that ran perfectly well before the Hopper had a gate, and a dialer
 * failing is not a reason to stop invoicing people.
 */
export async function superviseLegacyHopper(
  env: GateEnv,
  hopper: StartableHopper,
  log: SupervisorLog
): Promise<HopperStatus> {
  const gate = resolveHopperGate(env);

  if (!permitsStartup(gate)) {
    // One sanitized line. Nothing read from the environment appears in it.
    log.warn({ msg: 'Legacy Hopper not started', state: gate.state, reason: gate.reason });
    return { state: gate.state, detail: gate.reason };
  }

  try {
    await hopper.start({ scope: gate.scope, originationEnabled: gate.originationEnabled });
    log.info({
      msg: 'Legacy Hopper started',
      tenants: gate.scope.tenantIds.length,
      campaigns: gate.scope.campaignIds.length,
      originationEnabled: gate.originationEnabled,
    });
    return { state: HopperState.RUNNING, detail: gate.reason };
  } catch (error) {
    log.error({ msg: 'Legacy Hopper failed to start', err: error });
    return {
      state: HopperState.FAILED,
      detail: 'the Hopper failed to start; see the worker log',
    };
  }
}
