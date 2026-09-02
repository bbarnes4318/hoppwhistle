/**
 * The Google sign-in buttons render only when the login page has a client id,
 * and the API verifies every token against its own hardcoded id. A mismatch,
 * or an empty value on the web side, produces no error anywhere — the buttons
 * just stop existing. That is exactly how they disappeared in production.
 *
 * This pins the two ids together by reading both files, so a change to either
 * one alone fails here instead of silently removing sign-in.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { describe, expect, it } from 'vitest';

const repoRoot = join(__dirname, '..', '..', '..', '..', '..', '..');

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

/** Every Google OAuth client id appearing in a file. */
function clientIds(source: string): string[] {
  return source.match(/[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com/g) ?? [];
}

describe('Google OAuth client id', () => {
  const webIds = clientIds(read('apps/web/src/app/login/page.tsx'));
  const apiIds = clientIds(read('apps/api/src/services/google-auth.ts'));

  it('is present on the web side', () => {
    // An empty default disables the buttons with no error shown to anyone.
    expect(webIds.length).toBeGreaterThan(0);
  });

  it('is present on the API side', () => {
    expect(apiIds.length).toBeGreaterThan(0);
  });

  it('is the same id on both sides', () => {
    // The API only ever accepts tokens minted for its own client id.
    expect(webIds[0]).toBe(apiIds[0]);
  });

  it('does not depend on an environment variable alone', () => {
    const source = read('apps/web/src/app/login/page.tsx');
    // `??` treats compose's empty string as a real value and skips the
    // fallback; `||` is what makes the default reachable.
    expect(source).toMatch(/process\.env\.NEXT_PUBLIC_GOOGLE_CLIENT_ID\s*\|\|/);
  });
});
