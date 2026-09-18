import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Nobody gets sealed inside the call centre.
 *
 * ── The bug ──────────────────────────────────────────────────────────────────
 *
 * `/call-center` is the one route under the dashboard layout that renders
 * fullscreen: the layout returns early for it, so there is no sidebar and no
 * topbar. The only way out is the "Exit console" button in its header, and that
 * button went to /dashboard -- which sends anybody holding AGENT and nothing
 * else straight back to /call-center.
 *
 * Two redirects, each defensible on its own, pointed at each other. The person
 * in the middle could not reach any other page in the application: every route
 * they typed, every link they clicked, landed back on the console. It was found
 * by the owner of an agency, whose account had been given an AGENT role and no
 * OWNER role, so the app read them as an agent and would not let them off the
 * call centre.
 *
 * ── What this test holds ─────────────────────────────────────────────────────
 *
 * Structural, on the source, because the two ends live in different files and
 * the defect is that they disagree -- rendering either one alone would have
 * passed. Both ends have to keep referring to the same marker:
 *
 *   - the exit button records that the person asked to leave, and
 *   - the dashboard's agent bounce reads that record before firing.
 *
 * Delete either and the loop comes back, so both are asserted here.
 */

const webSrc = join(__dirname, '../..');

function read(relative: string): string {
  return readFileSync(join(webSrc, relative), 'utf8');
}

describe('leaving the call centre', () => {
  it('records the request when Exit console is pressed', () => {
    const portal = read('components/call-center/CallCenterPortal.tsx');

    expect(portal).toContain("from '@/lib/console-exit'");
    // The marker is set on the way out, not merely imported.
    expect(portal).toMatch(/markConsoleExit\(\)/);
    expect(portal).toMatch(/onExit=\{[\s\S]*markConsoleExit\(\)[\s\S]*\}/);
  });

  it('keeps the exit button in the console header', () => {
    // The fullscreen layout leaves this button as the only way out, so its
    // removal would restore the trap even with everything else in place.
    const header = read('components/call-center/CallCenterHeader.tsx');
    expect(header).toMatch(/onClick=\{onExit\}/);
  });

  it('does not bounce an agent back to a console they asked to leave', () => {
    const dashboard = read('app/(dashboard)/dashboard/page.tsx');

    expect(dashboard).toContain("from '@/lib/console-exit'");
    // The agent redirect is conditional on the marker, in the same expression.
    expect(dashboard).toMatch(/isAgentOnly\s*&&\s*!hasLeftConsole\(\)/);
  });

  it('starts a new session in the console again', () => {
    // Otherwise one agent stepping out would leave every later session on that
    // tab landing on a dashboard that is not theirs to work from.
    const token = read('lib/session-token.ts');
    expect(token).toMatch(/clearConsoleExit\(\)/);

    const login = read('app/login/page.tsx');
    expect(login).toMatch(/clearConsoleExit\(\)/);
  });

  it('survives storage being unavailable', () => {
    // Private mode throws on access. A throw here would take down the exit
    // handler and the dashboard's redirect effect -- the two places that exist
    // to stop somebody being stuck.
    const marker = read('lib/console-exit.ts');
    const functions = marker.split('export function').slice(1);

    expect(functions).toHaveLength(3);
    for (const fn of functions) {
      expect(fn).toContain('try {');
      expect(fn).toContain('catch');
    }
  });
});

describe('where each role lands', () => {
  it('sends an owner to the dashboard even when they also take calls', async () => {
    // The account that hit this held AGENT. Had it held OWNER as well, the
    // login redirect would have read OWNER first and none of this would have
    // happened -- which is the other half of the fix, applied to the data.
    const { homePathForRoles } = await import('@/lib/roles');

    expect(homePathForRoles(['OWNER', 'AGENT'])).toBe('/dashboard');
    expect(homePathForRoles(['ADMIN', 'AGENT'])).toBe('/dashboard');
    expect(homePathForRoles(['AGENT'])).toBe('/call-center');
  });
});
