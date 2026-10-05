'use client';

/**
 * The quoter: intake on the left, every carrier's answer on the right.
 *
 * One component, three homes -- the Quote page, the drawer over a live call,
 * and the call-center console's Quote tab. On a call, the draft and the quote
 * the agent used live in the QuoteSession under the call id, so closing the
 * drawer or switching tabs loses nothing.
 */

import { BENEFIT_LABEL } from '@hopwhistle/fex-engine/catalog';
import type { QuoteLine } from '@hopwhistle/fex-engine/types';
import { ArrowDown, Calculator, Check, ChevronDown, HelpCircle, RefreshCw } from 'lucide-react';
import * as React from 'react';

import { EmptyState, Notice, Panel, Segmented, SegmentedItem } from '@/components/domain';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/use-toast';
import { useQuoteSession } from '@/contexts/quote-session-context';
import { useAuth } from '@/hooks/use-auth';
import { useFexCatalog, useFexQuote } from '@/hooks/use-fex-quote';
import {
  fexApi,
  MODE_SHORT,
  money,
  wholeDollars,
  type FexResult,
  type FexSelection,
  type QuoteSource,
} from '@/lib/fex/api';
import {
  ageFromDob,
  draftReducer,
  emptyDraft,
  toApplicant,
  type QuoteDraft,
} from '@/lib/fex/draft';
import { cn } from '@/lib/utils';

import { FOCUS } from './parts';
import { QuoteIntake } from './quote-intake';
import { ResultRow, SelectedQuoteBar } from './result-row';

export interface QuoteWorkspaceProps {
  variant: 'page' | 'drawer' | 'embedded';
  initialDraft: QuoteDraft;
  source: QuoteSource;
  callId?: string | null;
  insuranceLeadId?: string | null;
  prospectName?: string | null;
  onUseQuote?: (selection: FexSelection) => void;
  /** The selected-quote bar's primary action (the console: open the disposition). */
  onStartApplication?: () => void;
  /** Shown in the selected-quote bar instead of a Start button. */
  selectedNote?: string;
}

type SortKey = 'price' | 'face';

/** Plain text for the clipboard. No health details, ever. */
export function quoteSummaryText(
  result: FexResult,
  line: QuoteLine,
  context: { state: string; age: number | null; tobacco: boolean; on?: Date }
): string {
  const date = (context.on ?? new Date()).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return [
    `${result.family} ${result.product} — ${line.classLabel} (${BENEFIT_LABEL[line.benefit] ?? line.benefit}) — ${wholeDollars(line.face)} — ${money(line.premium)} ${line.modeLabel.toLowerCase()}`,
    `Quoted ${date} for ${context.state}, age ${context.age ?? '—'}, ${context.tobacco ? 'tobacco' : 'non-tobacco'}`,
  ].join('\n');
}

export function QuoteWorkspace({
  variant,
  initialDraft,
  source,
  callId,
  insuranceLeadId,
  prospectName,
  onUseQuote,
  onStartApplication,
  selectedNote,
}: QuoteWorkspaceProps): JSX.Element {
  const session = useQuoteSession();
  const { isPlatformAdmin } = useAuth();
  const { catalog } = useFexCatalog();
  const idPrefix = React.useId().replace(/:/g, '');

  const sessionKey = callId && session ? callId : null;
  const [draft, dispatch] = React.useReducer(
    draftReducer,
    undefined,
    () => (sessionKey ? session?.getDraft(sessionKey) : undefined) ?? initialDraft
  );
  React.useEffect(() => {
    if (sessionKey) session?.setDraft(sessionKey, draft);
  }, [draft, sessionKey, session]);

  const quote = useFexQuote(draft);
  const [localSelection, setLocalSelection] = React.useState<FexSelection | null>(null);
  const selection = sessionKey ? (session?.getSelection(sessionKey) ?? null) : localSelection;
  const setSelection = (next: FexSelection | null) =>
    sessionKey ? session?.setSelection(sessionKey, next) : setLocalSelection(next);

  const [sort, setSort] = React.useState<SortKey | null>(null);
  const [levelOnly, setLevelOnly] = React.useState(false);
  const [hideStale, setHideStale] = React.useState(false);
  const [showNotAppointed, setShowNotAppointed] = React.useState(false);
  const [showDeclined, setShowDeclined] = React.useState(false);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const resultsRef = React.useRef<HTMLDivElement>(null);
  const bannerRef = React.useRef<HTMLDivElement>(null);
  const declinedRef = React.useRef<HTMLDivElement>(null);

  const effectiveSort: SortKey = sort ?? (draft.coverage.mode === 'budget' ? 'face' : 'price');
  const apiOrder = sort === null;

  const results = React.useMemo(() => quote.data?.results ?? [], [quote.data]);
  const accendoAppointed =
    catalog?.products.find(p => p.id === 'accendo_final_expense')?.appointed ??
    results.find(r => r.productId === 'accendo_final_expense')?.appointed ??
    false;

  const needsIndication = React.useMemo(() => {
    const map = new Map<string, { name: string; options: string[] }>();
    for (const r of results) {
      for (const n of r.needsIndication) {
        const prev = map.get(n.drugId);
        map.set(n.drugId, {
          name: n.name,
          options: [...new Set([...(prev?.options ?? []), ...n.options])],
        });
      }
    }
    // Answered on the draft already: the next quote will drop it.
    for (const med of draft.meds) if (med.indication) map.delete(med.drugId);
    return map;
  }, [results, draft.meds]);

  const groups = React.useMemo(() => {
    const keep = (r: FexResult) =>
      (!levelOnly || r.best?.benefit === 'LEVEL') &&
      (!hideStale || r.ratesStatus !== 'STALE_VERIFY');
    const order = (list: FexResult[]) => {
      if (apiOrder) return list;
      return [...list].sort((a, b) =>
        effectiveSort === 'face'
          ? (b.best?.face ?? 0) - (a.best?.face ?? 0)
          : (a.best?.premium ?? Infinity) - (b.best?.premium ?? Infinity)
      );
    };
    const eligible = results.filter(r => r.eligible && keep(r));
    return {
      qualifies: order(eligible.filter(r => r.appointed && r.uwLoaded)),
      priceOnly: order(eligible.filter(r => r.appointed && !r.uwLoaded)),
      notAppointed: order(eligible.filter(r => !r.appointed)),
      declined: results.filter(r => !r.eligible && (r.appointed || showNotAppointed)),
    };
  }, [results, levelOnly, hideStale, apiOrder, effectiveSort, showNotAppointed]);

  const lowestLevel = groups.qualifies
    .filter(r => r.best?.benefit === 'LEVEL' && r.best.premium != null)
    .reduce<
      number | null
    >((min, r) => (min === null ? r.best!.premium! : Math.min(min, r.best!.premium!)), null);
  const lowestAny = groups.qualifies
    .map(r => r.best?.premium)
    .filter((p): p is number => p != null)
    .reduce<number | null>((min, p) => (min === null ? p : Math.min(min, p)), null);

  const age =
    draft.ageOrDob.mode === 'age'
      ? Number(draft.ageOrDob.age) || null
      : ageFromDob(draft.ageOrDob.dob);

  async function save(result: FexResult, line: QuoteLine | null): Promise<FexSelection | null> {
    const applicant = toApplicant(draft);
    if (!applicant) return null;
    setBusy(result.productId);
    const saved = await fexApi.save({
      applicant,
      source,
      callId: callId ?? null,
      insuranceLeadId: insuranceLeadId ?? null,
      prospectName: prospectName ?? null,
      selectedProductId: line ? result.productId : null,
      selectedClassCode: line ? line.classCode : null,
    });
    setBusy(null);
    if (!saved.ok) {
      toast({
        title:
          saved.code === 'NOT_ELIGIBLE'
            ? 'That plan no longer qualifies'
            : 'The quote was not saved',
        description: saved.message,
        variant: 'destructive',
      });
      return null;
    }
    if (!line || !saved.data.selected) {
      toast({ title: 'Quote saved', description: 'It is in History.' });
      return null;
    }
    return { fexQuoteId: saved.data.id, ...saved.data.selected };
  }

  async function use(result: FexResult, line: QuoteLine): Promise<void> {
    const chosen = await save(result, line);
    if (!chosen) return;
    setSelection(chosen);
    onUseQuote?.(chosen);
    toast({
      title: `Quote saved — ${chosen.carrier} ${chosen.product}, ${money(chosen.premium)}/${MODE_SHORT[chosen.mode]}`,
    });
  }

  async function copy(result: FexResult): Promise<void> {
    if (!result.best) return;
    const text = quoteSummaryText(result, result.best, {
      state: draft.state,
      age,
      tobacco: draft.tobacco === true,
    });
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: 'Quote summary copied' });
    } catch {
      toast({
        title: 'Copy failed',
        description: 'Your browser blocked the clipboard.',
        variant: 'destructive',
      });
    }
  }

  const rowProps = (r: FexResult, priceOnly = false) => ({
    result: r,
    expanded: expanded === r.productId,
    onToggle: () => setExpanded(open => (open === r.productId ? null : r.productId)),
    onUse: (res: FexResult, line: QuoteLine) => void use(res, line),
    onCopy: (res: FexResult) => void copy(res),
    onSave: (res: FexResult) => void save(res, null),
    busy: busy === r.productId,
    isStaff: isPlatformAdmin,
    priceOnly,
    selected: selection?.productId === r.productId,
  });

  const ready = Boolean(toApplicant(draft));
  // The quote page splits the form so none of it scrolls: who and how much on
  // the left, health and medications across the top of the right column with
  // the results under them. The drawer and the call-center tab keep one card.
  const split = variant === 'page';

  // ── Results pane ─────────────────────────────────────────────────────────
  const firstLabel = effectiveSort === 'face' ? 'Most coverage' : 'Lowest price';

  let body: React.ReactNode;
  if (!ready) {
    body = (
      <Panel className="overflow-hidden">
        <EmptyState
          icon={Calculator}
          headline="Enter state, sex, age and coverage to see every carrier."
          body="Results update as you type. Add conditions and medications for each carrier's real answer, with the reason and the page it comes from."
        />
        {split ? null : (
          <ol className="grid gap-px border-t border-rule bg-rule sm:grid-cols-3">
            {[
              ['1', 'Who', 'State, sex, age or date of birth, tobacco'],
              ['2', 'How much', 'A face amount, or a monthly budget'],
              ['3', 'Health', 'Conditions and medications, if any'],
            ].map(([n, title, text]) => (
              <li key={n} className="flex gap-3 bg-surface p-4">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-tint text-sm font-semibold text-brand-ink">
                  {n}
                </span>
                <span>
                  <span className="block text-sm font-semibold text-ink">{title}</span>
                  <span className="t-meta text-ink-2">{text}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    );
  } else if (quote.status === 'error' && !quote.data) {
    body = (
      <Notice
        tone="error"
        title="The quote did not run"
        action={
          <Button size="sm" variant="outline" onClick={quote.retry}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Retry
          </Button>
        }
      >
        {quote.error}
      </Notice>
    );
  } else if (!quote.data) {
    body = (
      <div className="space-y-4" aria-busy="true" aria-label="Quoting every carrier">
        <Skeleton className="h-12 w-full rounded-card" />
        <Panel>
          <ul>
            {Array.from({ length: 5 }).map((_, i) => (
              <li
                key={i}
                className="flex h-16 items-center gap-4 border-b border-rule px-4 last:border-0"
              >
                <Skeleton className="h-12 w-[128px]" />
                <span className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-40" />
                  <Skeleton className="h-3 w-24" />
                </span>
                <Skeleton className="h-5 w-20" />
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    );
  } else {
    body = (
      <div
        className={cn(
          'space-y-3 transition-opacity duration-150 ne-motion',
          quote.stale && 'opacity-60'
        )}
        aria-busy={quote.stale}
      >
        {/* The answer, as figures, with the sort and filters under it. Stays
            pinned while the list scrolls beneath. */}
        <section
          aria-label="Summary"
          className="sticky top-0 z-10 overflow-hidden rounded-card border border-rule bg-surface shadow-card"
        >
          <div
            className={cn(
              'grid grid-cols-2 divide-rule sm:divide-x',
              needsIndication.size ? 'sm:grid-cols-5' : 'sm:grid-cols-4'
            )}
          >
            <Stat
              label="Carriers qualify"
              value={String(groups.qualifies.length)}
              sub={`of ${results.length} quoted`}
              tone={groups.qualifies.length ? 'live' : 'dropped'}
            />
            <Stat
              label="Lowest premium"
              value={lowestAny === null ? '—' : money(lowestAny)}
              sub={lowestAny === null ? undefined : `/${MODE_SHORT[draft.paymentMode]}`}
            />
            <Stat
              label="Lowest level"
              value={lowestLevel === null ? '—' : money(lowestLevel)}
              sub={lowestLevel === null ? undefined : `/${MODE_SHORT[draft.paymentMode]}`}
            />
            <Stat
              label="Declined"
              value={String(groups.declined.length)}
              action={
                groups.declined.length
                  ? {
                      label: 'View',
                      onClick: () => {
                        setShowDeclined(true);
                        requestAnimationFrame(() =>
                          declinedRef.current?.scrollIntoView({
                            behavior: 'smooth',
                            block: 'start',
                          })
                        );
                      },
                    }
                  : undefined
              }
            />
            {needsIndication.size ? (
              <Stat
                label="Needs answers"
                value={String(needsIndication.size)}
                tone="ringing"
                action={{
                  label: 'Answer',
                  onClick: () =>
                    bannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
                }}
              />
            ) : null}
          </div>
          <div
            role="toolbar"
            aria-label="Sort and filter results"
            className="flex flex-wrap items-center justify-between gap-2 border-t border-rule bg-sunken/40 px-3 py-2"
          >
            <div className="flex items-center gap-2">
              <span className="t-label text-ink-3">Sort</span>
              <Segmented role="radiogroup" aria-label="Sort" className="h-8">
                <SegmentedItem
                  role="radio"
                  aria-checked={effectiveSort === 'price'}
                  active={effectiveSort === 'price'}
                  className="h-7 px-3 text-[13px]"
                  onClick={() => setSort(draft.coverage.mode === 'budget' ? 'price' : null)}
                >
                  Lowest price
                </SegmentedItem>
                <SegmentedItem
                  role="radio"
                  aria-checked={effectiveSort === 'face'}
                  active={effectiveSort === 'face'}
                  className="h-7 px-3 text-[13px]"
                  onClick={() => setSort(draft.coverage.mode === 'budget' ? null : 'face')}
                >
                  Most coverage
                </SegmentedItem>
              </Segmented>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {quote.stale ? (
                <span className="t-meta mr-1 inline-flex items-center gap-1 text-brand-ink">
                  <RefreshCw className="h-3 w-3 motion-safe:animate-spin" aria-hidden />
                  Updating
                </span>
              ) : null}
              <FilterChip pressed={levelOnly} onClick={() => setLevelOnly(v => !v)}>
                Level only
              </FilterChip>
              <FilterChip pressed={hideStale} onClick={() => setHideStale(v => !v)}>
                Hide older rate books
              </FilterChip>
              <FilterChip pressed={showNotAppointed} onClick={() => setShowNotAppointed(v => !v)}>
                Show not appointed
              </FilterChip>
            </div>
          </div>
        </section>
        {quote.status === 'error' ? (
          <Notice
            tone="error"
            action={
              <Button size="sm" variant="outline" onClick={quote.retry}>
                Retry
              </Button>
            }
          >
            {quote.error} The results below are from the last good quote.
          </Notice>
        ) : null}

        {quote.data.licensed === false ? (
          <Notice tone="warning">
            You are not licensed in {draft.state}. Quotes are shown for reference.
          </Notice>
        ) : null}

        {needsIndication.size ? (
          <div
            ref={bannerRef}
            role="alert"
            className="rounded-card border border-ringing bg-ringing-tint px-3 py-2.5"
          >
            <p className="flex items-center gap-2 text-sm font-semibold text-ringing-ink">
              <HelpCircle className="h-4 w-4" aria-hidden />
              Confirm what these are prescribed for
            </p>
            <p className="t-meta mt-0.5 text-ink-2">
              Until you answer, each carrier applies the strictest use it lists.
            </p>
            <ul className="mt-2 space-y-1.5">
              {[...needsIndication.entries()].map(([drugId, need]) => (
                <li key={drugId} className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 min-w-[96px] text-sm font-medium capitalize text-ink">
                    {need.name}
                  </span>
                  {need.options.map(code => (
                    <button
                      key={code}
                      type="button"
                      onClick={() => dispatch({ type: 'setIndication', drugId, indication: code })}
                      className={cn(
                        'h-7 rounded-full border border-rule-strong bg-surface px-3 text-xs font-medium text-ink transition-colors duration-150 ne-motion hover:border-brand-ink hover:bg-brand-tint hover:text-brand-ink',
                        FOCUS
                      )}
                    >
                      {catalog?.conditions.find(c => c.code === code)?.label ?? code}
                    </button>
                  ))}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <ResultGroup title="Qualifies" count={groups.qualifies.length} tone="live">
          {groups.qualifies.length ? (
            groups.qualifies.map((r, i) => (
              <ResultRow
                key={r.productId}
                {...rowProps(r)}
                badge={i === 0 && r.best ? firstLabel : undefined}
              />
            ))
          ) : (
            <li className="px-4 py-8 text-center text-sm text-ink-2">
              No appointed carrier qualifies with these answers. Open the declined list to see why.
            </li>
          )}
        </ResultGroup>

        {groups.priceOnly.length ? (
          <ResultGroup
            title="Price only — health questions not loaded"
            count={groups.priceOnly.length}
            tone="neutral"
          >
            {groups.priceOnly.map(r => (
              <ResultRow key={r.productId} {...rowProps(r, true)} />
            ))}
          </ResultGroup>
        ) : null}

        {showNotAppointed && groups.notAppointed.length ? (
          <ResultGroup title="Not appointed" count={groups.notAppointed.length} tone="neutral">
            {groups.notAppointed.map(r => (
              <ResultRow key={r.productId} {...rowProps(r, !r.uwLoaded)} />
            ))}
          </ResultGroup>
        ) : null}

        {groups.declined.length ? (
          <div ref={declinedRef}>
            <ResultGroup
              title="Declined or not available"
              count={groups.declined.length}
              tone="dropped"
              collapsible
              open={showDeclined}
              onOpenChange={setShowDeclined}
            >
              {groups.declined.map(r => (
                <ResultRow key={r.productId} {...rowProps(r)} />
              ))}
            </ResultGroup>
          </div>
        ) : null}
      </div>
    );
  }

  const intakeProps = {
    idPrefix,
    draft,
    dispatch,
    conditions: catalog?.conditions ?? [],
    showAetnaMedSupp: accendoAppointed,
    needsIndication: new Map([...needsIndication.entries()].map(([id, n]) => [id, n.options])),
    onReset: () => {
      dispatch({ type: 'replace', draft: emptyDraft(session?.settings?.agency) });
      setExpanded(null);
    },
  };

  return (
    <div
      className={cn(
        // From lg up the workspace fills its parent and never scrolls as a
        // whole: the form and the results each scroll on their own, so both
        // stay on one laptop screen.
        'relative lg:grid lg:h-full lg:min-h-0 lg:grid-cols-[minmax(340px,380px)_minmax(0,1fr)] lg:gap-5'
      )}
      data-variant={variant}
    >
      {ready && quote.data ? (
        <div className="sticky top-0 z-20 mb-3 flex items-center justify-between gap-3 rounded-card border border-rule bg-surface px-3 py-2 shadow-raised lg:hidden">
          <p className="t-num truncate text-sm tabular-nums text-ink">
            <span className="font-semibold">{groups.qualifies.length} qualify</span>
            {lowestAny !== null ? (
              <span className="text-ink-2">
                {' '}
                · from {money(lowestAny)}/{MODE_SHORT[draft.paymentMode]}
              </span>
            ) : null}
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }
          >
            Results <ArrowDown className="ml-1 h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
      ) : null}

      <section
        aria-label={split ? 'Applicant and coverage' : 'Applicant and health'}
        className="min-w-0 lg:min-h-0 lg:overflow-y-auto lg:pr-1"
      >
        <QuoteIntake {...intakeProps} part={split ? 'who' : 'all'} />
      </section>

      <div className="flex min-w-0 flex-col lg:min-h-0">
        {split ? (
          // No overflow here: it would clip the search lists. A long list of
          // conditions or medications scrolls inside its own step instead.
          <section
            aria-label="Health and medications"
            className="relative z-20 mt-4 shrink-0 lg:mt-0"
          >
            <QuoteIntake {...intakeProps} part="health" />
          </section>
        ) : null}

        <section
          ref={resultsRef}
          aria-label="Results"
          aria-live="polite"
          // pb-16 keeps the last row, and the sticky selected bar, clear of the
          // floating softphone in the corner.
          className={cn(
            'mt-4 flex min-w-0 flex-col lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pb-16 lg:pr-1',
            split ? 'lg:mt-3' : 'lg:mt-0'
          )}
        >
          <div className="flex-1">{body}</div>
          {selection ? (
            <div className="sticky bottom-0 z-10 mt-3 pb-1">
              <SelectedQuoteBar
                selection={selection}
                onStart={onStartApplication}
                note={selectedNote}
                onClear={() => setSelection(null)}
              />
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

const STAT_TONE = {
  live: 'bg-live',
  dropped: 'bg-dropped',
  ringing: 'bg-ringing',
} as const;

/** One figure in the summary: a label, the number, and what to do about it. */
function Stat({
  label,
  value,
  sub,
  tone,
  action,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: keyof typeof STAT_TONE;
  action?: { label: string; onClick: () => void };
}): JSX.Element {
  return (
    <div className="min-w-0 border-rule px-4 py-2.5 [&:nth-child(n+3)]:border-t sm:[&:nth-child(n+3)]:border-t-0">
      <p className="t-label flex items-center gap-1.5 truncate text-ink-3">
        {tone ? (
          <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', STAT_TONE[tone])} />
        ) : null}
        {label}
      </p>
      <p className="mt-0.5 flex items-baseline gap-1 whitespace-nowrap">
        <span
          className={cn(
            'text-xl font-semibold leading-tight tracking-tight tabular-nums',
            tone === 'ringing' ? 'text-ringing-ink' : 'text-ink'
          )}
        >
          {value}
        </span>
        {sub ? <span className="text-xs text-ink-3">{sub}</span> : null}
        {action ? (
          <button
            type="button"
            onClick={action.onClick}
            className={cn(
              'ml-auto rounded-control px-1 text-xs font-medium text-brand-ink hover:underline',
              FOCUS
            )}
          >
            {action.label}
          </button>
        ) : null}
      </p>
    </div>
  );
}

function FilterChip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-medium transition-colors duration-150 ne-motion [@media(pointer:coarse)]:min-h-[40px]',
        pressed
          ? 'border-brand-ink bg-brand-tint text-brand-ink'
          : 'border-rule-strong bg-surface text-ink-2 hover:bg-sunken hover:text-ink',
        FOCUS
      )}
    >
      {pressed ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
      {children}
    </button>
  );
}

const GROUP_DOT = {
  live: 'bg-live',
  neutral: 'bg-ink-3',
  dropped: 'bg-dropped',
} as const;

function ResultGroup({
  title,
  count,
  children,
  tone,
  collapsible = false,
  open: controlledOpen,
  onOpenChange,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
  tone: keyof typeof GROUP_DOT;
  collapsible?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}): JSX.Element {
  const [ownOpen, setOwnOpen] = React.useState(true);
  const open = collapsible ? (controlledOpen ?? ownOpen) : true;
  const toggle = () => {
    onOpenChange?.(!open);
    setOwnOpen(!open);
  };
  const headingId = React.useId();
  const heading = (
    <>
      <span className="flex items-center gap-2">
        <span aria-hidden className={cn('h-2 w-2 rounded-full', GROUP_DOT[tone])} />
        <span className="text-sm font-semibold text-ink">{title}</span>
        <span className="t-num rounded-full bg-sunken px-2 py-0.5 text-xs tabular-nums text-ink-2">
          {count}
        </span>
      </span>
      {collapsible ? (
        <span className="t-meta flex items-center gap-1 text-ink-3">
          {open ? 'Hide' : 'Show'}
          <ChevronDown
            aria-hidden
            className={cn(
              'h-4 w-4 transition-transform duration-150 ne-motion motion-reduce:transition-none',
              open && 'rotate-180'
            )}
          />
        </span>
      ) : null}
    </>
  );
  return (
    <Panel className="overflow-hidden">
      <h3 id={headingId} className="m-0">
        {collapsible ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={toggle}
            className={cn(
              'flex w-full items-center justify-between gap-2 bg-sunken/50 px-4 py-2 text-left',
              open && 'border-b border-rule',
              FOCUS
            )}
          >
            {heading}
          </button>
        ) : (
          <span className="flex items-center justify-between gap-2 border-b border-rule bg-sunken/50 px-4 py-2">
            {heading}
          </span>
        )}
      </h3>
      {open ? <ul aria-labelledby={headingId}>{children}</ul> : null}
    </Panel>
  );
}
