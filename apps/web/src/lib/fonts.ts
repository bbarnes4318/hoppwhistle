import { Bricolage_Grotesque, IBM_Plex_Mono, Inter } from 'next/font/google';

/**
 * Three faces, three jobs. All loaded through next/font, which downloads them
 * at build time and serves them from this origin — no runtime request to
 * Google, no layout shift, no third-party font CDN in the critical path.
 *
 * Each exposes a CSS variable consumed by tailwind.config.ts and by the type
 * scale classes in globals.css. Nothing should reference the font objects'
 * `.className` directly except the root layout.
 */

/** Page titles and hero numbers only. Used sparingly, on purpose. */
export const fontDisplay = Bricolage_Grotesque({
  subsets: ['latin'],
  weight: 'variable',
  display: 'swap',
  variable: '--font-display',
  // Bricolage is optically sized; pin the axis so titles and hero numbers do
  // not drift in weight between the two steps that use them.
  axes: ['opsz'],
  fallback: ['ui-sans-serif', 'system-ui', 'sans-serif'],
});

/** Body, labels, buttons, navigation. */
export const fontSans = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
  fallback: ['ui-sans-serif', 'system-ui', 'sans-serif'],
});

/**
 * Every number in the product: phone numbers, durations, currency, timestamps,
 * call IDs, source IDs. Tabular figures are set here at the face level and
 * again on the .t-figure / .t-data type steps, so a column of money stays in
 * column even if a caller reaches for the family without the step.
 */
export const fontMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-mono',
  fallback: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
});

/** Convenience: every font variable, for the <body> class. */
export const fontVariables = [fontDisplay.variable, fontSans.variable, fontMono.variable].join(
  ' '
);
