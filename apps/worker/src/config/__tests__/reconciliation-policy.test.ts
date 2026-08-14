/**
 * The reconciler's configuration surface.
 *
 * Same discipline as the Hopper gate: disabled unless explicitly enabled, and a
 * value that is present but unusable is a refusal that names the variable rather
 * than a silent fallback to a default the operator did not choose.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_POLICY,
  HARD_MIN_DELAY_MS,
  nextDelayMs,
  RECONCILER_ENV,
  ReconciliationConfigurationError,
  readStrictBoolean,
  readStrictInteger,
  resolveReconciliationPolicy,
  type PolicyEnv,
  type ReconciliationPolicy,
} from '../reconciliation-policy.js';

function resolve(env: PolicyEnv) {
  return resolveReconciliationPolicy(env);
}

function enabled(extra: PolicyEnv = {}): ReconciliationPolicy {
  const result = resolve({ [RECONCILER_ENV.enabled]: 'true', ...extra });
  if (!result.ok) throw new Error(`expected a policy, got: ${result.reason}`);
  return result.policy;
}

describe('disabled by default', () => {
  it('an empty environment is disabled', () => {
    const result = resolve({});
    expect(result.ok).toBe(true);
    expect(result.ok && result.policy.enabled).toBe(false);
  });

  it('an empty string is disabled, not an error', () => {
    // The shipped state of an environment that has never been asked to run it.
    expect(resolve({ [RECONCILER_ENV.enabled]: '   ' }).ok).toBe(true);
    expect(enabled({ [RECONCILER_ENV.enabled]: 'true' }).enabled).toBe(true);
  });

  it('refuses anything that is not exactly true or false', () => {
    for (const value of ['1', 'yes', 'on', 'TRUE', 'True', 'ture', 'enabled']) {
      const result = resolve({ [RECONCILER_ENV.enabled]: value });
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toContain(RECONCILER_ENV.enabled);
    }
  });

  it('names the variable and never echoes the value', () => {
    const result = resolve({ [RECONCILER_ENV.enabled]: 'super-secret-typo' });
    expect(result.ok === false && result.reason).not.toContain('super-secret-typo');
  });
});

describe('strict numeric parsing', () => {
  it('accepts digits and nothing else', () => {
    expect(enabled({ [RECONCILER_ENV.maxAttempts]: '9' }).maxAttempts).toBe(9);
  });

  it('refuses a unit suffix rather than silently truncating it', () => {
    // `parseInt('30s', 10)` is 30. A deployment meaning thirty seconds would get
    // thirty milliseconds and re-query its own database thirty times a second.
    for (const value of ['30s', '30 ', ' 3 0', '1_000', '1e3', '10.5', '-5', '+5', '0x10']) {
      const result = resolve({
        [RECONCILER_ENV.enabled]: 'true',
        [RECONCILER_ENV.initialDelayMs]: value,
      });
      expect(result.ok).toBe(false);
    }
  });

  it('refuses a value outside its declared range', () => {
    const tooSmall = resolve({
      [RECONCILER_ENV.enabled]: 'true',
      [RECONCILER_ENV.initialDelayMs]: '10',
    });
    expect(tooSmall.ok).toBe(false);
    expect(tooSmall.ok === false && tooSmall.reason).toContain(RECONCILER_ENV.initialDelayMs);
  });

  it('refuses an unsafe integer', () => {
    expect(() =>
      readStrictInteger({ X: '99999999999999999999' }, 'X', { min: 0, max: 1e21, fallback: 1 })
    ).toThrow(ReconciliationConfigurationError);
  });

  it('falls back only when the variable is absent or empty', () => {
    expect(readStrictInteger({}, 'X', { min: 0, max: 10, fallback: 7 })).toBe(7);
    expect(readStrictInteger({ X: '' }, 'X', { min: 0, max: 10, fallback: 7 })).toBe(7);
    expect(readStrictInteger({ X: '3' }, 'X', { min: 0, max: 10, fallback: 7 })).toBe(3);
  });

  it('reads booleans the same way the Hopper gate does', () => {
    expect(readStrictBoolean({}, 'X')).toBeUndefined();
    expect(readStrictBoolean({ X: 'true' }, 'X')).toBe(true);
    expect(readStrictBoolean({ X: 'false' }, 'X')).toBe(false);
    expect(() => readStrictBoolean({ X: '1' }, 'X')).toThrow(ReconciliationConfigurationError);
  });
});

describe('the defaults are usable', () => {
  it('resolves without any configuration beyond the switch', () => {
    const policy = enabled();
    expect(policy.initialDelayMs).toBe(DEFAULT_POLICY.initialDelayMs);
    expect(policy.maxAttempts).toBe(DEFAULT_POLICY.maxAttempts);
    expect(policy.maxEvidenceAgeMs).toBe(DEFAULT_POLICY.maxEvidenceAgeMs);
    expect(policy.batchSize).toBe(DEFAULT_POLICY.batchSize);
  });

  it('refuses a ceiling below its floor', () => {
    const result = resolve({
      [RECONCILER_ENV.enabled]: 'true',
      [RECONCILER_ENV.initialDelayMs]: '60000',
      [RECONCILER_ENV.maxDelayMs]: '30000',
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain('below its floor');
  });
});

describe('backoff is bounded at both ends', () => {
  it('never returns zero, even with a multiplier of one', () => {
    // A fixed interval is legal; a fixed interval of zero is a hot loop.
    const policy = enabled({ [RECONCILER_ENV.backoffMultiplier]: '1' });
    for (let attempt = 0; attempt < 10; attempt++) {
      expect(nextDelayMs(policy, attempt)).toBeGreaterThanOrEqual(HARD_MIN_DELAY_MS);
    }
  });

  it('grows and then stops growing', () => {
    const policy = enabled();
    expect(nextDelayMs(policy, 0)).toBe(policy.initialDelayMs);
    expect(nextDelayMs(policy, 1)).toBe(policy.initialDelayMs * 2);
    expect(nextDelayMs(policy, 40)).toBe(policy.maxDelayMs);
  });

  it('survives an overflowing exponent', () => {
    // Math.pow(2, 5000) is Infinity, and an Infinity delay is a reservation
    // nothing ever looks at again.
    const policy = enabled();
    expect(Number.isFinite(nextDelayMs(policy, 5_000))).toBe(true);
    expect(nextDelayMs(policy, 5_000)).toBe(policy.maxDelayMs);
  });

  it('treats a negative attempt count as the first attempt', () => {
    const policy = enabled();
    expect(nextDelayMs(policy, -3)).toBe(policy.initialDelayMs);
  });
});

describe('the retry budget cannot be made unbounded', () => {
  it('rejects zero attempts', () => {
    expect(resolve({ [RECONCILER_ENV.enabled]: 'true', [RECONCILER_ENV.maxAttempts]: '0' }).ok).toBe(
      false
    );
  });

  it('caps how large the budget may be', () => {
    expect(
      resolve({ [RECONCILER_ENV.enabled]: 'true', [RECONCILER_ENV.maxAttempts]: '100000' }).ok
    ).toBe(false);
  });

  it('caps the batch so one cycle cannot claim the whole queue', () => {
    expect(
      resolve({ [RECONCILER_ENV.enabled]: 'true', [RECONCILER_ENV.batchSize]: '100000' }).ok
    ).toBe(false);
  });
});
