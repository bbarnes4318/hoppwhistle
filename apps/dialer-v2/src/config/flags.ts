/**
 * Dialer V2 — feature flags and kill switches.
 *
 * Every default in this file is chosen so that a freshly deployed Dialer V2 with
 * no environment configuration whatsoever CANNOT place a telephone call. That is
 * a tested property, not a convention — see `flags.test.ts`
 * ("default configuration cannot originate").
 *
 * Flags are resolved on EVERY read rather than cached at module load, so an
 * override applied at runtime (emergency stop) takes effect on the next pacing
 * tick without a restart or a deploy.
 *
 * Phase 0 ships the env source and an in-memory override source. The
 * Redis-backed override source (so an operator can trip the platform-wide stop
 * from the supervisor UI) lands in Phase 1; the interface is stable now so that
 * change is additive.
 */

import { nonNegativeIntWithDefault } from './env.js';

/**
 * Sentinel meaning "allowlisting for this dimension is intentionally disabled".
 * Only honoured for the campaign allowlist. There is deliberately no wildcard
 * for the tenant allowlist: enabling every tenant at once must not be a typo.
 */
export const ALLOWLIST_DISABLED = '*';

export interface DialerV2Flags {
  /** Master switch. Off ⇒ Dialer V2 does nothing at all. */
  enabled: boolean;
  /** Run the pacing controller against real state, persist decisions, never dial. */
  shadowEnabled: boolean;
  /** Permit real origination. Necessary but far from sufficient — see origination-gate.ts. */
  originateEnabled: boolean;
  /** Tenants permitted to dial. Empty ⇒ none. No wildcard. */
  allowedTenantIds: readonly string[];
  /** Campaigns permitted to dial. Empty ⇒ none. `['*']` ⇒ allowlisting disabled. */
  allowedCampaignIds: readonly string[];
  /** Platform-wide originate rate ceiling, calls/second. */
  maxGlobalCps: number;
  /** Platform-wide concurrent call ceiling for V2 traffic. */
  maxGlobalCalls: number;
  /** Compute and log everything, but never send an originate to FreeSWITCH. */
  dryRun: boolean;
  /** Platform-wide immediate stop on NEW originations. Never tears down live calls. */
  emergencyStop: boolean;
  /** Refuse to dial when agent-state telemetry is stale. */
  requireHealthyAgentHeartbeats: boolean;
}

/**
 * The safe baseline. Note that `maxGlobalCps` and `maxGlobalCalls` default to 0:
 * capacity must be granted explicitly. Turning on `enabled` and
 * `originateEnabled` without also granting capacity still results in zero calls,
 * and the gate reports exactly which condition held it back.
 */
export const SAFE_DEFAULTS: DialerV2Flags = Object.freeze({
  enabled: false,
  shadowEnabled: false,
  originateEnabled: false,
  allowedTenantIds: Object.freeze([]) as readonly string[],
  allowedCampaignIds: Object.freeze([]) as readonly string[],
  maxGlobalCps: 0,
  maxGlobalCalls: 0,
  dryRun: true,
  emergencyStop: false,
  requireHealthyAgentHeartbeats: true,
});

export type FlagEnv = Record<string, string | undefined>;

/**
 * Parse a boolean env var. Anything not explicitly truthy is the default —
 * a typo (`TRUE_`, `yess`) must never accidentally enable dialing.
 */
function envBool(env: FlagEnv, name: string, fallback: boolean): boolean {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const v = raw.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes' || v === 'on') return true;
  if (v === 'false' || v === '0' || v === 'no' || v === 'off') return false;
  return fallback;
}

/**
 * A cap, parsed strictly.
 *
 * Zero is permitted and meaningful here — it is the safe default and means
 * "permit nothing" — so this is the non-negative parser rather than the positive
 * one. Anything malformed throws instead of falling back: a cap that silently
 * became the default is a cap nobody chose, and these two govern how fast the
 * platform is allowed to dial.
 */
function envInt(env: FlagEnv, name: string, fallback: number): number {
  return nonNegativeIntWithDefault(env, name, fallback);
}

function envList(env: FlagEnv, name: string): readonly string[] {
  const raw = env[name];
  if (raw === undefined) return [];
  return Object.freeze(
    raw
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0)
  );
}

/** Resolve flags from an environment map. Pure — the env is an argument. */
export function readFlagsFromEnv(env: FlagEnv = process.env): DialerV2Flags {
  return {
    enabled: envBool(env, 'TENANT_DIALER_V2_ENABLED', SAFE_DEFAULTS.enabled),
    shadowEnabled: envBool(env, 'TENANT_DIALER_V2_SHADOW_ENABLED', SAFE_DEFAULTS.shadowEnabled),
    originateEnabled: envBool(
      env,
      'TENANT_DIALER_V2_ORIGINATE_ENABLED',
      SAFE_DEFAULTS.originateEnabled
    ),
    allowedTenantIds: envList(env, 'TENANT_DIALER_V2_ALLOWED_TENANT_IDS'),
    allowedCampaignIds: envList(env, 'TENANT_DIALER_V2_ALLOWED_CAMPAIGN_IDS'),
    maxGlobalCps: envInt(env, 'TENANT_DIALER_V2_MAX_GLOBAL_CPS', SAFE_DEFAULTS.maxGlobalCps),
    maxGlobalCalls: envInt(env, 'TENANT_DIALER_V2_MAX_GLOBAL_CALLS', SAFE_DEFAULTS.maxGlobalCalls),
    dryRun: envBool(env, 'TENANT_DIALER_V2_DRY_RUN', SAFE_DEFAULTS.dryRun),
    emergencyStop: envBool(env, 'TENANT_DIALER_V2_EMERGENCY_STOP', SAFE_DEFAULTS.emergencyStop),
    requireHealthyAgentHeartbeats: envBool(
      env,
      'TENANT_DIALER_V2_REQUIRE_HEALTHY_AGENT_HEARTBEATS',
      SAFE_DEFAULTS.requireHealthyAgentHeartbeats
    ),
  };
}

/**
 * A runtime override layer. Only ever allowed to make the system SAFER:
 * `applyOverrides` refuses to turn a flag from a restrictive value to a
 * permissive one. An attacker (or a bug) with write access to the override
 * store therefore cannot start a dialer — only stop one.
 */
export interface FlagOverrides {
  emergencyStop?: true;
  enabled?: false;
  originateEnabled?: false;
  shadowEnabled?: false;
  dryRun?: true;
  maxGlobalCps?: number;
  maxGlobalCalls?: number;
}

export function applyOverrides(base: DialerV2Flags, overrides: FlagOverrides): DialerV2Flags {
  return {
    ...base,
    // Restrictive-only: an override may engage the stop, never clear it.
    emergencyStop: base.emergencyStop || overrides.emergencyStop === true,
    enabled: base.enabled && overrides.enabled !== false,
    originateEnabled: base.originateEnabled && overrides.originateEnabled !== false,
    shadowEnabled: base.shadowEnabled && overrides.shadowEnabled !== false,
    dryRun: base.dryRun || overrides.dryRun === true,
    // Numeric ceilings may only be lowered.
    maxGlobalCps:
      overrides.maxGlobalCps === undefined
        ? base.maxGlobalCps
        : Math.min(base.maxGlobalCps, Math.max(0, overrides.maxGlobalCps)),
    maxGlobalCalls:
      overrides.maxGlobalCalls === undefined
        ? base.maxGlobalCalls
        : Math.min(base.maxGlobalCalls, Math.max(0, overrides.maxGlobalCalls)),
  };
}

export interface FlagSource {
  get(): DialerV2Flags;
}

/** Reads `process.env` on every call, then applies restrictive-only overrides. */
export class EnvFlagSource implements FlagSource {
  private overrides: FlagOverrides = {};

  constructor(private readonly env: FlagEnv = process.env) {}

  get(): DialerV2Flags {
    return applyOverrides(readFlagsFromEnv(this.env), this.overrides);
  }

  /** Trip the platform-wide stop. Cannot be un-tripped through this path. */
  engageEmergencyStop(): void {
    this.overrides = { ...this.overrides, emergencyStop: true };
  }

  /**
   * Clearing the stop is deliberately a separate, explicit operation: it drops
   * the override entirely and falls back to the environment. If
   * TENANT_DIALER_V2_EMERGENCY_STOP is set in the environment, the stop stays
   * engaged — clearing it requires a real configuration change.
   */
  clearOverrides(): void {
    this.overrides = {};
  }

  setOverrides(next: FlagOverrides): void {
    this.overrides = { ...this.overrides, ...next };
  }
}

export function isTenantAllowed(flags: DialerV2Flags, tenantId: string): boolean {
  return flags.allowedTenantIds.includes(tenantId);
}

export function isCampaignAllowed(flags: DialerV2Flags, campaignId: string): boolean {
  if (flags.allowedCampaignIds.includes(ALLOWLIST_DISABLED)) return true;
  return flags.allowedCampaignIds.includes(campaignId);
}
