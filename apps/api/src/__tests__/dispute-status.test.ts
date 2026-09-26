import { describe, expect, it } from 'vitest';

import { OPEN_DISPUTE, isOpenDispute } from '../lib/dispute-status.js';

/**
 * Only 'DISPUTED' is an open dispute. A decided return ('ACCEPTED', 'DENIED')
 * is closed, and so is a value this module has never heard of. The database
 * half -- a denied return reading as payable on Payouts and not disputed on
 * Sales -- is in returns.test.ts, which has the fixture for it.
 */
describe('isOpenDispute', () => {
  it("is true for 'DISPUTED' only", () => {
    expect(OPEN_DISPUTE).toBe('DISPUTED');
    expect(isOpenDispute('DISPUTED')).toBe(true);
  });

  it('is false for a decided return, an unknown value, and no value', () => {
    for (const value of ['ACCEPTED', 'DENIED', 'OPEN', 'disputed', '', null, undefined]) {
      expect(isOpenDispute(value), String(value)).toBe(false);
    }
  });
});
