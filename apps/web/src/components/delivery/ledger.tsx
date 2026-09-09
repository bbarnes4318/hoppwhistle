import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * The pieces the money screens are built from.
 *
 * ── Why these exist ──────────────────────────────────────────────────────────
 *
 * /delivery, the platform view and /delivery/settlements were each built from
 * a grid of shadcn Cards, every figure at text-3xl bold. Twelve numbers at the
 * same weight is twelve numbers the reader has to rank themselves, and a card
 * around each one is a border separating things already separated by space.
 *
 * These read closer to a bank statement: one hairline between groups, labels
 * small and quiet, figures in the mono face so digits line up between rows,
 * and exactly one figure per screen allowed to be the largest thing.
 */

/** A row of figures separated by hairlines, not boxes. */
export function FigureRow({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4',
        '[&>*]:min-w-0 md:[&>*+*]:border-l md:[&>*+*]:border-rule md:[&>*+*]:pl-6',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export interface FigureProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Uppercase label above the figure. */
  label: React.ReactNode;
  /** The number, preformatted. An em dash for an absent value, never a zero. */
  value: React.ReactNode;
  /** One or two quiet lines under the figure — denominator, period, caveat. */
  sub?: React.ReactNode;
  /**
   * `hero` is the one number the screen is about (34px). `figure` is a
   * supporting number (19px). `quiet` is a supporting number that must not be
   * read as a result — today's closing percentage, a provisional rate.
   */
  size?: 'hero' | 'figure' | 'quiet';
  /** Tone for the value. Ink by default; a signal only when it means one. */
  tone?: 'ink' | 'ink-2' | 'dropped' | 'ringing' | 'live' | 'money';
  /** Native tooltip. */
  title?: string;
}

const TONE: Record<NonNullable<FigureProps['tone']>, string> = {
  ink: 'text-ink',
  'ink-2': 'text-ink-2',
  dropped: 'text-dropped-ink',
  ringing: 'text-ringing-ink',
  live: 'text-live-ink',
  money: 'text-money-ink',
};

export function Figure({
  label,
  value,
  sub,
  size = 'figure',
  tone = 'ink',
  title,
  className,
  ...props
}: FigureProps) {
  return (
    <div
      className={cn('flex min-w-0 flex-col', className)}
      title={title}
      /*
        Machine-readable, for the browser smoke test that checks the live strip
        above the page and the figure below it report the same number for the
        same tenant. Only the plain-string cases carry the attributes; a figure
        whose label or value is composed of elements is not one the strip also
        shows.
      */
      data-figure-label={typeof label === 'string' ? label : undefined}
      data-figure-value={typeof value === 'string' ? value : undefined}
      {...props}
    >
      <div className="t-label text-ink-3">{label}</div>
      <div
        className={cn(
          'mt-1 min-w-0 truncate',
          size === 'hero' && 't-hero font-mono tabular',
          size === 'figure' && 't-figure',
          size === 'quiet' && 't-figure',
          size === 'quiet' && tone === 'ink' ? 'text-ink-2' : TONE[tone]
        )}
      >
        {value}
      </div>
      {sub ? <div className="t-meta mt-1 text-ink-3">{sub}</div> : null}
    </div>
  );
}

/** A section heading: one rule, one label, an optional note at the right. */
export function SectionRule({
  children,
  note,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { note?: React.ReactNode }) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-4 border-t border-rule pt-3',
        className
      )}
      {...props}
    >
      <h2 className="t-section text-ink">{children}</h2>
      {note ? <div className="t-meta text-right text-ink-3">{note}</div> : null}
    </div>
  );
}

/**
 * A one-line notice above the figures. Tinted, not boxed: the tint is the
 * signal, and a border around a tinted block is a second signal saying the
 * same thing.
 */
export function Notice({
  tone,
  icon,
  title,
  children,
  className,
  ...props
}: Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> & {
  tone: 'dropped' | 'ringing' | 'money' | 'blocked';
  icon?: React.ReactNode;
  title: React.ReactNode;
}) {
  const TONES = {
    dropped: 'bg-dropped-tint text-dropped-ink',
    ringing: 'bg-ringing-tint text-ringing-ink',
    money: 'bg-money-tint text-money-ink',
    blocked: 'bg-blocked-tint text-blocked-ink',
  } as const;
  return (
    <div
      role="status"
      className={cn('flex items-start gap-2 rounded-card px-3 py-2 t-body', TONES[tone], className)}
      {...props}
    >
      {icon ? <span className="mt-0.5 shrink-0">{icon}</span> : null}
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        {children ? <div className="mt-0.5 text-ink-2">{children}</div> : null}
      </div>
    </div>
  );
}

/**
 * Ledger table chrome. A plain <table> with the density these screens need:
 * a sticky header so 45 rows never scroll past it, 32px rows, numbers right
 * aligned in the mono face. Column classes are the caller's; this is the
 * frame.
 */
export function Ledger({
  children,
  className,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <table
      className={cn(
        'w-full border-collapse text-left t-body',
        '[&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10 [&_thead_th]:bg-surface',
        '[&_thead_th]:h-8 [&_thead_th]:whitespace-nowrap [&_thead_th]:border-b [&_thead_th]:border-rule-strong [&_thead_th]:px-2 [&_thead_th]:align-middle [&_thead_th]:t-label [&_thead_th]:text-ink-3',
        '[&_tbody_td]:h-8 [&_tbody_td]:border-b [&_tbody_td]:border-rule [&_tbody_td]:px-2 [&_tbody_td]:py-0 [&_tbody_td]:align-middle',
        '[&_tbody_tr:last-child_td]:border-b-0',
        '[&_.num]:text-right [&_.num]:t-data [&_.num]:text-ink',
        '[&_th.num]:t-label [&_th.num]:text-ink-3',
        className
      )}
      {...props}
    >
      {children}
    </table>
  );
}

/** Percentages, or an em dash. Never a fabricated 0%. */
export function pct(value: number | null | undefined, digits = 2): string {
  return value === null || value === undefined ? '—' : `${value.toFixed(digits)}%`;
}

/** Dollars to the cent, or an em dash. Under review there is no rate, not $0. */
export function dollars(value: number | null | undefined): string {
  return value === null || value === undefined
    ? '—'
    : `$${value.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
}

/** A count with thousands separators. */
export function count(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : value.toLocaleString();
}

export function duration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/** Signed difference in points, to one decimal. */
export function points(delta: number): string {
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
  return `${sign}${Math.abs(delta).toFixed(1)}`;
}
