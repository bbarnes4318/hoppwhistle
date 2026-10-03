import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * /voice-agents embeds the AI Voice app full-bleed.
 *
 * Two regressions this pins: the portal's KPI strip ("Applications, Calls,
 * Conversions") stacked above the app, and the softphone's 96px runway cut a
 * blank band out of the bottom of the frame. And the frame must be told which
 * portal it is in, or a white-labelled agency sees NetEnroll's skin.
 */
const WEB_SRC = join(__dirname, '..', '..');
const read = (...parts: string[]) => readFileSync(join(WEB_SRC, ...parts), 'utf8');

describe('/voice-agents embed', () => {
  const layout = read('app', '(dashboard)', 'layout.tsx');
  const page = read('app', '(dashboard)', 'voice-agents', 'page.tsx');

  it('drops the live strip and the softphone runway on the embedded page', () => {
    expect(layout).toContain("const EMBEDDED_APP_ROUTES = ['/voice-agents'];");
    expect(layout).toMatch(/showLiveStrip = [^;]*!isEmbeddedAppPage/);
    expect(layout).toContain("showFloatingDialer && !isEmbeddedAppPage && 'pb-24'");
  });

  it('passes the portal brand to the frame, once the session has said which', () => {
    expect(page).toContain("u.searchParams.set('brand', brandKey)");
    expect(page).toContain("url && brandSettled ? frameSrc(url, brand?.key ?? 'netenroll')");
  });

  it('fills <main> rather than guessing the chrome height', () => {
    expect(page).not.toContain('calc(100vh');
  });
});
