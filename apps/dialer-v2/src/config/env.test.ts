/**
 * Strict environment parsing.
 *
 * The reject list here is not hypothetical. Every one of these values was
 * accepted by the `Number.parseInt` readers this module replaces, and the two
 * that matter most are the ones that produced a *number* rather than an error:
 * `"200ms"` became 200 and `"10 seconds"` became 10, so an interval an operator
 * wrote as ten seconds ran a thousand times faster than intended with nothing
 * anywhere reporting a disagreement.
 */

import { describe, expect, it } from 'vitest';

import {
  ConfigurationError,
  nonNegativeIntWithDefault,
  portWithDefault,
  positiveIntWithDefault,
  readNonNegativeInt,
  readPositiveInt,
} from './env.js';

const NAME = 'DIALER_V2_EXAMPLE_MS';
const at = (value: string | undefined) => ({ [NAME]: value });

describe('accepts a complete unsigned base-ten integer', () => {
  it.each([
    ['1', 1],
    ['200', 200],
    ['1000', 1000],
    ['60000', 60_000],
  ])('accepts %o', (raw, expected) => {
    expect(readPositiveInt(at(raw), NAME)).toBe(expected);
  });

  it('trims surrounding whitespace', () => {
    // A trailing newline out of a secrets file or a here-doc is a transport
    // artefact, not a different value.
    expect(readPositiveInt(at('  1000\n'), NAME)).toBe(1000);
    expect(readPositiveInt(at('\t250 '), NAME)).toBe(250);
  });
});

describe('rejects anything that is not exactly that', () => {
  it.each([
    // Zero and negatives: below the minimum for a duration or a count.
    '0',
    '-1',
    // A leading sign is not a digit, even when the value would be in range.
    '+1',
    // Trailing decimals — `parseInt` truncated these silently.
    '1.0',
    '200.5',
    // Exponent notation — `parseInt("1e3")` is 1, not 1000.
    '1e3',
    // Units — the two that caused real thousandfold errors.
    '200ms',
    '10 seconds',
    // Non-finite words that `Number()` would happily coerce.
    'Infinity',
    'NaN',
    // Alternative bases, and a prefix that parses to something plausible.
    '0x10',
    '01abc',
    // Whitespace inside the value is not surrounding whitespace.
    '1 000',
  ])('rejects %o', raw => {
    expect(() => readPositiveInt(at(raw), NAME)).toThrow(ConfigurationError);
  });

  it('rejects a value beyond the safe integer range', () => {
    // 2^53 and above cannot round-trip, so arithmetic on the parsed value would
    // silently disagree with the string it came from.
    expect(() => readPositiveInt(at('9007199254740993'), NAME)).toThrow(/safe integer/);
    expect(() => readPositiveInt(at('99999999999999999999'), NAME)).toThrow(ConfigurationError);
  });
});

describe('absent and invalid are different states', () => {
  it('returns undefined when the variable is unset', () => {
    expect(readPositiveInt({}, NAME)).toBeUndefined();
  });

  it('treats an empty or whitespace-only value as unset', () => {
    // Deployment tooling routinely emits an empty variable for "not configured",
    // and failing on that would break valid deployments.
    expect(readPositiveInt(at(''), NAME)).toBeUndefined();
    expect(readPositiveInt(at('   '), NAME)).toBeUndefined();
  });

  it('applies the default only when absent, never when invalid', () => {
    expect(positiveIntWithDefault({}, NAME, 5_000)).toBe(5_000);
    expect(positiveIntWithDefault(at(''), NAME, 5_000)).toBe(5_000);
    // The distinction that matters: a typo must not silently become the default,
    // because the default then looks like a deliberate choice to whoever reads
    // the running configuration next.
    expect(() => positiveIntWithDefault(at('abc'), NAME, 5_000)).toThrow(ConfigurationError);
  });
});

describe('the error names the variable and never quotes the value', () => {
  it('carries the variable name as structured data', () => {
    try {
      readPositiveInt(at('nonsense'), NAME);
      expect.unreachable('expected a ConfigurationError');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as ConfigurationError).variable).toBe(NAME);
      expect((error as ConfigurationError).code).toBe('DIALER_V2_INVALID_CONFIGURATION');
    }
  });

  it('does not echo the offending value', () => {
    // These parsers run over the whole process environment, which also holds
    // FREESWITCH_ESL_PASSWORD, DIALER_V2_INTERNAL_TOKEN, REDIS_URL and
    // DATABASE_URL. A parser that quotes what it found is one mistyped variable
    // away from writing a credential into a log aggregator.
    const secret = 'p@ssw0rd-do-not-log';
    expect(() => readPositiveInt(at(secret), NAME)).toThrow();
    try {
      readPositiveInt(at(secret), NAME);
    } catch (error) {
      expect((error as Error).message).not.toContain(secret);
      expect(JSON.stringify(error as ConfigurationError)).not.toContain(secret);
    }
  });
});

describe('zero is permitted only where it is a real setting', () => {
  it('accepts zero for a cap that may legitimately be zero', () => {
    // The CPS and concurrency caps default to 0, meaning "permit nothing".
    // Rejecting it would make the safest configuration unwritable.
    expect(readNonNegativeInt(at('0'), NAME)).toBe(0);
    expect(nonNegativeIntWithDefault(at('0'), NAME, 10)).toBe(0);
  });

  it('still rejects a negative cap', () => {
    expect(() => readNonNegativeInt(at('-1'), NAME)).toThrow(ConfigurationError);
  });

  it('rejects zero for a duration, where it is not a usable value', () => {
    expect(() => readPositiveInt(at('0'), NAME)).toThrow(ConfigurationError);
  });
});

describe('ports carry the range a port can occupy', () => {
  it('accepts a port in range', () => {
    expect(portWithDefault(at('8021'), NAME, 9092)).toBe(8021);
    expect(portWithDefault(at('65535'), NAME, 9092)).toBe(65_535);
  });

  it('defaults when unset', () => {
    expect(portWithDefault({}, NAME, 9092)).toBe(9092);
  });

  it('rejects a port above the range rather than truncating it', () => {
    expect(() => portWithDefault(at('65536'), NAME, 9092)).toThrow(/between 1 and 65535/);
    expect(() => portWithDefault(at('0'), NAME, 9092)).toThrow(ConfigurationError);
  });
});
