/**
 * The legacy Hopper startup gate.
 *
 * These tests exist because for the lifetime of this repository the Hopper
 * started unconditionally, and the only thing preventing outbound calls was a
 * database error on every batch. Each case below is a way that could come back.
 */

import { describe, expect, it } from 'vitest';

import {
  HopperConfigurationError,
  HOPPER_ENV,
  HopperState,
  permitsStartup,
  readAllowlist,
  readStrictBoolean,
  resolveHopperGate,
  type GateEnv,
} from '../hopper-gate.js';

/**
 * An environment with no test-runner markers.
 *
 * These tests run under Vitest, which the gate treats as requiring explicit
 * authorization. Building the env from scratch rather than spreading
 * `process.env` keeps each case about the variable under test.
 */
const env = (over: GateEnv = {}): GateEnv => ({ ...over });

/** A scope that satisfies the allowlist requirement. */
const SCOPED = {
  [HOPPER_ENV.tenants]: 'tenant-a',
};

describe('1. no configuration at all', () => {
  it('does not start', () => {
    const decision = resolveHopperGate(env());
    expect(decision.state).toBe(HopperState.DISABLED);
    expect(permitsStartup(decision)).toBe(false);
  });

  it('reports no scope and no origination', () => {
    const decision = resolveHopperGate(env());
    expect(decision.scope.tenantIds).toEqual([]);
    expect(decision.scope.campaignIds).toEqual([]);
    expect(decision.originationEnabled).toBe(false);
  });
});

describe('2. explicitly false', () => {
  it('does not start', () => {
    const decision = resolveHopperGate(env({ [HOPPER_ENV.enabled]: 'false', ...SCOPED }));
    expect(decision.state).toBe(HopperState.DISABLED);
  });
});

describe('3. empty enable value', () => {
  it('is treated as unset, not as enabled', () => {
    // Deployment tooling routinely emits an empty variable for "not configured".
    expect(resolveHopperGate(env({ [HOPPER_ENV.enabled]: '' })).state).toBe(HopperState.DISABLED);
    expect(resolveHopperGate(env({ [HOPPER_ENV.enabled]: '   ' })).state).toBe(
      HopperState.DISABLED
    );
  });
});

describe('4. near-misses are refused, not guessed', () => {
  it.each(['ture', 'enabled', '1', 'yes', 'on', 'TRUE', 'True', 'y', 'trueish'])(
    'refuses %o',
    value => {
      // An operator who writes `1` means ON. Reading it as OFF leaves them
      // debugging a dialer that will not start; reading it as ON places calls
      // nobody authorised. Refusing names the variable and does neither.
      const decision = resolveHopperGate(env({ [HOPPER_ENV.enabled]: value, ...SCOPED }));
      expect(decision.state).toBe(HopperState.REFUSED_CONFIGURATION);
      expect(permitsStartup(decision)).toBe(false);
    }
  );

  it('names the variable and never the value', () => {
    const decision = resolveHopperGate(
      env({ [HOPPER_ENV.enabled]: 'super-secret-typo', ...SCOPED })
    );
    expect(decision.reason).toContain(HOPPER_ENV.enabled);
    expect(decision.reason).not.toContain('super-secret-typo');
  });

  it('applies the same strictness to every boolean it reads', () => {
    for (const name of [HOPPER_ENV.emergencyStop, HOPPER_ENV.origination]) {
      const decision = resolveHopperGate(
        env({ [HOPPER_ENV.enabled]: 'true', ...SCOPED, [name]: 'yes' })
      );
      expect(decision.state).toBe(HopperState.REFUSED_CONFIGURATION);
    }
  });
});

describe('5. enabled with no allowlist', () => {
  it('refuses', () => {
    // The dangerous configuration is "on, scope omitted" — which is precisely
    // what the previous code effectively had. There must be no way to say
    // "enabled, for everything".
    const decision = resolveHopperGate(env({ [HOPPER_ENV.enabled]: 'true' }));
    expect(decision.state).toBe(HopperState.REFUSED_CONFIGURATION);
    expect(decision.reason).toMatch(/neither .* nor .* names anything/);
  });

  it('refuses an allowlist of only blanks', () => {
    const decision = resolveHopperGate(
      env({ [HOPPER_ENV.enabled]: 'true', [HOPPER_ENV.tenants]: ' , ,, ' })
    );
    expect(decision.state).toBe(HopperState.REFUSED_CONFIGURATION);
  });
});

describe('6. tenant allowlist without the enable switch', () => {
  it('does not start', () => {
    const decision = resolveHopperGate(env({ [HOPPER_ENV.tenants]: 'tenant-a,tenant-b' }));
    expect(decision.state).toBe(HopperState.DISABLED);
  });
});

describe('7. campaign allowlist without the enable switch', () => {
  it('does not start', () => {
    const decision = resolveHopperGate(env({ [HOPPER_ENV.campaigns]: 'camp-1' }));
    expect(decision.state).toBe(HopperState.DISABLED);
  });
});

describe('8. enabled with a valid scope', () => {
  it('reaches enabled_scoped, and no further on its own', () => {
    const decision = resolveHopperGate(
      env({
        [HOPPER_ENV.enabled]: 'true',
        [HOPPER_ENV.tenants]: 'tenant-a, tenant-b',
        [HOPPER_ENV.campaigns]: 'camp-1',
      })
    );

    expect(decision.state).toBe(HopperState.ENABLED_SCOPED);
    expect(decision.scope.tenantIds).toEqual(['tenant-a', 'tenant-b']);
    expect(decision.scope.campaignIds).toEqual(['camp-1']);
    // `enabled_scoped` is explicitly NOT `running`.
    expect(decision.state).not.toBe(HopperState.RUNNING);
  });

  it('still does not permit origination', () => {
    // The two interlocks are independent. Enabling the Hopper enables
    // selection and reservation; it does not enable telephone calls.
    const decision = resolveHopperGate(env({ [HOPPER_ENV.enabled]: 'true', ...SCOPED }));
    expect(permitsStartup(decision)).toBe(true);
    expect(decision.originationEnabled).toBe(false);
  });

  it('permits origination only when its own switch is exactly true', () => {
    const decision = resolveHopperGate(
      env({ [HOPPER_ENV.enabled]: 'true', ...SCOPED, [HOPPER_ENV.origination]: 'true' })
    );
    expect(decision.originationEnabled).toBe(true);
  });
});

describe('10. the emergency stop overrides everything', () => {
  it('beats a fully valid enabled configuration', () => {
    const decision = resolveHopperGate(
      env({
        [HOPPER_ENV.enabled]: 'true',
        [HOPPER_ENV.tenants]: 'tenant-a',
        [HOPPER_ENV.campaigns]: 'camp-1',
        [HOPPER_ENV.origination]: 'true',
        [HOPPER_ENV.emergencyStop]: 'true',
      })
    );

    expect(decision.state).toBe(HopperState.DISABLED);
    expect(decision.originationEnabled).toBe(false);
    expect(decision.reason).toContain(HOPPER_ENV.emergencyStop);
  });

  it('is evaluated before the enable switch, so a stop cannot be out-ranked', () => {
    const decision = resolveHopperGate(
      env({ [HOPPER_ENV.emergencyStop]: 'true', [HOPPER_ENV.enabled]: 'true' })
    );
    // Without the ordering this would have been REFUSED_CONFIGURATION for the
    // missing allowlist, which is a different and less clear answer.
    expect(decision.state).toBe(HopperState.DISABLED);
  });
});

describe('a test runner cannot arm the dialer by accident', () => {
  it('refuses under Vitest without explicit authorization', () => {
    const decision = resolveHopperGate(
      env({ [HOPPER_ENV.enabled]: 'true', ...SCOPED, VITEST: 'true' })
    );
    expect(decision.state).toBe(HopperState.REFUSED_CONFIGURATION);
    expect(decision.reason).toContain(HOPPER_ENV.testAuthorized);
  });

  it('allows it when a test explicitly injects authorization', () => {
    const decision = resolveHopperGate(
      env({
        [HOPPER_ENV.enabled]: 'true',
        ...SCOPED,
        VITEST: 'true',
        [HOPPER_ENV.testAuthorized]: 'true',
      })
    );
    expect(decision.state).toBe(HopperState.ENABLED_SCOPED);
  });

  it('does not consult NODE_ENV', () => {
    // NODE_ENV is set to `test` by CI images and shell profiles that have
    // nothing to do with a test process, in both directions.
    const decision = resolveHopperGate(
      env({ [HOPPER_ENV.enabled]: 'true', ...SCOPED, NODE_ENV: 'production' })
    );
    expect(decision.state).toBe(HopperState.ENABLED_SCOPED);
  });
});

describe('11. the reported state distinguishes the cases', () => {
  it('gives a different state for disabled, refused and permitted', () => {
    const disabled = resolveHopperGate(env());
    const refused = resolveHopperGate(env({ [HOPPER_ENV.enabled]: 'true' }));
    const permitted = resolveHopperGate(env({ [HOPPER_ENV.enabled]: 'true', ...SCOPED }));

    expect(new Set([disabled.state, refused.state, permitted.state]).size).toBe(3);
    expect(disabled.state).toBe(HopperState.DISABLED);
    expect(refused.state).toBe(HopperState.REFUSED_CONFIGURATION);
    expect(permitted.state).toBe(HopperState.ENABLED_SCOPED);
  });

  it('never reports running from configuration alone', () => {
    // `running` is a fact about the loop, set by the entrypoint after start()
    // returns. No configuration can produce it.
    for (const over of [{}, { [HOPPER_ENV.enabled]: 'true', ...SCOPED }]) {
      expect(resolveHopperGate(env(over)).state).not.toBe(HopperState.RUNNING);
    }
  });
});

describe('the parsers themselves', () => {
  it('reads a strict boolean or throws', () => {
    expect(readStrictBoolean({ X: 'true' }, 'X')).toBe(true);
    expect(readStrictBoolean({ X: 'false' }, 'X')).toBe(false);
    expect(readStrictBoolean({ X: '  true  ' }, 'X')).toBe(true);
    expect(readStrictBoolean({}, 'X')).toBeUndefined();
    expect(readStrictBoolean({ X: '' }, 'X')).toBeUndefined();
    expect(() => readStrictBoolean({ X: 'maybe' }, 'X')).toThrow(HopperConfigurationError);
  });

  it('trims and drops blanks in an allowlist without inventing a wildcard', () => {
    expect(readAllowlist({ X: 'a, b ,, c ' }, 'X')).toEqual(['a', 'b', 'c']);
    expect(readAllowlist({ X: '' }, 'X')).toEqual([]);
    expect(readAllowlist({}, 'X')).toEqual([]);
    // `*` is an id, not a wildcard. Nothing here expands it.
    expect(readAllowlist({ X: '*' }, 'X')).toEqual(['*']);
  });
});
