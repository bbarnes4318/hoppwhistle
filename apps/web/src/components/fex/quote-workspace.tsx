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
import { ResultRow, SelectedQuoteBar, TopPickCard } from './result-row';

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

const MODE_TITLE = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  semiannual: 'Semi-annual',
  annual: 'Annual',
} as const;

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

  const fill = variant !== 'page';
  const ready = Boolean(toApplicant(draft));

  // ── Results pane ─────────────────────────────────────────────────────────
  const selectedId = selection?.productId ?? null;
  const topPicks = groups.qualifies.filter(r => r.best).slice(0, 3);
  const firstLabel = effectiveSort === 'face' ? 'Most coverage' : 'Lowest price';
  const openDetails = (r: FexResult) => {
    setExpanded(r.productId);
    requestAnimationFrame(() =>
      document
        .querySelector(`[data-product="${CSS.escape(r.productId)}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    );
  };
  const who = [
    draft.state,
    draft.sex === 'F' ? 'Female' : draft.sex === 'M' ? 'Male' : null,
    age != null ? `age ${age}` : null,
    draft.tobacco ? 'tobacco' : 'non-tobacco',
    draft.coverage.mode === 'face'
      ? wholeDollars(Number(draft.coverage.face))
      : `${money(Number(draft.coverage.budget))} budget`,
    MODE_TITLE[draft.paymentMode].toLowerCase(),
  ]
    .filter(Boolean)
    .join(' · ');
  const health =
    draft.conditions.length || draft.meds.length
      ? `${draft.conditions.length} condition${draft.conditions.length === 1 ? '' : 's'}, ${draft.meds.length} medication${draft.meds.length === 1 ? '' : 's'}`
      : 'No health conditions entered';

  let body: React.ReactNode;
  if (!ready) {
    body = (
      <Panel className="overflow-hidden">
        <EmptyState
          icon={Calculator}
          headline="Enter state, sex, age and coverage to see every carrier."
          body="Results update as you type. Add conditions and medications for each carrier's real answer, with the reason and the page it comes from."
        />
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
        <Skeleton className="h-16 w-full rounded-card" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map(i => (
            <Skeleton key={i} className="h-[264px] w-full rounded-card" />
          ))}
        </div>
        <Panel>
          <ul>
            {Array.from({ length: 5 }).map((_, i) => (
              <li
                key={i}
                className="flex h-[76px] items-center gap-4 border-b border-rule px-4 last:border-0"
              >
                <Skeleton className="h-11 w-[92px]" />
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
          'space-y-5 transition-opacity duration-150 ne-motion',
          quote.stale && 'opacity-60'
        )}
        aria-busy={quote.stale}
      >
        {/* The answer in one line, and who it is for. */}
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h2 className="text-[22px] font-semibold leading-tight tracking-tight text-ink">
              {groups.qualifies.length === 0
                ? 'No carrier qualifies yet'
                : `${groups.qualifies.length} ${groups.qualifies.length === 1 ? 'carrier qualifies' : 'carriers qualify'}`}
              {lowestAny !== null ? (
                <span className="font-normal text-ink-2">
                  {' '}
                  from{' '}
                  <span className="font-semibold tabular-nums text-ink">{money(lowestAny)}</span>/
                  {MODE_SHORT[draft.paymentMode]}
                </span>
              ) : null}
            </h2>
            <p className="t-meta mt-1 truncate text-ink-2">
              {who} · {health}
              {quote.stale ? (
                <span className="ml-2 inline-flex items-center gap-1 text-brand-ink">
                  <RefreshCw className="h-3 w-3 motion-safe:animate-spin" aria-hidden />
                  Updating
                </span>
              ) : null}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2" aria-label="Summary">
            <SummaryPill
              label="Level from"
              value={lowestLevel === null ? '—' : money(lowestLevel)}
            />
            <SummaryPill
              label="Declined"
              value={String(groups.declined.length)}
              onClick={
                groups.declined.length
                  ? () => {
                      setShowDeclined(true);
                      requestAnimationFrame(() =>
                        declinedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                      );
                    }
                  : undefined
              }
            />
            <SummaryPill
              label="Needs answers"
              value={String(needsIndication.size)}
              tone={needsIndication.size ? 'warn' : undefined}
              onClick={
                needsIndication.size
                  ? () => bannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                  : undefined
              }
            />
          </div>
        </div>

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
            className="rounded-card border border-ringing bg-ringing-tint p-4"
          >
            <p className="flex items-center gap-2 text-sm font-semibold text-ringing-ink">
              <HelpCircle className="h-4 w-4" aria-hidden />
              Confirm what these are prescribed for
            </p>
            <p className="t-meta mt-0.5 text-ink-2">
              Until you answer, each carrier applies the strictest use it lists.
            </p>
            <ul className="mt-3 space-y-2.5">
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
                        'h-8 rounded-full border border-rule-strong bg-surface px-3 text-xs font-medium text-ink transition-colors duration-150 ne-motion hover:border-brand-ink hover:bg-brand-tint hover:text-brand-ink',
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

        {/* The three to present first. */}
        {topPicks.length ? (
          <section aria-label="Top picks">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {topPicks.map((r, i) => (
                <TopPickCard
                  key={r.productId}
                  result={r}
                  label={i === 0 ? firstLabel : `Option ${i + 1}`}
                  highlight={i === 0}
                  busy={busy === r.productId}
                  selected={selectedId === r.productId}
                  onUse={(res, line) => void use(res, line)}
                  onDetails={openDetails}
                />
              ))}
            </div>
          </section>
        ) : null}

        {/* Every carrier. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="t-section text-ink">Every carrier</h3>
          <div
            role="toolbar"
            aria-label="Sort and filter results"
            className="flex flex-wrap items-center gap-2"
          >
            <Segmented role="radiogroup" aria-label="Sort">
              <SegmentedItem
                role="radio"
                aria-checked={effectiveSort === 'price'}
                active={effectiveSort === 'price'}
                onClick={() => setSort(draft.coverage.mode === 'budget' ? 'price' : null)}
              >
                Lowest price
              </SegmentedItem>
              <SegmentedItem
                role="radio"
                aria-checked={effectiveSort === 'face'}
                active={effectiveSort === 'face'}
                onClick={() => setSort(draft.coverage.mode === 'budget' ? null : 'face')}
              >
                Most coverage
              </SegmentedItem>
            </Segmented>
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

        <ResultGroup title="Qualifies" count={groups.qualifies.length} tone="live">
          {groups.qualifies.length ? (
            groups.qualifies.map(r => <ResultRow key={r.productId} {...rowProps(r)} />)
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

  return (
    <div
      className={cn(
        'relative lg:grid lg:grid-cols-[minmax(360px,420px)_minmax(0,1fr)] lg:gap-6',
        fill && 'lg:h-full lg:min-h-0'
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
        aria-label="Applicant and health"
        className={cn(
          'min-w-0',
          fill
            ? 'lg:min-h-0 lg:overflow-y-auto lg:pr-1'
            : 'lg:sticky lg:top-4 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto lg:pr-1'
        )}
      >
        <QuoteIntake
          idPrefix={idPrefix}
          draft={draft}
          dispatch={dispatch}
          conditions={catalog?.conditions ?? []}
          showAetnaMedSupp={accendoAppointed}
          needsIndication={
            new Map([...needsIndication.entries()].map(([id, n]) => [id, n.options]))
          }
          onReset={() => {
            dispatch({ type: 'replace', draft: emptyDraft(session?.settings?.agency) });
            setExpanded(null);
          }}
        />
      </section>

      <section
        ref={resultsRef}
        aria-label="Results"
        aria-live="polite"
        className={cn(
          'mt-4 flex min-w-0 flex-col lg:mt-0',
          fill && 'lg:min-h-0 lg:overflow-y-auto lg:pr-1'
        )}
      >
        <div className="flex-1">{body}</div>
        {selection ? (
          <div className="sticky bottom-0 z-10 mt-4 pb-1">
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
  );
}

function SummaryPill({
  label,
  value,
  tone,
  onClick,
}: {
  label: string;
  value: string;
  tone?: 'warn';
  onClick?: () => void;
}): JSX.Element {
  const content = (
    <>
      <span className="text-ink-2">{label}</span>
      <span
        className={cn(
          't-num font-semibold tabular-nums',
          tone === 'warn' ? 'text-ringing-ink' : 'text-ink'
        )}
      >
        {value}
      </span>
    </>
  );
  const cls = cn(
    'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs',
    tone === 'warn' ? 'border-ringing bg-ringing-tint' : 'border-rule bg-surface'
  );
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={cn(cls, 'transition-colors duration-150 ne-motion hover:bg-sunken', FOCUS)}
    >
      {content}
    </button>
  ) : (
    <span className={cls}>{content}</span>
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
        'inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors duration-150 ne-motion [@media(pointer:coarse)]:min-h-[40px]',
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
              'flex w-full items-center justify-between gap-2 bg-sunken/50 px-4 py-3 text-left',
              open && 'border-b border-rule',
              FOCUS
            )}
          >
            {heading}
          </button>
        ) : (
          <span className="flex items-center justify-between gap-2 border-b border-rule bg-sunken/50 px-4 py-3">
            {heading}
          </span>
        )}
      </h3>
      {open ? <ul aria-labelledby={headingId}>{children}</ul> : null}
    </Panel>
  );
}
