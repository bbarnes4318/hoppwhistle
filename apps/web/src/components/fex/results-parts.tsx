'use client';

/**
 * The pieces of the quoter's results pane around the rows themselves: the
 * command bar (the answer in numbers, the categories, sort, filter and
 * search), what the last edit changed, the column headings, and the pane
 * before a quote and while the first one runs.
 *
 * Typography and dividers rather than a box per number: the pane is a
 * decision surface, so the figures are what carry weight.
 */

import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronDown,
  Keyboard,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { money } from '@/lib/fex/api';
import { isOutcomeChange, type OutcomeChange } from '@/lib/fex/outcome-diff';
import {
  activeFilterChips,
  BENEFIT_FILTER_LABEL,
  RATE_FILTER_LABEL,
  type BenefitFilter,
  type RateFilter,
  type ResultCategory,
  type ResultFilters,
  type SortKey,
} from '@/lib/fex/results-view';
import { cn } from '@/lib/utils';

import { CheckRow, FOCUS } from './parts';
import { changeParts, RESULT_COLUMNS } from './result-row';

/** The keyboard, as the shortcuts menu and the empty pane both list it. */
export const SHORTCUTS: ReadonlyArray<[string, string]> = [
  ['Alt+H', 'Search conditions'],
  ['Alt+M', 'Search medications'],
  ['↑ / ↓', 'Move between carriers'],
  ['Enter', 'Open or close a carrier'],
  ['C', 'Add the carrier to the comparison'],
];

export function ShortcutList({ className }: { className?: string }): JSX.Element {
  return (
    <dl className={cn('grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12.5px]', className)}>
      {SHORTCUTS.map(([key, what]) => (
        <React.Fragment key={key}>
          <dt>
            <kbd className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-[5px] border border-rule bg-surface px-1.5 font-sans text-[11px] font-semibold text-ink-2 shadow-[0_1px_0_var(--rule)]">
              {key}
            </kbd>
          </dt>
          <dd className="self-center text-ink-2">{what}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

// ─── The command bar ─────────────────────────────────────────────────────────

const CATEGORY_LABEL: Record<ResultCategory, string> = {
  qualified: 'Qualified',
  review: 'Needs review',
  declined: 'Declined',
  notAppointed: 'Not appointed',
};

export interface ResultsBarProps {
  idPrefix: string;
  quoted: number;
  qualified: number;
  counts: Record<ResultCategory, number>;
  category: ResultCategory;
  onCategory: (c: ResultCategory) => void;
  showNotAppointedTab: boolean;
  lowestAny: number | null;
  lowestLevel: number | null;
  coverage: string;
  mode: string;
  carriers?: { selected: number; total: number } | null;
  updating: boolean;
  sort: SortKey;
  onSort: (sort: SortKey) => void;
  filters: ResultFilters;
  onFilters: (patch: Partial<ResultFilters>) => void;
  hiddenByFilters: number;
  /** The id of the list the category tabs control. */
  listId: string;
  /** Rendered under the bar: what changed, then the column headings. */
  children?: React.ReactNode;
}

export function ResultsBar(props: ResultsBarProps): JSX.Element {
  const {
    idPrefix,
    quoted,
    qualified,
    counts,
    category,
    onCategory,
    showNotAppointedTab,
    lowestAny,
    lowestLevel,
    coverage,
    mode,
    carriers,
    updating,
    sort,
    onSort,
    filters,
    onFilters,
    hiddenByFilters,
    listId,
    children,
  } = props;
  const chips = activeFilterChips(filters);
  const popoverCount =
    (filters.benefit !== 'any' && filters.benefit !== 'level' ? 1 : 0) +
    (filters.rate !== 'any' ? 1 : 0) +
    (filters.showNotAppointed ? 1 : 0);
  const categories: ResultCategory[] = [
    'qualified',
    'review',
    'declined',
    ...(showNotAppointedTab ? (['notAppointed'] as const) : []),
  ];

  /** Arrow keys between the category tabs, as tabs do. */
  const onTabKey = (e: React.KeyboardEvent<HTMLButtonElement>, at: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next =
      categories[(at + (e.key === 'ArrowRight' ? 1 : -1) + categories.length) % categories.length];
    onCategory(next);
    requestAnimationFrame(() => document.getElementById(`${idPrefix}-cat-${next}`)?.focus());
  };

  return (
    <section aria-label="Summary" className="sticky top-0 z-10 -mx-px bg-paper pb-2">
      <div className="overflow-hidden rounded-t-[12px] border border-b-0 border-rule bg-surface">
        {/* A thin bar while a re-quote runs: the figures stay readable. */}
        <div
          aria-hidden
          className={cn(
            'h-0.5 w-full overflow-hidden',
            updating ? 'bg-brand-tint' : 'bg-transparent'
          )}
        >
          {updating ? (
            <div className="h-full w-1/3 bg-brand-strong motion-safe:animate-[ne-progress_1.1s_ease-in-out_infinite]" />
          ) : null}
        </div>

        {/* The answer: how many qualify, and the prices that matter. */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1 px-4 pb-2 pt-1.5">
          <h2 className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-ink">
            <span className="text-[20px] font-bold leading-7 tracking-[-0.015em]">
              <span className="tabular-nums">{qualified}</span> qualify
            </span>
            <span className="whitespace-nowrap text-[13px] font-medium text-ink-3">
              of <span className="tabular-nums">{quoted}</span> quoted
            </span>
            {carriers ? (
              // The agent quotes only the carriers they picked on Account.
              <Link
                href="/account#quote-carriers"
                title="Choose the carriers you quote"
                className={cn(
                  'inline-flex items-center gap-1 self-center whitespace-nowrap rounded-full bg-brand-tint px-2 py-0.5 text-[11.5px] font-semibold text-brand-ink hover:underline',
                  FOCUS
                )}
              >
                <span className="tabular-nums">
                  {carriers.selected} of {carriers.total}
                </span>{' '}
                carriers
              </Link>
            ) : null}
            {updating ? (
              <span className="self-center text-[12px] font-medium text-ink-3">Updating…</span>
            ) : null}
          </h2>
          <dl className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <Stat label="Best price">
              {lowestAny === null ? '—' : money(lowestAny)}
              {lowestAny === null ? null : <Unit>/{mode}</Unit>}
            </Stat>
            <Stat label="Best level">
              {lowestLevel === null ? '—' : money(lowestLevel)}
              {lowestLevel === null ? null : <Unit>/{mode}</Unit>}
            </Stat>
            <Stat label="Coverage" className="hidden [@container(min-width:760px)]:flex">
              {coverage}
            </Stat>
          </dl>
        </div>

        {/* Categories at the left; sort, filter, search at the right. */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-rule px-2 py-1.5">
          <div
            role="tablist"
            aria-label="Result categories"
            className="flex flex-wrap items-center gap-0.5"
          >
            {categories.map((c, i) => {
              const on = category === c;
              const n = counts[c];
              return (
                <button
                  key={c}
                  id={`${idPrefix}-cat-${c}`}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  aria-controls={listId}
                  tabIndex={on ? 0 : -1}
                  onClick={() => onCategory(c)}
                  onKeyDown={e => onTabKey(e, i)}
                  className={cn(
                    'inline-flex h-8 items-center gap-1 rounded-control px-2 text-[13px] font-medium transition-colors duration-150 ne-motion',
                    on ? 'bg-ink text-surface' : 'text-ink-2 hover:bg-sunken hover:text-ink',
                    FOCUS
                  )}
                >
                  {CATEGORY_LABEL[c]}
                  <span
                    className={cn(
                      'rounded-full px-1.5 text-[11.5px] font-semibold tabular-nums leading-[18px]',
                      on
                        ? 'text-surface'
                        : n && c === 'declined'
                          ? 'bg-dropped-tint text-dropped-ink'
                          : n && c === 'review'
                            ? 'bg-ringing-tint text-ringing-ink'
                            : 'bg-sunken text-ink-2'
                    )}
                  >
                    {n}
                  </span>
                </button>
              );
            })}
          </div>

          <div
            role="toolbar"
            aria-label="Sort and filter results"
            className="flex flex-wrap items-center gap-1.5"
          >
            <ResultsSearch
              id={`${idPrefix}-results-search`}
              value={filters.search}
              onChange={search => onFilters({ search })}
            />
            <span className="relative inline-flex items-center">
              <label htmlFor={`${idPrefix}-sort`} className="sr-only">
                Sort by
              </label>
              <select
                id={`${idPrefix}-sort`}
                value={sort}
                onChange={e => onSort(e.target.value as SortKey)}
                className={cn(
                  'h-8 cursor-pointer appearance-none rounded-control border border-rule-strong bg-surface pl-2.5 pr-7 text-[13px] font-semibold text-ink hover:border-ink-3',
                  FOCUS
                )}
              >
                <option value="price">Lowest price</option>
                <option value="face">Most coverage</option>
                <option value="carrier">Carrier A–Z</option>
              </select>
              <ChevronDown
                className="pointer-events-none absolute right-2 h-3.5 w-3.5 text-ink-3"
                aria-hidden
              />
            </span>
            <button
              type="button"
              aria-pressed={filters.benefit === 'level'}
              onClick={() => onFilters({ benefit: filters.benefit === 'level' ? 'any' : 'level' })}
              className={cn(
                'inline-flex h-8 items-center rounded-control border px-2.5 text-[13px] font-medium transition-colors duration-150 ne-motion',
                filters.benefit === 'level'
                  ? 'border-brand-ink bg-brand-tint text-brand-ink'
                  : 'border-rule-strong bg-surface text-ink-2 hover:border-ink-3 hover:text-ink',
                FOCUS
              )}
            >
              Level only
            </button>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={popoverCount ? `Filters, ${popoverCount} on` : 'Filters'}
                  className={cn(
                    'inline-flex h-8 items-center gap-1.5 rounded-control border px-2 text-[13px] font-medium transition-colors duration-150 ne-motion',
                    popoverCount
                      ? 'border-ink-2 bg-surface text-ink'
                      : 'border-rule-strong bg-surface text-ink-2 hover:border-ink-3 hover:text-ink',
                    FOCUS
                  )}
                >
                  <SlidersHorizontal className="h-4 w-4" aria-hidden />
                  {popoverCount ? (
                    <span className="rounded-full bg-ink px-1.5 text-[10.5px] font-semibold leading-4 text-surface">
                      {popoverCount}
                    </span>
                  ) : null}
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 space-y-3 p-3">
                <fieldset>
                  <legend className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-3">
                    Benefit
                  </legend>
                  <div className="space-y-1">
                    {(Object.keys(BENEFIT_FILTER_LABEL) as BenefitFilter[]).map(b => (
                      <label
                        key={b}
                        className="flex cursor-pointer items-center gap-2 text-[13px] text-ink"
                      >
                        <input
                          type="radio"
                          name={`${idPrefix}-benefit`}
                          checked={filters.benefit === b}
                          onChange={() => onFilters({ benefit: b })}
                          className={cn('h-3.5 w-3.5 accent-[var(--brand)]', FOCUS)}
                        />
                        {BENEFIT_FILTER_LABEL[b]}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <fieldset className="border-t border-rule pt-3">
                  <legend className="mb-1.5 pt-3 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-3">
                    Rate status
                  </legend>
                  <div className="space-y-1">
                    {(Object.keys(RATE_FILTER_LABEL) as RateFilter[]).map(rate => (
                      <label
                        key={rate}
                        className="flex cursor-pointer items-center gap-2 text-[13px] text-ink"
                      >
                        <input
                          type="radio"
                          name={`${idPrefix}-rate`}
                          checked={filters.rate === rate}
                          onChange={() => onFilters({ rate })}
                          className={cn('h-3.5 w-3.5 accent-[var(--brand)]', FOCUS)}
                        />
                        {RATE_FILTER_LABEL[rate]}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="space-y-2 border-t border-rule pt-3">
                  <CheckRow
                    id={`${idPrefix}-not-appointed`}
                    checked={filters.showNotAppointed}
                    onChange={showNotAppointed => onFilters({ showNotAppointed })}
                    className="text-[13px]"
                  >
                    Include carriers you are not appointed with
                    <span className="t-meta block text-ink-3">
                      For reference: you cannot write them
                    </span>
                  </CheckRow>
                </div>
                <details className="border-t border-rule pt-2.5">
                  <summary
                    className={cn('cursor-pointer text-[12.5px] font-medium text-ink-2', FOCUS)}
                  >
                    Keyboard shortcuts
                  </summary>
                  <ShortcutList className="mt-2" />
                </details>
              </PopoverContent>
            </Popover>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="Keyboard shortcuts"
                  title="Keyboard shortcuts"
                  className={cn(
                    'hidden h-8 w-8 items-center justify-center rounded-control text-ink-3 hover:bg-sunken hover:text-ink [@container(min-width:720px)]:inline-flex',
                    FOCUS
                  )}
                >
                  <Keyboard className="h-4 w-4" aria-hidden />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 p-3">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-3">
                  Keyboard
                </p>
                <ShortcutList />
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {chips.length ? (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-rule px-3 py-1.5">
            <span className="text-[12px] text-ink-3">
              Filtered{hiddenByFilters ? ` · ${hiddenByFilters} hidden` : ''}:
            </span>
            {chips.map(chip => (
              <button
                key={chip.key}
                type="button"
                aria-label={`Remove filter: ${chip.label}`}
                onClick={() =>
                  onFilters(
                    chip.key === 'benefit'
                      ? { benefit: 'any' }
                      : chip.key === 'search'
                        ? { search: '' }
                        : { [chip.key]: false }
                  )
                }
                className={cn(
                  'inline-flex h-6 items-center gap-1 rounded-full border border-rule-strong bg-surface pl-2 pr-1 text-[12px] font-medium text-ink hover:border-ink-3',
                  FOCUS
                )}
              >
                {chip.label}
                <X className="h-3 w-3 text-ink-3" aria-hidden />
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/**
 * Search over carriers and products: an icon until it is wanted, so the
 * command bar stays one line; open while it holds a query.
 */
function ResultsSearch({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}): JSX.Element {
  const [open, setOpen] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  if (!open && !value) {
    return (
      <button
        type="button"
        aria-label="Search carriers or products"
        title="Search carriers or products"
        onClick={() => {
          setOpen(true);
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        className={cn(
          'inline-flex h-8 w-8 items-center justify-center rounded-control border border-rule-strong bg-surface text-ink-2 hover:border-ink-3 hover:text-ink',
          FOCUS
        )}
      >
        <Search className="h-4 w-4" aria-hidden />
      </button>
    );
  }
  return (
    <span className="relative inline-flex items-center">
      <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-ink-3" aria-hidden />
      <input
        ref={inputRef}
        id={id}
        type="search"
        aria-label="Search carriers or products"
        placeholder="Carrier or product"
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={() => setOpen(false)}
        onKeyDown={e => {
          if (e.key === 'Escape') {
            onChange('');
            setOpen(false);
          }
        }}
        className={cn(
          'h-8 w-[150px] rounded-control border border-brand-ink bg-surface pl-7 pr-2 text-[13px] text-ink placeholder:text-ink-3',
          FOCUS
        )}
      />
    </span>
  );
}

function Stat({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className={cn('flex items-baseline gap-1.5', className)}>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-3">{label}</dt>
      <dd className="text-[16px] font-bold tabular-nums tracking-[-0.01em] text-ink">{children}</dd>
    </div>
  );
}

function Unit({ children }: { children: React.ReactNode }): JSX.Element {
  return <span className="ml-0.5 text-[12px] font-medium text-ink-3">{children}</span>;
}

/**
 * The list's column headings, on the same grid as the rows, pinned with the
 * command bar so the numbers never lose their names.
 */
export function ColumnHeadings({ compare }: { compare: boolean }): JSX.Element {
  return (
    <div
      aria-hidden
      className="cq flex items-center border border-y border-rule bg-sunken pr-2 text-[10.5px] font-bold uppercase leading-7 tracking-[0.08em] text-ink-3"
    >
      <span className={cn('shrink-0', compare ? 'w-11' : 'w-4')} />
      <span className={cn(RESULT_COLUMNS, 'min-w-0 flex-1')}>
        <span className="cq-sm:col-span-2">Carrier · product</span>
        <span className="hidden [@container(min-width:800px)]:block">Underwriting</span>
        <span className="text-right">Premium · face</span>
      </span>
      <span className="ml-3 hidden w-[92px] shrink-0 cq-sm:block" />
      <span className="ml-2 w-4 shrink-0" />
    </div>
  );
}

// ─── What the last edit did ──────────────────────────────────────────────────

/**
 * "2 outcomes changed · 3 premiums moved, after: Added Diabetes", then each
 * carrier that moved, outcomes first: "↓ Trinity Golden Eagle: Level →
 * Graded", "↓ GCU Eternal Advantage: $138.17 → $146.02 (+$7.85)". Said in
 * full, not as a count.
 */
export function ChangesStrip({
  changes,
  trigger,
  onShow,
  onDismiss,
}: {
  changes: OutcomeChange[];
  /** What the agent changed, when it can be said ("Added Diabetes"). */
  trigger: string[];
  /** Open the carrier's row. */
  onShow: (productId: string) => void;
  onDismiss: () => void;
}): JSX.Element {
  const [all, setAll] = React.useState(false);
  const shown = all ? changes : changes.slice(0, 3);
  return (
    <div className="border-x border-t border-rule bg-[color-mix(in_srgb,var(--brand-tint)_55%,var(--surface))] px-3 py-2">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-[12.5px] leading-[18px] text-ink">
          <span className="font-semibold">{changeSummary(changes)}</span>
          {trigger.length ? (
            <span className="text-ink-2">
              {' '}
              after: {trigger.slice(0, 2).join(' · ')}
              {trigger.length > 2 ? ` +${trigger.length - 2} more` : ''}
            </span>
          ) : null}
        </p>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss what changed"
          className={cn('-mr-1 rounded-[4px] p-0.5 text-ink-3 hover:text-ink', FOCUS)}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <ul className="mt-1 space-y-0.5">
        {shown.map(c => {
          const Icon = c.direction === 'better' ? ArrowUpRight : ArrowDownRight;
          return (
            <li key={c.productId}>
              <button
                type="button"
                onClick={() => onShow(c.productId)}
                className={cn(
                  'flex w-full min-w-0 items-baseline gap-1.5 rounded-[4px] text-left text-[12.5px] leading-[18px] hover:underline',
                  FOCUS
                )}
              >
                <Icon
                  aria-hidden
                  className={cn(
                    'h-3.5 w-3.5 shrink-0 self-center',
                    c.direction === 'worse'
                      ? 'text-dropped-ink'
                      : c.direction === 'better'
                        ? 'text-live-ink'
                        : 'text-ink-3'
                  )}
                />
                <span className="min-w-0 text-ink">
                  {c.carrier} <span className="text-ink-2">{c.product}</span>
                </span>
                <ChangeValues change={c} />
              </button>
            </li>
          );
        })}
      </ul>
      {changes.length > 3 ? (
        <button
          type="button"
          onClick={() => setAll(v => !v)}
          aria-expanded={all}
          className={cn(
            'mt-0.5 rounded-[4px] text-[12px] font-semibold text-brand-ink hover:underline',
            FOCUS
          )}
        >
          {all ? 'Show fewer' : `Show all ${changes.length}`}
        </button>
      ) : null}
    </div>
  );
}

/** "2 outcomes changed · 3 premiums moved · 1 face amount changed". */
export function changeSummary(changes: OutcomeChange[]): string {
  const outcomes = changes.filter(isOutcomeChange).length;
  const premiums = changes.filter(c => c.kind === 'premium').length;
  const faces = changes.filter(c => c.kind === 'face').length;
  const parts: string[] = [];
  if (outcomes) parts.push(`${outcomes} outcome${outcomes === 1 ? '' : 's'} changed`);
  if (faces) parts.push(`${faces} face amount${faces === 1 ? '' : 's'} changed`);
  if (premiums) parts.push(`${premiums} premium${premiums === 1 ? '' : 's'} moved`);
  return parts.join(' · ');
}

function ChangeValues({ change }: { change: OutcomeChange }): JSX.Element {
  const { from, to, delta } = changeParts(change);
  const tone =
    change.direction === 'worse'
      ? 'text-dropped-ink'
      : change.direction === 'better'
        ? 'text-live-ink'
        : 'text-ink';
  return (
    <span className="shrink-0 whitespace-nowrap tabular-nums">
      <span className="text-ink-3">{from} → </span>
      <span className={cn('font-semibold', tone)}>{to}</span>
      {delta ? <span className={cn('ml-1 font-medium', tone)}>({delta})</span> : null}
    </span>
  );
}

// ─── Before a quote, and while the first one runs ────────────────────────────

/**
 * The pane before there is anything to quote: what is still needed, what
 * will be quoted, and where else to go. Compact -- this is an application,
 * not a landing page.
 */
export function PreQuotePane({
  missing,
  network,
  links,
}: {
  /** The required fields still missing, by name ("State", "Face amount"). */
  missing: string[];
  network: { configured: number; appointed: number } | null;
  links?: Array<{ label: string; detail: string; onSelect: () => void }>;
}): JSX.Element {
  return (
    <div className="rounded-[12px] border border-rule bg-surface shadow-card">
      <div className="border-b border-rule px-5 py-4">
        <h2 className="text-[16px] font-bold tracking-[-0.01em] text-ink">No quote yet</h2>
        <p className="mt-1 text-[13px] leading-5 text-ink-2">
          Enter state, sex, age and coverage to begin
          {missing.length ? (
            <>
              {' '}
              — still needed: <span className="font-semibold text-ink">{missing.join(', ')}</span>
            </>
          ) : null}
          . Results then update as you type.
        </p>
      </div>
      <div className="grid gap-px bg-rule sm:grid-cols-2">
        <div className="bg-surface px-5 py-4">
          <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-3">
            Quoting network
          </h3>
          {network ? (
            <p className="mt-1.5 text-[13px] text-ink">
              <span className="text-[20px] font-bold tabular-nums">{network.configured}</span>{' '}
              carriers configured
              <span className="block text-[12.5px] text-ink-2">
                {network.appointed} you are appointed with, each priced and underwritten with its
                reasons and source pages
              </span>
            </p>
          ) : (
            <Skeleton className="mt-2 h-10 w-40" />
          )}
          {links?.length ? (
            <>
              <h3 className="mt-4 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-3">
                Quick access
              </h3>
              <ul className="mt-1.5 space-y-1">
                {links.map(link => (
                  <li key={link.label}>
                    <button
                      type="button"
                      onClick={link.onSelect}
                      className={cn(
                        'rounded-[4px] text-left text-[13px] font-semibold text-brand-ink hover:underline',
                        FOCUS
                      )}
                    >
                      {link.label}
                    </button>
                    <span className="text-[12.5px] text-ink-3"> · {link.detail}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
        <div className="bg-surface px-5 py-4">
          <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-3">
            Keyboard
          </h3>
          <ShortcutList />
        </div>
      </div>
    </div>
  );
}

/** The first quote in flight: the bar and rows at their real sizes, so nothing jumps. */
export function LoadingRows(): JSX.Element {
  return (
    <div
      className="overflow-hidden rounded-[12px] border border-rule bg-surface"
      aria-busy="true"
      aria-label="Quoting every carrier"
    >
      <div className="flex h-[52px] items-center justify-between border-b border-rule px-4">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-56" />
      </div>
      <div className="h-11 border-b border-rule" />
      <ul className="cq">
        {Array.from({ length: 7 }).map((_, i) => (
          <li
            key={i}
            className="flex h-[68px] items-center gap-4 border-b border-rule pl-11 pr-4 last:border-0"
          >
            <Skeleton className="hidden h-[44px] w-[104px] cq-sm:block" />
            <span className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-48" />
              <Skeleton className="h-3 w-28" />
            </span>
            <span className="space-y-2">
              <Skeleton className="ml-auto h-4 w-20" />
              <Skeleton className="ml-auto h-3 w-14" />
            </span>
            <Skeleton className="hidden h-8 w-[92px] cq-sm:block" />
          </li>
        ))}
      </ul>
    </div>
  );
}
