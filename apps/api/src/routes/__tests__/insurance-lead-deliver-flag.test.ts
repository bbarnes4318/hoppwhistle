/**
 * `?deliver=true` on the inbound webhook is the one query parameter that spends
 * money: it posts the lead to the buyer, and a post is spent whether or not the
 * lead sells. Query strings arrive as strings, and `Boolean('false')` is true,
 * so the naive read of this flag posts a lead for a caller who explicitly asked
 * not to — and, because a post burns the 90-day duplicate window, does it in a
 * way that cannot be undone.
 *
 * That trap is what these assertions pin.
 */
import { describe, expect, it } from 'vitest';

import { isTruthyFlag } from '../insurance-leads.js';

describe('isTruthyFlag', () => {
  it('accepts the affirmative spellings a caller would reasonably send', () => {
    expect(isTruthyFlag('true')).toBe(true);
    expect(isTruthyFlag('1')).toBe(true);
    expect(isTruthyFlag('yes')).toBe(true);
  });

  it('is case- and whitespace-insensitive', () => {
    expect(isTruthyFlag('TRUE')).toBe(true);
    expect(isTruthyFlag('True')).toBe(true);
    expect(isTruthyFlag(' true ')).toBe(true);
  });

  it('does not deliver when the caller said not to', () => {
    // `Boolean('false')` is true. Reading the flag that way posts the lead.
    expect(isTruthyFlag('false')).toBe(false);
    expect(isTruthyFlag('0')).toBe(false);
    expect(isTruthyFlag('no')).toBe(false);
  });

  it('does not deliver when the flag is absent or empty', () => {
    expect(isTruthyFlag(undefined)).toBe(false);
    expect(isTruthyFlag('')).toBe(false);
    expect(isTruthyFlag('   ')).toBe(false);
  });

  it('does not deliver on a value it does not understand', () => {
    // Anything unrecognised has to mean "do not send". The failure mode of
    // guessing wrong here is an irreversible post, not a retryable error.
    expect(isTruthyFlag('maybe')).toBe(false);
    expect(isTruthyFlag('deliver')).toBe(false);
    expect(isTruthyFlag('on')).toBe(false);
  });
});
