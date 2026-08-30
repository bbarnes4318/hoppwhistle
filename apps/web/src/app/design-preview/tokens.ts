/**
 * The token catalogue, as data, so the preview page renders one row per token
 * instead of a hand-maintained list that drifts from globals.css.
 *
 * `light` and `dark` are the literal values in globals.css. They are repeated
 * here only so the page can PRINT the hex — the swatches themselves are painted
 * with `var(--token)` and so always show whatever the stylesheet actually says.
 * If a printed hex ever disagrees with its swatch, globals.css is the truth.
 */

export interface TokenRow {
  name: string;
  light: string;
  dark: string;
  role: string;
  /** Contrast against that theme's --paper, where the token is used as text. */
  onPaper?: { light: number; dark: number };
}

export const SURFACE_TOKENS: TokenRow[] = [
  { name: '--paper', light: '#FBFAF8', dark: '#121110', role: 'page canvas' },
  { name: '--surface', light: '#FFFFFF', dark: '#1B1A18', role: 'cards, panels' },
  {
    name: '--sunken',
    light: '#F3F1EC',
    dark: '#232120',
    role: 'table headers, code blocks, inset areas',
  },
];

export const INK_TOKENS: TokenRow[] = [
  {
    name: '--ink',
    light: '#171614',
    dark: '#F0EEE9',
    role: 'primary text, big numbers',
    onPaper: { light: 17.34, dark: 16.27 },
  },
  {
    name: '--ink-2',
    light: '#55524B',
    dark: '#A8A49B',
    role: 'secondary text',
    onPaper: { light: 7.47, dark: 7.59 },
  },
  {
    name: '--ink-3',
    light: '#8A867C',
    dark: '#75716A',
    role: 'labels, metadata, placeholders',
    onPaper: { light: 3.48, dark: 3.89 },
  },
];

export const RULE_TOKENS: TokenRow[] = [
  { name: '--rule', light: '#E4E0D8', dark: '#2E2C29', role: 'hairlines' },
  {
    name: '--rule-strong',
    light: '#CFC9BD',
    dark: '#413F3C',
    role: 'emphasized dividers (dark value derived — see globals.css)',
  },
];

export const SIGNAL_TOKENS: TokenRow[] = [
  {
    name: '--live',
    light: '#0F7A5A',
    dark: '#3DBF93',
    role: 'connected, billable, earning',
    onPaper: { light: 5.09, dark: 8.15 },
  },
  {
    name: '--ringing',
    light: '#C8801A',
    dark: '#E8A742',
    role: 'in progress, pending, window open',
    onPaper: { light: 3.07, dark: 9.02 },
  },
  {
    name: '--dropped',
    light: '#A8452C',
    dark: '#D9705A',
    role: 'abandoned, missed, failed, disputed',
    onPaper: { light: 5.67, dark: 5.76 },
  },
  {
    name: '--blocked',
    light: '#6B4E9E',
    dark: '#A48BD6',
    role: 'stopped on purpose — DNC, litigator, cap, balance',
    onPaper: { light: 6.27, dark: 6.51 },
  },
  {
    name: '--money',
    light: '#1B4D8F',
    dark: '#6FA3E0',
    role: 'currency, and the one primary action per screen',
    onPaper: { light: 8.04, dark: 7.18 },
  },
];

/** Derived values. Not in the brief; added because components need them. */
export const DERIVED_TOKENS: TokenRow[] = [
  {
    name: '--live-tint',
    light: '#DDECE8',
    dark: '#223E33',
    role: 'chip and lane background for live',
  },
  { name: '--ringing-tint', light: '#F7EDDF', dark: '#483921', role: 'chip background, ringing' },
  { name: '--dropped-tint', light: '#F3E5E1', dark: '#452D27', role: 'chip background, dropped' },
  { name: '--blocked-tint', light: '#EAE6F1', dark: '#393342', role: 'chip background, blocked' },
  { name: '--money-tint', light: '#DFE6EF', dark: '#2D3844', role: 'chip background, money' },
  {
    name: '--live-ink',
    light: '#0E7355',
    dark: '#3DBF93',
    role: 'live as text on live-tint — 4.79:1',
  },
  {
    name: '--ringing-ink',
    light: '#905C13',
    dark: '#E8A742',
    role: 'ringing as text — raw --ringing is only 2.76:1 on its tint',
  },
  { name: '--dropped-ink', light: '#A8452C', dark: '#D9705A', role: 'dropped as text — 4.82:1' },
  { name: '--blocked-ink', light: '#6B4E9E', dark: '#A48BD6', role: 'blocked as text — 5.33:1' },
  { name: '--money-ink', light: '#1B4D8F', dark: '#6FA3E0', role: 'money as text — 6.67:1' },
  {
    name: '--live-deep',
    light: '#0C644A',
    dark: '#2C8A6A',
    role: 'DurationBar overage — the portion past the tick',
  },
];

export interface TypeStep {
  cls: string;
  name: string;
  spec: string;
  usage: string;
  sample: string;
}

/** Sample content is real product content, never lorem. */
export const TYPE_STEPS: TypeStep[] = [
  {
    cls: 't-hero',
    name: '--t-hero',
    spec: '34px / 1.05 · Bricolage 500',
    usage: 'the one number per page',
    sample: '$18,402.65',
  },
  {
    cls: 't-title',
    name: '--t-title',
    spec: '20px / 1.2 · Bricolage 500',
    usage: 'page titles',
    sample: 'ACA Tier-1 — Florida Inbound',
  },
  {
    cls: 't-section',
    name: '--t-section',
    spec: '15px / 1.3 · Inter 500',
    usage: 'panel headers',
    sample: 'Billable calls by source',
  },
  {
    cls: 't-body',
    name: '--t-body',
    spec: '14px / 1.5 · Inter 400',
    usage: 'body copy',
    sample:
      'A call bills when it connects to a buyer and stays connected past the campaign threshold. Calls blocked on compliance never bill.',
  },
  {
    cls: 't-label',
    name: '--t-label',
    spec: '12px / 1.3 · Inter 500 · +0.06em uppercase',
    usage: 'column heads, tile labels',
    sample: 'Billable rate',
  },
  {
    cls: 't-meta',
    name: '--t-meta',
    spec: '12px / 1.4 · Inter 400',
    usage: 'timestamps, helper text',
    sample: 'Updated 2026-08-30 14:22:07 UTC · trailing 30 days',
  },
  {
    cls: 't-figure',
    name: '--t-figure',
    spec: '19px / 1 · Plex Mono 500 · tabular',
    usage: 'tile numbers',
    sample: '1,284',
  },
  {
    cls: 't-data',
    name: '--t-data',
    spec: '13px / 1.4 · Plex Mono 400 · tabular',
    usage: 'table cells',
    sample: '+1 (415) 555-0142',
  },
];

/** Eight DurationBar states, on a shared 180s scale so the bars compare. */
export const DURATION_CASES = [
  {
    title: 'Well under threshold',
    note: 'Nowhere near paying. Read as a loss at a glance.',
    seconds: 8,
    threshold: 60,
  },
  {
    title: 'Just under',
    note: 'The painful one. Two seconds from billable.',
    seconds: 58,
    threshold: 60,
  },
  {
    title: 'Exactly at threshold',
    note: 'Bills. Fill meets the tick with no overage.',
    seconds: 60,
    threshold: 60,
  },
  {
    title: 'Just over',
    note: 'Overage is visible as a deeper segment past the tick.',
    seconds: 72,
    threshold: 60,
  },
  {
    title: 'Well over',
    note: 'Long call. The deep segment carries most of the bar.',
    seconds: 164,
    threshold: 60,
  },
  {
    title: 'No threshold set',
    note: 'Nothing to judge against, so the bar goes neutral and drops the tick.',
    seconds: 74,
    threshold: null,
  },
  {
    title: 'Zero duration',
    note: 'Never connected. Empty track, tick still shown for reference.',
    seconds: 0,
    threshold: 60,
  },
  {
    title: 'Still in progress',
    note: 'Outcome not settled, so it is ringing — not yet green. Edge pulses.',
    seconds: 34,
    threshold: 60,
    inProgress: true,
  },
] as const;
