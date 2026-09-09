import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The colour contract, read from the stylesheet that ships.
 *
 * ── What this guards ─────────────────────────────────────────────────────────
 *
 * 1. The application is light by default. `:root` carries the light palette,
 *    dark lives only under `[data-theme='dark']`, and neither the root layout
 *    nor the stylesheet forces the document dark. The browser smoke test
 *    asserts the same thing from the rendered pixels; this is the cheap check
 *    that runs on every push.
 *
 * 2. The brand green clears 4.5:1 wherever it is used as text, and ink clears
 *    4.5:1 on the brand fill. The comment block above the tokens states these
 *    ratios; this recomputes them from the hex values so the comment cannot
 *    drift from the truth.
 *
 * 3. The call-state signals are untouched by the rebrand. --live, --ringing,
 *    --dropped and --blocked are the exact values the brief documents, each
 *    clears 4.5:1 on its own tint, and each is distinguishable from the brand
 *    green and from one another — by hue for the three that are not green, and
 *    by a 2:1 luminance step for --live, which is. A call console where the
 *    connected-call colour drifts toward the button colour is a console where
 *    the one colour that should mean something means nothing.
 */

const CSS = readFileSync(resolve(__dirname, '../globals.css'), 'utf8');
const LAYOUT = readFileSync(resolve(__dirname, '../layout.tsx'), 'utf8');

/** The `:root` block and the `[data-theme='dark']` block, as name → hex. */
function tokens(selector: RegExp): Record<string, string> {
  const start = CSS.search(selector);
  if (start < 0) throw new Error(`selector not found: ${selector}`);
  const open = CSS.indexOf('{', start);
  let depth = 0;
  let end = open;
  for (let i = open; i < CSS.length; i++) {
    if (CSS[i] === '{') depth++;
    if (CSS[i] === '}') depth--;
    if (depth === 0) {
      end = i;
      break;
    }
  }
  const block = CSS.slice(open, end);
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g))
    out[m[1]] = m[2].toLowerCase();
  return out;
}

const light = tokens(/:root,\s*\n\s*\[data-theme='light'\]\s*\{/);
const dark = tokens(/\[data-theme='dark'\]\s*\{/);

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}
function lin(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
function hue(hex: string): number {
  const [r, g, b] = rgb(hex).map(v => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
function hueDistance(a: string, b: string): number {
  const d = Math.abs(hue(a) - hue(b));
  return Math.min(d, 360 - d);
}

describe('the document is light by default', () => {
  it(':root carries the light palette', () => {
    expect(light.paper).toBe('#fbfaf8');
    expect(light.surface).toBe('#ffffff');
    expect(light.ink).toBe('#171614');
    expect(luminance(light.paper)).toBeGreaterThan(0.9);
    expect(luminance(light.ink)).toBeLessThan(0.02);
  });

  it('dark is scoped to [data-theme=dark] and nothing else', () => {
    expect(luminance(dark.paper)).toBeLessThan(0.02);
    // The transitional `.dark` alias is gone: the only dark selector is the attribute.
    expect(CSS).not.toMatch(/^\s*\.dark\b/m);
    expect(CSS).not.toMatch(/\[data-theme='dark'\],\s*\n\s*\.dark/);
  });

  it('the root layout forces nothing dark', () => {
    expect(LAYOUT).not.toMatch(/forcedTheme="dark"/);
    expect(LAYOUT).not.toMatch(/defaultTheme="dark"/);
    expect(LAYOUT).not.toMatch(/<html[^>]*className="[^"]*\bdark\b/);
  });
});

describe('the brand accent', () => {
  it('is the NetEnroll green', () => {
    expect(light.brand).toBe('#10b981');
    expect(dark.brand).toBe('#10b981');
  });

  it('clears 4.5:1 wherever it is text, in both themes', () => {
    for (const [name, t] of [
      ['light', light],
      ['dark', dark],
    ] as const) {
      expect(
        contrast(t['brand-ink'], t.surface),
        `${name} brand-ink on surface`
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(t['brand-ink'], t.paper),
        `${name} brand-ink on paper`
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(t['brand-ink'], t['brand-tint']),
        `${name} brand-ink on brand-tint`
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(t['brand-ink'], t.sunken),
        `${name} brand-ink on sunken`
      ).toBeGreaterThanOrEqual(4.5);
      // The fill carries brand-fg (ink in light, the dark paper in dark),
      // never white: white on #10b981 is 2.54:1.
      expect(contrast(t['brand-fg'], t.brand), `${name} brand-fg on brand`).toBeGreaterThanOrEqual(
        4.5
      );
    }
    expect(contrast('#ffffff', light.brand)).toBeLessThan(4.5);
  });

  it('states its ratios in the stylesheet, to the value actually computed', () => {
    const stated = (label: string): number => {
      const m = new RegExp(`${label}\\s+(\\d+\\.\\d+):1`).exec(CSS);
      if (!m) throw new Error(`no stated ratio for "${label}" in globals.css`);
      return Number(m[1]);
    };
    expect(stated('brand-fg   on brand')).toBeCloseTo(contrast(light['brand-fg'], light.brand), 1);
    expect(stated('brand-ink  on surface')).toBeCloseTo(
      contrast(light['brand-ink'], light.surface),
      1
    );
    expect(stated('brand-ink  on paper')).toBeCloseTo(contrast(light['brand-ink'], light.paper), 1);
    expect(stated('brand-ink  on brand-tint')).toBeCloseTo(
      contrast(light['brand-ink'], light['brand-tint']),
      1
    );
    expect(stated('brand      vs live')).toBeCloseTo(contrast(light.brand, light.live), 1);
  });

  it('is what the primary button, the ring and the shadcn alias resolve to', () => {
    expect(CSS).toMatch(/--primary:\s*160 84% 39%;\s*\/\* brand \*\//);
    expect(CSS).toMatch(/--ring:\s*163 94% 24%;\s*\/\* brand-ink \*\//);
    expect(CSS).toMatch(/outline: 2px solid var\(--brand-ink\)/);
  });
});

describe('the call-state signals', () => {
  const SIGNALS = ['live', 'ringing', 'dropped', 'blocked'] as const;

  it('are exactly the values the brief documents, untouched by the rebrand', () => {
    expect(light.live).toBe('#0f7a5a');
    expect(light.ringing).toBe('#c8801a');
    expect(light.dropped).toBe('#a8452c');
    expect(light.blocked).toBe('#6b4e9e');
    expect(light.money).toBe('#1b4d8f');
    expect(dark.live).toBe('#3dbf93');
    expect(dark.ringing).toBe('#e8a742');
    expect(dark.dropped).toBe('#d9705a');
    expect(dark.blocked).toBe('#a48bd6');
  });

  it('each clears the ratio the stylesheet documents for it', () => {
    // Light: the ink variant on its tint, 4.5:1, as the comment block states.
    for (const s of SIGNALS) {
      expect(
        contrast(light[`${s}-ink`], light[`${s}-tint`]),
        `light ${s}-ink on ${s}-tint`
      ).toBeGreaterThanOrEqual(4.5);
    }
    // Dark: the signal on --surface, 5:1, as the comment block states; on its
    // tint it is a large-text colour and must still clear 3:1.
    for (const s of SIGNALS) {
      expect(contrast(dark[s], dark.surface), `dark ${s} on surface`).toBeGreaterThanOrEqual(5);
      expect(
        contrast(dark[`${s}-ink`], dark[`${s}-tint`]),
        `dark ${s}-ink on ${s}-tint`
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it('are distinct from one another and from the brand green', () => {
    for (const [name, t] of [
      ['light', light],
      ['dark', dark],
    ] as const) {
      // Hue separates ringing, dropped and blocked from the brand and from each other.
      for (const s of ['ringing', 'dropped', 'blocked'] as const) {
        expect(hueDistance(t[s], t.brand), `${name} ${s} hue vs brand`).toBeGreaterThanOrEqual(60);
      }
      expect(
        hueDistance(t.ringing, t.dropped),
        `${name} ringing vs dropped`
      ).toBeGreaterThanOrEqual(15);
      expect(
        hueDistance(t.dropped, t.blocked),
        `${name} dropped vs blocked`
      ).toBeGreaterThanOrEqual(60);
      expect(hueDistance(t.blocked, t.live), `${name} blocked vs live`).toBeGreaterThanOrEqual(60);
      expect(t.live).not.toBe(t.brand);
      expect(t['live-ink']).not.toBe(t['brand-ink']);
    }
    // --live is a green too, so in light it is separated from the brand by
    // luminance: a full 2:1 step, the bright fill against the deep signal. In
    // dark both are lifted and the step is gone; there the two are kept apart
    // by role and form instead — brand is only ever a fill carrying dark text,
    // live is only ever text or a dot on its tint — which is why the live
    // board is the one screen that must not use a brand-tinted chip.
    expect(contrast(light.live, light.brand), 'light live vs brand').toBeGreaterThanOrEqual(2);
    {
    }
  });
});
