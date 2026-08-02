import { describe, expect, it } from 'vitest';

import {
  INTERNAL_AUTH_ERROR_BODY,
  InternalAuthFailure,
  MIN_INTERNAL_TOKEN_LENGTH,
  tokensMatch,
  verifyInternalToken,
} from './internal-auth.js';

const GOOD = 'a-sufficiently-long-internal-token';

describe('production has no insecure default', () => {
  it('refuses when no token is configured', () => {
    const result = verifyInternalToken(undefined, 'anything');
    expect(result.ok).toBe(false);
    expect(result.failure).toBe(InternalAuthFailure.NOT_CONFIGURED);
  });

  it('refuses an empty configured token', () => {
    expect(verifyInternalToken('', 'anything').ok).toBe(false);
  });

  it('treats a short token as absent', () => {
    // A two-character shared secret is not a secret; accepting one would make
    // the control appear present while providing nothing.
    expect(verifyInternalToken('short', 'short').ok).toBe(false);
    expect(verifyInternalToken('x'.repeat(MIN_INTERNAL_TOKEN_LENGTH - 1), 'x').ok).toBe(false);
    expect(
      verifyInternalToken(
        'x'.repeat(MIN_INTERNAL_TOKEN_LENGTH),
        'x'.repeat(MIN_INTERNAL_TOKEN_LENGTH)
      ).ok
    ).toBe(true);
  });

  it('refuses when no token is presented', () => {
    expect(verifyInternalToken(GOOD, undefined).failure).toBe(InternalAuthFailure.MISSING_TOKEN);
    expect(verifyInternalToken(GOOD, '').failure).toBe(InternalAuthFailure.MISSING_TOKEN);
  });

  it('refuses an incorrect token', () => {
    expect(verifyInternalToken(GOOD, 'wrong-token-of-same-ish-len').failure).toBe(
      InternalAuthFailure.INVALID_TOKEN
    );
  });

  it('accepts the correct token', () => {
    expect(verifyInternalToken(GOOD, GOOD).ok).toBe(true);
  });
});

describe('constant-time comparison', () => {
  it('matches identical tokens', () => {
    expect(tokensMatch(GOOD, GOOD)).toBe(true);
  });

  it('rejects a token differing only in the last character', () => {
    expect(tokensMatch(GOOD, `${GOOD.slice(0, -1)}X`)).toBe(false);
  });

  it('rejects a prefix without throwing on the length mismatch', () => {
    // timingSafeEqual throws on unequal lengths; the guard must handle it.
    expect(() => tokensMatch(GOOD, GOOD.slice(0, 5))).not.toThrow();
    expect(tokensMatch(GOOD, GOOD.slice(0, 5))).toBe(false);
  });

  it('handles multi-byte characters without throwing', () => {
    expect(() => tokensMatch(GOOD, 'tökén-wíth-áccents-and-more')).not.toThrow();
  });
});

describe('the error body leaks nothing', () => {
  it('never contains the token or the failure reason', () => {
    const serialized = JSON.stringify(INTERNAL_AUTH_ERROR_BODY);
    expect(serialized).not.toContain(GOOD);
    for (const reason of Object.values(InternalAuthFailure)) {
      expect(serialized).not.toContain(reason);
    }
  });

  it('is identical for every failure mode, so probing reveals nothing', () => {
    // A caller cannot distinguish "not configured" from "wrong token".
    const bodies = [
      verifyInternalToken(undefined, 'x'),
      verifyInternalToken(GOOD, undefined),
      verifyInternalToken(GOOD, 'wrong'),
    ].map(() => JSON.stringify(INTERNAL_AUTH_ERROR_BODY));
    expect(new Set(bodies).size).toBe(1);
  });
});
