import { describe, expect, it } from 'vitest';

import { ConfigurationError } from './env.js';
import {
  ALLOWLIST_DISABLED,
  EnvFlagSource,
  type FlagOverrides,
  SAFE_DEFAULTS,
  applyOverrides,
  isCampaignAllowed,
  isTenantAllowed,
  readFlagsFromEnv,
} from './flags.js';

describe('default configuration', () => {
  it('cannot originate with a completely empty environment', () => {
    const flags = readFlagsFromEnv({});

    // Each of these independently prevents a call. All of them hold at once.
    expect(flags.enabled).toBe(false);
    expect(flags.originateEnabled).toBe(false);
    expect(flags.dryRun).toBe(true);
    expect(flags.allowedTenantIds).toHaveLength(0);
    expect(flags.allowedCampaignIds).toHaveLength(0);
    expect(flags.maxGlobalCps).toBe(0);
    expect(flags.maxGlobalCalls).toBe(0);
    expect(flags.requireHealthyAgentHeartbeats).toBe(true);
  });

  it('matches the declared safe baseline', () => {
    expect(readFlagsFromEnv({})).toEqual(SAFE_DEFAULTS);
  });
});

describe('boolean parsing', () => {
  it('accepts the documented truthy spellings', () => {
    for (const v of ['true', 'TRUE', '1', 'yes', 'on', ' True ']) {
      expect(readFlagsFromEnv({ TENANT_DIALER_V2_ENABLED: v }).enabled).toBe(true);
    }
  });

  it('treats an unrecognised value as the default rather than as enabled', () => {
    // A typo must never accidentally switch a dialer on.
    for (const v of ['yess', 'TRUE_', 'enabled', 'y', '2']) {
      expect(readFlagsFromEnv({ TENANT_DIALER_V2_ENABLED: v }).enabled).toBe(false);
    }
  });

  it('keeps dry-run engaged when the value is unparseable', () => {
    expect(readFlagsFromEnv({ TENANT_DIALER_V2_DRY_RUN: 'maybe' }).dryRun).toBe(true);
  });
});

describe('numeric parsing', () => {
  it('refuses a malformed ceiling instead of falling back to the default', () => {
    // This used to return 0 — the safe default — with nothing reporting the
    // substitution. Silent is the problem, not the value: the config file said
    // one thing and the process did another, and the two never met. These are
    // the caps that govern how fast the platform may dial, so a value nobody
    // wrote is not an acceptable resolution of a value nobody can parse.
    for (const bad of ['-5', 'lots', '10 calls', '1e3', '2.5']) {
      expect(() => readFlagsFromEnv({ TENANT_DIALER_V2_MAX_GLOBAL_CPS: bad })).toThrow(
        ConfigurationError
      );
    }
  });

  it('names the variable and never quotes the value', () => {
    // These parsers run over the whole environment, which includes
    // FREESWITCH_ESL_PASSWORD and DIALER_V2_INTERNAL_TOKEN. A parser that echoes
    // what it found is one mistyped variable away from logging a credential.
    try {
      readFlagsFromEnv({ TENANT_DIALER_V2_MAX_GLOBAL_CPS: 'hunter2' });
      expect.unreachable('expected a ConfigurationError');
    } catch (error) {
      expect((error as ConfigurationError).variable).toBe('TENANT_DIALER_V2_MAX_GLOBAL_CPS');
      expect((error as Error).message).not.toMatch(/hunter2/);
    }
  });

  it('keeps zero, because zero is a meaningful cap here', () => {
    // `0` means "permit nothing" and is the safe default. Rejecting it as
    // non-positive would make the safest configuration unwritable.
    expect(readFlagsFromEnv({ TENANT_DIALER_V2_MAX_GLOBAL_CPS: '0' }).maxGlobalCps).toBe(0);
  });

  it('treats an empty value as unset', () => {
    // Deployment tooling routinely emits an empty variable for "not configured".
    expect(readFlagsFromEnv({ TENANT_DIALER_V2_MAX_GLOBAL_CALLS: '' }).maxGlobalCalls).toBe(0);
  });

  it('reads a valid ceiling', () => {
    expect(readFlagsFromEnv({ TENANT_DIALER_V2_MAX_GLOBAL_CALLS: '250' }).maxGlobalCalls).toBe(250);
  });
});

describe('allowlists', () => {
  it('parses and trims a comma-separated tenant list', () => {
    const flags = readFlagsFromEnv({ TENANT_DIALER_V2_ALLOWED_TENANT_IDS: 'a, b ,,c' });
    expect(flags.allowedTenantIds).toEqual(['a', 'b', 'c']);
    expect(isTenantAllowed(flags, 'b')).toBe(true);
    expect(isTenantAllowed(flags, 'd')).toBe(false);
  });

  it('has no wildcard for tenants — enabling everyone must not be a typo', () => {
    const flags = readFlagsFromEnv({ TENANT_DIALER_V2_ALLOWED_TENANT_IDS: ALLOWLIST_DISABLED });
    expect(isTenantAllowed(flags, 'anything')).toBe(false);
  });

  it('supports intentionally disabling campaign allowlisting', () => {
    const flags = readFlagsFromEnv({ TENANT_DIALER_V2_ALLOWED_CAMPAIGN_IDS: ALLOWLIST_DISABLED });
    expect(isCampaignAllowed(flags, 'any-campaign')).toBe(true);
  });
});

describe('runtime overrides are restrictive-only', () => {
  const permissive = {
    ...SAFE_DEFAULTS,
    enabled: true,
    originateEnabled: true,
    shadowEnabled: true,
    dryRun: false,
    maxGlobalCps: 10,
    maxGlobalCalls: 100,
  };

  it('can engage the emergency stop', () => {
    expect(applyOverrides(permissive, { emergencyStop: true }).emergencyStop).toBe(true);
  });

  it('cannot clear an emergency stop that the environment set', () => {
    const stopped = { ...permissive, emergencyStop: true };
    expect(applyOverrides(stopped, {}).emergencyStop).toBe(true);
  });

  it('can disable but never enable', () => {
    expect(applyOverrides(permissive, { enabled: false }).enabled).toBe(false);

    // The override type has no `true` case for these; this asserts the runtime
    // behaviour holds even when a caller reaches past the types.
    const disabled = { ...permissive, enabled: false, originateEnabled: false };
    const forced = { enabled: true, originateEnabled: true } as unknown as FlagOverrides;
    const result = applyOverrides(disabled, forced);
    expect(result.enabled).toBe(false);
    expect(result.originateEnabled).toBe(false);
  });

  it('can lower a ceiling but never raise one', () => {
    expect(applyOverrides(permissive, { maxGlobalCps: 5 }).maxGlobalCps).toBe(5);
    expect(applyOverrides(permissive, { maxGlobalCps: 9999 }).maxGlobalCps).toBe(10);
    expect(applyOverrides(permissive, { maxGlobalCps: -1 }).maxGlobalCps).toBe(0);
  });

  it('can engage dry-run but never leave it', () => {
    const dry = { ...permissive, dryRun: true };
    const forced = { dryRun: false } as unknown as FlagOverrides;
    expect(applyOverrides(dry, forced).dryRun).toBe(true);
  });
});

describe('EnvFlagSource', () => {
  it('re-reads the environment on every call so changes take effect without a restart', () => {
    const env: Record<string, string | undefined> = {};
    const source = new EnvFlagSource(env);

    expect(source.get().enabled).toBe(false);
    env.TENANT_DIALER_V2_ENABLED = 'true';
    expect(source.get().enabled).toBe(true);
  });

  it('engages the emergency stop immediately and does not clear it via clearOverrides when the env sets it', () => {
    const env: Record<string, string | undefined> = { TENANT_DIALER_V2_EMERGENCY_STOP: 'true' };
    const source = new EnvFlagSource(env);

    expect(source.get().emergencyStop).toBe(true);
    source.clearOverrides();
    expect(source.get().emergencyStop).toBe(true);
  });

  it('clears a runtime-only stop when overrides are dropped', () => {
    const env: Record<string, string | undefined> = {};
    const source = new EnvFlagSource(env);

    source.engageEmergencyStop();
    expect(source.get().emergencyStop).toBe(true);
    source.clearOverrides();
    expect(source.get().emergencyStop).toBe(false);
  });
});
