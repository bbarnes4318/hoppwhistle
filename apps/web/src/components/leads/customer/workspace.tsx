'use client';

/**
 * The customer workspace's layout language.
 *
 * The page is ONE sheet: the command center, the tabs and every tab's
 * content sit on the same surface. Structure comes from type, alignment,
 * hairline dividers and one tonal region (the rail), not from boxes. These
 * pieces are that grammar, so a React component never has to be a card.
 *
 *   Sheet          the single work surface, edge to edge in the canvas
 *   Section        a titled band of the sheet, divided from the next
 *   Kicker         the small label over a figure or a group
 *   Stat           a label over a value, for the operational strip
 *   CarrierMark    a carrier's logo set into the layout -- no plate
 */

import * as React from 'react';

import { carrierBrand } from '@/lib/carrier-brand';
import { cn } from '@/lib/utils';

export function Sheet({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div
      className={cn(
        'min-w-0 overflow-hidden rounded-[12px] border border-rule bg-surface shadow-card',
        className
      )}
    >
      {children}
    </div>
  );
}

/** A small label: sentence case, quiet, never shouting in capitals. */
export function Kicker({
  children,
  className,
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}): JSX.Element {
  return (
    <p id={id} className={cn('text-[12.5px] font-medium leading-4 text-ink-3', className)}>
      {children}
    </p>
  );
}

/** A titled band of the sheet. */
export function Section({
  title,
  meta,
  action,
  id,
  className,
  bodyClassName,
  children,
  divided = true,
}: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  action?: React.ReactNode;
  id?: string;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
  /** A hairline above, separating it from the band before. */
  divided?: boolean;
}): JSX.Element {
  const titleId = id ? `${id}-title` : undefined;
  return (
    <section
      id={id}
      aria-labelledby={titleId}
      className={cn('scroll-mt-4', divided && 'border-t border-rule', className)}
    >
      <div className="flex min-h-[52px] flex-wrap items-center justify-between gap-x-4 gap-y-1 px-7 pt-4">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
          <h2 id={titleId} className="text-[15px] font-semibold text-ink">
            {title}
          </h2>
          {meta ? <span className="text-[13px] text-ink-3">{meta}</span> : null}
        </div>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>
      <div className={cn('px-7 pb-6 pt-3', bodyClassName)}>{children}</div>
    </section>
  );
}

/** A label over a value: the command center's operational facts. */
export function Stat({
  label,
  children,
  sub,
  tone,
  className,
}: {
  label: string;
  children: React.ReactNode;
  sub?: React.ReactNode;
  tone?: 'warn' | 'danger' | 'muted';
  className?: string;
}): JSX.Element {
  return (
    <div className={cn('min-w-0', className)}>
      <Kicker>{label}</Kicker>
      <p
        className={cn(
          'mt-1.5 truncate text-[15px] font-semibold leading-5',
          tone === 'danger'
            ? 'text-dropped-ink'
            : tone === 'warn'
              ? 'text-ringing-ink'
              : tone === 'muted'
                ? 'font-medium text-ink-3'
                : 'text-ink'
        )}
      >
        {children}
      </p>
      {sub ? <p className="mt-0.5 truncate text-[13px] text-ink-3">{sub}</p> : null}
    </div>
  );
}

/**
 * A carrier's logo set straight into the layout, at a fixed visual height,
 * aspect kept. With no logo on file, the carrier's name as a wordmark.
 */
export function CarrierMark({
  names,
  height = 36,
  maxWidth = 168,
  className,
}: {
  names: Array<string | null | undefined>;
  height?: number;
  maxWidth?: number;
  className?: string;
}): JSX.Element {
  const brand = carrierBrand(...names);
  const [failed, setFailed] = React.useState(false);
  const display = names.find((n): n is string => Boolean(n)) ?? 'Carrier';
  if (!brand?.logo || failed) {
    return (
      <span
        aria-hidden
        data-carrier-logo="wordmark"
        className={cn(
          'inline-flex items-center truncate font-bold leading-none tracking-tight text-ink-2',
          className
        )}
        style={{ height, maxWidth, fontSize: Math.round(height * 0.45) }}
      >
        {display.split(/\s*\/\s*/)[0]}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static asset, images are unoptimized
    <img
      src={brand.logo}
      alt=""
      aria-hidden
      decoding="async"
      data-carrier-logo={brand.name}
      onError={() => setFailed(true)}
      className={cn('block w-auto shrink-0 object-contain object-left', className)}
      style={{ height, maxWidth }}
    />
  );
}

/** A text action: the quiet verb beside a heading ("Edit", "View all"). */
export function TextAction({
  onClick,
  children,
  icon: Icon,
  'aria-label': ariaLabel,
  className,
}: {
  onClick: () => void;
  children: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  'aria-label'?: string;
  className?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-control px-2 text-[13px] font-medium text-ink-2 transition-colors',
        'hover:bg-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className
      )}
    >
      {Icon ? <Icon aria-hidden className="h-3.5 w-3.5" /> : null}
      {children}
    </button>
  );
}
