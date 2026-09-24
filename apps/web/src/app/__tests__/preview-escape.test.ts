import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * A role preview must never send an operator somewhere the preview cannot be
 * left.
 *
 * ── The lockout ──────────────────────────────────────────────────────────────
 *
 * A platform operator can view an agency as one of its roles, and a preview
 * REPLACES their own roles rather than adding to them --
 * `middleware/auth.ts` answers `[previewRole]`, so `/api/auth/me` hands the
 * browser exactly `['AGENT']` for an operator previewing as an agent. Every
 * guard, nav item and redirect in the app then reads them as an agent.
 *
 * Two consequences met:
 *
 *   1. `homePathForRoles(['AGENT'])` is `/call-center`, and the dashboard page
 *      pushed them back there whenever they reached /dashboard.
 *   2. `/call-center` renders fullscreen, with no topbar -- and the topbar is
 *      what renders `RolePreviewBanner`, which holds the only "Leave preview"
 *      control in the application.
 *
 * So the preview routed the operator to the one page from which the preview
 * could not be ended, and kept them there. The account's own roles read
 * `ADMIN, OWNER` throughout, which is what made it so hard to see: every query
 * anybody ran said the account was fine.
 *
 * ── What this test holds ─────────────────────────────────────────────────────
 *
 * Structural, on the source. The defect was never inside one component -- each
 * behaved correctly alone. It was three files disagreeing about what a
 * previewing operator is, so what has to be asserted is that they agree.
 */

const webSrc = join(__dirname, '../..');

function read(relative: string): string {
  return readFileSync(join(webSrc, relative), 'utf8');
}

describe('a platform operator previewing a role', () => {
  it('can leave the preview from the fullscreen call centre', () => {
    const layout = read('app/(dashboard)/layout.tsx');

    // The fullscreen branch returns before the standard shell, so it renders no
    // topbar and has to mount the banner itself.
    const fullscreen = layout.slice(layout.indexOf('if (isCallCenterPage) {'));
    expect(fullscreen).toContain('<RolePreviewBanner />');
    expect(layout).toContain("from '@/components/platform/role-preview-switcher'");
  });

  it('keeps the only exit control on the banner', () => {
    // If this button moves or is renamed, the assertion above stops meaning
    // anything: it would be mounting a strip with no way out of the preview.
    const banner = read('components/platform/role-preview-switcher.tsx');
    expect(banner).toContain('Leave preview');
    expect(banner).toMatch(/setPreviewRole\(null\)/);
  });

  it('is not redirected off the dashboard by the previewed role', () => {
    const dashboard = read('app/(dashboard)/dashboard/page.tsx');

    expect(dashboard).toContain("from '@/hooks/use-platform-context'");
    // The same early return the layout makes, and for the same reason. Reading
    // `isPlatformAdmin` without `loading` is the defect the layout documents:
    // this effect settles before the platform context lands.
    expect(dashboard).toMatch(/if \(platform\.loading \|\| platform\.isPlatformAdmin\) return;/);
  });

  it('is left alone by the layout too, so the two files agree', () => {
    const layout = read('app/(dashboard)/layout.tsx');
    expect(layout).toMatch(/if \(platform\.loading \|\| platform\.isPlatformAdmin\) return;/);
  });
});

describe('what a previewed role routes to', () => {
  it('sends a lone AGENT to My calls', async () => {
    // A preview is deliberately indistinguishable from a real agent. /calls
    // renders with the normal shell, so the "Leave preview" banner is there.
    const { homePathForRoles } = await import('@/lib/roles');
    expect(homePathForRoles(['AGENT'])).toBe('/calls');
  });
});
