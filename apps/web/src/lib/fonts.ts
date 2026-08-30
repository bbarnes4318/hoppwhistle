import localFont from 'next/font/local';

/**
 * Three faces, three jobs, loaded from files committed to this repo.
 *
 * WHY LOCAL AND NOT next/font/google. next/font/google fetches from
 * fonts.googleapis.com at BUILD time. That download failed on its first attempt
 * for all three families in CI, and it only recovered because next/font retries
 * three times. When all three retries fail it throws and the build dies — and
 * apps/web/Dockerfile runs `next build` inside the image, so that would take the
 * deploy with it. A design system whose typography depends on a third party
 * being reachable at deploy time is not a foundation.
 *
 * The .woff2 files in ../fonts are the LATIN SUBSET, matching the
 * `subsets: ['latin']` this app already shipped — same coverage as before, no
 * regression. They are Google's own subset files, byte for byte.
 *
 * next/font/local still gives what next/font/google gave: hashed immutable
 * URLs, automatic preload, and a size-adjusted fallback face so swapping in the
 * real font does not shift the layout.
 *
 * ADDING COVERAGE. If Latin Extended is ever needed (accented names in a buyer
 * or publisher list), it cannot simply be added as another `src` entry: entries
 * take only path/weight/style, with no per-file unicode-range, so a second file
 * at the same weight would never be used. It needs either a merged subset file
 * or hand-written @font-face rules with explicit unicode-range.
 *
 * Licences: Bricolage Grotesque, Inter and IBM Plex Mono are all SIL Open Font
 * License 1.1, which permits redistribution in this form. Each family's licence
 * is committed beside its files as fonts/OFL-<Family>.txt.
 */

/**
 * Page titles and hero numbers only — the two type steps that use it, both at
 * weight 500. A STATIC 500 instance, not the variable file: Bricolage carries
 * three axes (opsz, wdth, wght) and the variable latin subset is 77KB against
 * 22KB for the single instance, for pixel-identical output at the one weight we
 * actually set. If a second weight is ever needed, add another static instance
 * rather than reaching for the variable file.
 */
export const fontDisplay = localFont({
  src: [
    {
      path: '../fonts/BricolageGrotesque-500-latin.woff2',
      weight: '500',
      style: 'normal',
    },
  ],
  display: 'swap',
  variable: '--font-display',
  adjustFontFallback: 'Arial',
  fallback: ['ui-sans-serif', 'system-ui', 'sans-serif'],
});

/** Body, labels, buttons, navigation. Variable, 100–900. */
export const fontSans = localFont({
  src: [
    {
      path: '../fonts/Inter-Variable-latin.woff2',
      weight: '100 900',
      style: 'normal',
    },
  ],
  display: 'swap',
  variable: '--font-sans',
  adjustFontFallback: 'Arial',
  fallback: ['ui-sans-serif', 'system-ui', 'sans-serif'],
});

/**
 * Every number in the product: phone numbers, durations, currency, timestamps,
 * call IDs, source IDs. Static 400 and 500 — the only two weights the type
 * scale uses (.t-data and .t-figure).
 *
 * Tabular figures are set on the type steps in globals.css rather than here:
 * font-feature-settings is not reliably honoured as an @font-face descriptor,
 * and the steps are where every caller picks the face up anyway.
 */
export const fontMono = localFont({
  src: [
    { path: '../fonts/IBMPlexMono-400-latin.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/IBMPlexMono-500-latin.woff2', weight: '500', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-mono',
  adjustFontFallback: false, // no metric-compatible monospace to adjust against
  fallback: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
});

/** Every font variable, for the <body> class. */
export const fontVariables = [fontDisplay.variable, fontSans.variable, fontMono.variable].join(' ');
