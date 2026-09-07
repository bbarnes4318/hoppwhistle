/**
 * The FreeSWITCH internal key, for suites that drive `/api/v1/freeswitch/*`.
 *
 * Those endpoints used to have no authentication at all, so the integration
 * suites that exercise the call flow called them bare. They now carry
 * `requireInternalKey` (see `lib/internal-auth.ts`), which is the point of the
 * change and which correctly broke five of those tests. The fix is to
 * authenticate the test caller, never to relax the guard.
 *
 * Shared from here rather than reinvented in each suite so that a future change
 * to how the key travels is one edit, and so that "how does a caller present
 * it" has exactly one answer in the tests as well as in the code.
 */

import { afterAll } from 'vitest';

/** Obviously not a real key, and long enough to look like one. */
export const TEST_INTERNAL_KEY = 'test-internal-key-0000000000000000000000000000';

/**
 * Configure the key for the enclosing suite, and put it back afterwards.
 *
 * Call this in the `describe` body, not inside a hook: it registers an
 * `afterAll`, and vitest only accepts hook registration at collection time.
 *
 * The restore matters because the DB-backed suites share one process (see
 * `vitest.config.ts`, `singleFork`). A suite that set this and walked away
 * would leave the guard configured for every suite that ran after it -- which
 * is precisely how a test asserting the guard REFUSES an unkeyed caller would
 * quietly stop testing anything.
 */
export function useTestInternalKey(): void {
  const previous = process.env.FREESWITCH_INTERNAL_KEY;
  process.env.FREESWITCH_INTERNAL_KEY = TEST_INTERNAL_KEY;

  afterAll(() => {
    if (previous === undefined) {
      delete process.env.FREESWITCH_INTERNAL_KEY;
    } else {
      process.env.FREESWITCH_INTERNAL_KEY = previous;
    }
  });
}

/** Headers a caller that can send one uses. */
export const internalKeyHeaders = { 'x-internal-key': TEST_INTERNAL_KEY };
