'use client';

/**
 * The quoter: intake on the left, every carrier's answer on the right.
 *
 * One component, three homes -- the Quote page, the drawer over a live call,
 * and the call-center console's Quote tab. On a call, the draft and the quote
 * the agent used live in the QuoteSession under the call id, so closing the
 * drawer or switching tabs loses nothing.
 *
 * ── Layout follows the space it is given ─────────────────────────────────────
 *
 * The workspace is a size container, and its layout is decided by its OWN
 * width, not the window's: the same code is a full-screen page, a 1180px
 * drawer and a console column. From 900px wide it is two columns that each
 * scroll on their own and the whole never scrolls; below that the results
 * lead and the applicant folds to one line with an Edit button.
 */

import { BENEFIT_LABEL } from '@hopwhistle/fex-engine/catalog';
import type { QuoteLine } from '@hopwhistle/fex-engine/types';
import {
  ArrowDown,
  Calculator,
  ChevronDown,
  ChevronRight,
  HelpCircle,
  Pencil,
  RefreshCw,
  SlidersHorizontal,
} from 'lucide-react';
import * as React from 'react';

import { EmptyState, Notice, Panel } from '@/components/domain';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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
import {
  diffOutcomes,
  outcomeMap,
  type CarrierOutcome,
  type OutcomeChange,
} from '@/lib/fex/outcome-diff';
import { cn } from '@/lib/utils';

import { ComparePanel, CompareTray } from './compare-panel';
import { CheckRow, FOCUS } from './parts';
import { healthSearchId, QuoteIntake } from './quote-intake';
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

/** How many carriers fit side by side in the comparison. */
const COMPARE_MAX = 4;

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

/** "TN · F · 68 · Non-tobacco · $10,000 · 2 conditions": the applicant in a line. */
function applicantLine(draft: QuoteDraft, age: number | null): string {
  const parts: string[] = [];
  if (draft.state) parts.push(draft.state);
  if (draft.sex) parts.push(draft.sex);
  if (age !== null) parts.push(String(age));
  if (draft.tobacco !== null) parts.push(draft.tobacco ? 'Tobacco' : 'Non-tobacco');
  if (draft.heightFt && draft.weightLb)
    parts.push(`${draft.heightFt}'${draft.heightIn || 0}" ${draft.weightLb} lb`);
  if (draft.coverage.mode === 'face' && draft.coverage.face)
    parts.push(wholeDollars(Number(draft.coverage.face)));
  if (draft.coverage.mode === 'budget' && draft.coverage.budget)
    parts.push(`${money(Number(draft.coverage.budget))}/mo budget`);
  if (draft.conditions.length)
    parts.push(`${draft.conditions.length} condition${draft.conditions.length === 1 ? '' : 's'}`);
  if (draft.meds.length)
    parts.push(`${draft.meds.length} med${draft.meds.length === 1 ? '' : 's'}`);
  return parts.join(' · ');
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
  const [compare, setCompare] = React.useState<string[]>([]);
  const [compareOpen, setCompareOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const resultsRef = React.useRef<HTMLElement>(null);
  const bannerRef = React.useRef<HTMLDivElement>(null);
  const declinedRef = React.useRef<HTMLDivElement>(null);

  // Narrow (below the two-column width): the results lead and the applicant
  // folds to a line. Open to start with only when there is nothing to quote.
  const [editing, setEditing] = React.useState(() => !toApplicant(draft));

  const effectiveSort: SortKey = sort ?? (draft.coverage.mode === 'budget' ? 'face' : 'price');
  const apiOrder = sort === null;

  const results = React.useMemo(() => quote.data?.results ?? [], [quote.data]);
  const accendoAppointed =
    catalog?.products.find(p => p.id === 'accendo_final_expense')?.appointed ??
    results.find(r => r.productId === 'accendo_final_expense')?.appointed ??
    false;

  /*
   * What the last edit did to each carrier's answer. Compared response to
   * response, off the engine's own results (see outcome-diff.ts); a new quote
   * starts the comparison over.
   */
  const previousOutcomes = React.useRef<Map<string, CarrierOutcome> | null>(null);
  const [changes, setChanges] = React.useState<OutcomeChange[]>([]);
  React.useEffect(() => {
    if (!quote.data) return;
    const next = quote.data.results;
    setChanges(previousOutcomes.current ? diffOutcomes(previousOutcomes.current, next) : []);
    previousOutcomes.current = outcomeMap(next);
  }, [quote.data]);
  const changeById = React.useMemo(() => new Map(changes.map(c => [c.productId, c])), [changes]);

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

  const toggleCompare = React.useCallback((productId: string) => {
    setCompare(list =>
      list.includes(productId)
        ? list.filter(id => id !== productId)
        : list.length >= COMPARE_MAX
          ? list
          : [...list, productId]
    );
  }, []);
  // A carrier that leaves the results (a filter, a re-quote) leaves the comparison.
  const compared = React.useMemo(
    () =>
      compare
        .map(id => results.find(r => r.productId === id))
        .filter((r): r is FexResult => Boolean(r?.eligible && r.best)),
    [compare, results]
  );

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
    compared: compare.includes(r.productId),
    onCompareToggle: () => toggleCompare(r.productId),
    compareFull: compare.length >= COMPARE_MAX,
    change: changeById.get(r.productId),
  });

  const ready = Boolean(toApplicant(draft));

  const focusHealthSearch = React.useCallback(() => {
    const input = document.getElementById(healthSearchId(idPrefix));
    if (!input) return;
    setEditing(true);
    requestAnimationFrame(() => {
      input.scrollIntoView({ block: 'nearest' });
      input.focus();
    });
  }, [idPrefix]);

  /*
   * Keyboard. Alt+H (or Alt+M) jumps to the health search from anywhere in the
   * workspace -- and on the page, from anywhere at all, unless a dialog (the
   * call drawer, its own workspace) is up. In the results, the arrow keys move
   * between carriers and C toggles the focused one in the comparison. Nothing
   * fires while typing in a field.
   */
  React.useEffect(() => {
    if (variant !== 'page') return;
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.code !== 'KeyH' && event.code !== 'KeyM') return;
      if (document.querySelector('[role="dialog"]')) return;
      if (rootRef.current?.contains(event.target as Node)) return; // handled below
      event.preventDefault();
      focusHealthSearch();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [variant, focusHealthSearch]);

  const onWorkspaceKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (
      event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      (event.code === 'KeyH' || event.code === 'KeyM')
    ) {
      event.preventDefault();
      focusHealthSearch();
      return;
    }
    const target = event.target as HTMLElement;
    if (!target.hasAttribute('data-row-toggle')) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const rows = Array.from(
        resultsRef.current?.querySelectorAll<HTMLElement>('[data-row-toggle]') ?? []
      );
      const at = rows.indexOf(target);
      const next = rows[at + (event.key === 'ArrowDown' ? 1 : -1)];
      if (next) {
        event.preventDefault();
        next.focus();
        next.scrollIntoView({ block: 'nearest' });
      }
    } else if (event.key === 'c' || event.key === 'C') {
      const productId = target.closest('[data-product]')?.getAttribute('data-product');
      const r = productId ? results.find(x => x.productId === productId) : undefined;
      if (r?.eligible && r.best) {
        event.preventDefault();
        toggleCompare(r.productId);
      }
    }
  };

  // ── Results pane ─────────────────────────────────────────────────────────
  const firstLabel = effectiveSort === 'face' ? 'Most coverage' : 'Best price';
  const bestLevelId =
    lowestLevel === null
      ? null
      : (groups.qualifies.find(r => r.best?.benefit === 'LEVEL' && r.best.premium === lowestLevel)
          ?.productId ?? null);

  // The top row's label is checked against the figures, never assumed from
  // its position: "Best price" only if nothing qualifying costs less.
  const maxFace = groups.qualifies.reduce((max, r) => Math.max(max, r.best?.face ?? 0), 0);
  const topEarned = (r: FexResult) =>
    Boolean(r.best) &&
    (effectiveSort === 'face'
      ? r.best!.face === maxFace
      : r.best!.premium != null && r.best!.premium === lowestAny);

  const showDeclinedList = () => {
    setShowDeclined(true);
    requestAnimationFrame(() =>
      declinedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    );
  };

  const filterCount = (hideStale ? 1 : 0) + (showNotAppointed ? 1 : 0);
  const mode = MODE_SHORT[draft.paymentMode];

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
            <li key={n} className="flex gap-3 bg-surface p-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sunken text-[12px] font-semibold text-ink-2">
                {n}
              </span>
              <span>
                <span className="block text-[13px] font-semibold text-ink">{title}</span>
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
      <div className="space-y-3" aria-busy="true" aria-label="Quoting every carrier">
        <Skeleton className="h-[52px] w-full rounded-card" />
        <Panel>
          <ul>
            {Array.from({ length: 6 }).map((_, i) => (
              <li
                key={i}
                className="flex h-16 items-center gap-3 border-b border-rule px-3 last:border-0"
              >
                <Skeleton className="h-11 w-[120px]" />
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
          'space-y-2.5 transition-opacity duration-150 ne-motion',
          quote.stale && 'opacity-60'
        )}
        aria-busy={quote.stale}
      >
        {/* The answer in one line -- how many qualify, the lowest premium, the
            lowest Level, the declines -- with the sort and filters beside it.
            Pinned while the list scrolls beneath. */}
        <section
          aria-label="Summary"
          className="sticky top-0 z-10 rounded-card border border-rule bg-surface shadow-card"
        >
          <div className="flex min-h-[52px] flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <Figure
                dot={groups.qualifies.length ? 'live' : 'dropped'}
                value={String(groups.qualifies.length)}
                after={`of ${results.length} qualify`}
                label="Carriers qualify"
              />
              <Divider />
              <Figure
                caption="Lowest"
                label="Lowest premium"
                value={lowestAny === null ? '—' : money(lowestAny)}
                after={lowestAny === null ? undefined : `/${mode}`}
              />
              <Divider />
              <Figure
                caption="Level"
                label="Lowest level"
                value={lowestLevel === null ? '—' : money(lowestLevel)}
              />
              <Divider />
              {groups.declined.length ? (
                <button
                  type="button"
                  onClick={showDeclinedList}
                  className={cn(
                    'inline-flex items-baseline gap-1 rounded-control px-1 text-ink hover:bg-sunken',
                    FOCUS
                  )}
                >
                  <span className="text-[17px] font-semibold tabular-nums">
                    {groups.declined.length}
                  </span>
                  <span className="text-[12px] text-ink-2">declined</span>
                  <ChevronRight className="h-3.5 w-3.5 self-center text-ink-3" aria-hidden />
                </button>
              ) : (
                <Figure value="0" after="declined" label="Declined" />
              )}
              {needsIndication.size ? (
                <button
                  type="button"
                  onClick={() =>
                    bannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                  }
                  className={cn(
                    'inline-flex items-center gap-1 rounded-control bg-ringing-tint px-2 py-0.5 text-[12px] font-semibold text-ringing-ink',
                    FOCUS
                  )}
                >
                  <HelpCircle className="h-3.5 w-3.5" aria-hidden />
                  {needsIndication.size} need{needsIndication.size === 1 ? 's' : ''} an answer
                </button>
              ) : null}
              {changes.length ? <ChangesNote changes={changes} /> : null}
            </div>

            <div
              role="toolbar"
              aria-label="Sort and filter results"
              className="ml-auto flex items-center gap-1.5"
            >
              {quote.stale ? (
                <span className="t-meta mr-1 inline-flex items-center gap-1 text-ink-2">
                  <RefreshCw className="h-3 w-3 motion-safe:animate-spin" aria-hidden />
                  <span className="sr-only cq-lg:not-sr-only">Updating</span>
                </span>
              ) : null}
              <label htmlFor={`${idPrefix}-sort`} className="sr-only">
                Sort
              </label>
              <select
                id={`${idPrefix}-sort`}
                value={effectiveSort}
                onChange={e => {
                  const next = e.target.value as SortKey;
                  // The mode's own default sort is the API's order.
                  const natural = draft.coverage.mode === 'budget' ? 'face' : 'price';
                  setSort(next === natural ? null : next);
                }}
                className={cn(
                  'h-8 cursor-pointer rounded-control border border-rule-strong bg-surface pl-2 pr-6 text-[12px] font-medium text-ink hover:border-ink-3',
                  FOCUS
                )}
              >
                <option value="price">Lowest price</option>
                <option value="face">Most coverage</option>
              </select>
              <button
                type="button"
                aria-pressed={levelOnly}
                onClick={() => setLevelOnly(v => !v)}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-control border px-2 text-[12px] font-medium transition-colors duration-150 ne-motion',
                  levelOnly
                    ? 'border-live bg-live-tint text-live-ink'
                    : 'border-rule-strong bg-surface text-ink-2 hover:text-ink',
                  FOCUS
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'h-3 w-3 rounded-[3px] border',
                    levelOnly ? 'border-live bg-live' : 'border-ink-3'
                  )}
                />
                Level only
              </button>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      'inline-flex h-8 items-center gap-1.5 rounded-control border px-2 text-[12px] font-medium',
                      filterCount
                        ? 'border-ink-2 text-ink'
                        : 'border-rule-strong bg-surface text-ink-2 hover:text-ink',
                      FOCUS
                    )}
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
                    <span className="sr-only cq-lg:not-sr-only">Filters</span>
                    {filterCount ? (
                      <span className="rounded-full bg-ink px-1.5 text-[10.5px] font-semibold leading-4 text-surface">
                        {filterCount}
                      </span>
                    ) : null}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-64 space-y-2 p-3">
                  <CheckRow
                    id={`${idPrefix}-hide-stale`}
                    checked={hideStale}
                    onChange={setHideStale}
                    className="text-[13px]"
                  >
                    Hide older rate books
                    <span className="t-meta block text-ink-3">Carriers marked Rate verify</span>
                  </CheckRow>
                  <CheckRow
                    id={`${idPrefix}-not-appointed`}
                    checked={showNotAppointed}
                    onChange={setShowNotAppointed}
                    className="text-[13px]"
                  >
                    Show not appointed
                    <span className="t-meta block text-ink-3">
                      Carriers you cannot write, for reference
                    </span>
                  </CheckRow>
                </PopoverContent>
              </Popover>
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
            className="rounded-card border border-ringing bg-ringing-tint px-3 py-2"
          >
            <p className="flex items-center gap-2 text-[13px] font-semibold text-ringing-ink">
              <HelpCircle className="h-4 w-4" aria-hidden />
              Confirm what these are prescribed for
            </p>
            <p className="t-meta mt-0.5 text-ink-2">
              Until you answer, each carrier applies the strictest use it lists.
            </p>
            <ul className="mt-1.5 space-y-1">
              {[...needsIndication.entries()].map(([drugId, need]) => (
                <li key={drugId} className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 min-w-[96px] text-[13px] font-medium capitalize text-ink">
                    {need.name}
                  </span>
                  {need.options.map(code => (
                    <button
                      key={code}
                      type="button"
                      onClick={() => dispatch({ type: 'setIndication', drugId, indication: code })}
                      className={cn(
                        'h-7 rounded-control border border-rule-strong bg-surface px-2.5 text-xs font-medium text-ink transition-colors duration-150 ne-motion hover:border-ink-2',
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
                badge={i === 0 && topEarned(r) ? firstLabel : undefined}
                tag={
                  r.productId === bestLevelId &&
                  !(i === 0 && topEarned(r) && effectiveSort === 'price')
                    ? 'Best level'
                    : undefined
                }
              />
            ))
          ) : (
            <li className="px-4 py-8 text-center text-[13px] text-ink-2">
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
          <div ref={declinedRef} className="scroll-mt-16">
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

  const narrowBar = (
    <div className="mb-2.5 flex items-center gap-2 rounded-card border border-rule bg-surface px-3 py-2 cq-lg:hidden">
      <div className="min-w-0 flex-1">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-3">
          Applicant
        </p>
        <p className="truncate text-[13px] tabular-nums text-ink">
          {applicantLine(draft, age) || 'Not entered yet'}
        </p>
      </div>
      {editing && ready && quote.data ? (
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          onClick={() => {
            setEditing(false);
            requestAnimationFrame(() =>
              resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            );
          }}
        >
          {groups.qualifies.length} qualify
          <ArrowDown className="ml-1 h-3.5 w-3.5" aria-hidden />
        </Button>
      ) : null}
      <Button
        size="sm"
        variant={editing ? 'ghost' : 'outline'}
        className="h-8"
        aria-expanded={editing}
        aria-controls={`${idPrefix}-intake`}
        onClick={() => setEditing(v => !v)}
      >
        {editing ? (
          'Done'
        ) : (
          <>
            <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden />
            Edit
          </>
        )}
      </Button>
    </div>
  );

  return (
    <div
      ref={rootRef}
      // A size container: the layout below reads this element's width. It
      // never scrolls itself -- wide, the two columns do; narrow, its parent
      // (the page, the drawer, the console tab) does, so nothing is nested.
      className="cq h-full min-h-0"
      data-variant={variant}
      onKeyDown={onWorkspaceKeyDown}
    >
      <div
        className={cn(
          // From 900px wide (the container, not the window) the workspace fills
          // its parent and never scrolls as a whole: the form and the results
          // each scroll on their own, so both stay on one laptop screen.
          'cq-lg:grid cq-lg:h-full cq-lg:min-h-0 cq-lg:gap-3',
          'cq-lg:grid-cols-[minmax(320px,340px)_minmax(0,1fr)] cq-xl:grid-cols-[minmax(350px,380px)_minmax(0,1fr)]'
        )}
      >
        {narrowBar}

        <section
          id={`${idPrefix}-intake`}
          aria-label="Applicant and health"
          className={cn(
            'mb-3 min-w-0 cq-lg:mb-0 cq-lg:block cq-lg:min-h-0 cq-lg:overflow-y-auto cq-lg:overscroll-contain cq-lg:pb-3 cq-lg:pr-0.5',
            !editing && 'hidden'
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
              setCompare([]);
              previousOutcomes.current = null;
              setChanges([]);
              setEditing(true);
            }}
          />
        </section>

        <section
          ref={resultsRef}
          aria-label="Results"
          aria-live="polite"
          className="cq flex min-w-0 scroll-mt-2 flex-col cq-lg:min-h-0 cq-lg:overflow-y-auto cq-lg:overscroll-contain cq-lg:pr-0.5"
        >
          <div className="flex-1">{body}</div>
          {selection || compare.length ? (
            <div className="sticky bottom-0 z-10 mt-2.5 space-y-1.5 pb-1">
              {compare.length ? (
                <CompareTray
                  count={compared.length}
                  onOpen={() => setCompareOpen(true)}
                  onClear={() => setCompare([])}
                />
              ) : null}
              {selection ? (
                <SelectedQuoteBar
                  selection={selection}
                  onStart={onStartApplication}
                  note={selectedNote}
                  onClear={() => setSelection(null)}
                />
              ) : null}
            </div>
          ) : null}
        </section>
      </div>

      <ComparePanel
        open={compareOpen && compared.length >= 2}
        onOpenChange={setCompareOpen}
        results={compared}
        selectedId={selection?.productId}
        busyId={busy}
        onUse={(r, line) => void use(r, line)}
      />
    </div>
  );
}

const FIGURE_DOT = {
  live: 'bg-live',
  dropped: 'bg-dropped',
} as const;

/** One figure in the summary line: the number dominant, its words small. */
function Figure({
  value,
  caption,
  after,
  label,
  dot,
}: {
  value: string;
  /** Small words before the number ("Lowest"). */
  caption?: string;
  /** Small words after it ("/mo", "of 24 qualify"). */
  after?: string;
  /** The figure's full name, for screen readers. */
  label: string;
  dot?: keyof typeof FIGURE_DOT;
}): JSX.Element {
  return (
    <p
      className="flex items-baseline gap-1 whitespace-nowrap"
      aria-label={`${label}: ${value}${after?.startsWith('/') ? ` ${after}` : ''}`}
    >
      {dot ? (
        <span aria-hidden className={cn('h-2 w-2 self-center rounded-full', FIGURE_DOT[dot])} />
      ) : null}
      {caption ? <span className="text-[12px] text-ink-2">{caption}</span> : null}
      <span className="text-[17px] font-semibold tabular-nums leading-6 tracking-[-0.01em] text-ink">
        {value}
      </span>
      {after ? <span className="text-[12px] text-ink-2">{after}</span> : null}
    </p>
  );
}

function Divider(): JSX.Element {
  return <span aria-hidden className="hidden h-5 w-px bg-rule cq-sm:block" />;
}

/** "3 outcomes changed", and which, from the last edit. */
function ChangesNote({ changes }: { changes: OutcomeChange[] }): JSX.Element {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1 rounded-control border border-rule-strong px-2 py-0.5 text-[12px] font-medium text-ink-2 hover:text-ink',
            FOCUS
          )}
        >
          {changes.length} outcome{changes.length === 1 ? '' : 's'} changed
          <ChevronDown className="h-3 w-3" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <p className="border-b border-rule px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
          Since your last change
        </p>
        <ul className="max-h-72 overflow-y-auto py-1">
          {changes.map(c => (
            <li key={c.productId} className="flex items-baseline gap-2 px-3 py-1 text-[13px]">
              <span className="min-w-0 flex-1 truncate text-ink">
                {c.carrier} <span className="text-ink-2">{c.product}</span>
              </span>
              <span className="shrink-0 whitespace-nowrap text-[12px]">
                <span className="text-ink-3">{c.from}</span>
                <span className="text-ink-3"> → </span>
                <span
                  className={cn(
                    'font-semibold',
                    c.direction === 'worse'
                      ? 'text-dropped-ink'
                      : c.direction === 'better'
                        ? 'text-live-ink'
                        : 'text-ink'
                  )}
                >
                  {c.to}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
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
        <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', GROUP_DOT[tone])} />
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-2">
          {title}
        </span>
        <span className="text-[12px] font-semibold tabular-nums text-ink">{count}</span>
      </span>
      {collapsible ? (
        <span className="flex items-center gap-1 text-[12px] font-medium text-ink-2">
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
              'flex h-8 w-full items-center justify-between gap-2 px-3 text-left hover:bg-paper',
              open && 'border-b border-rule',
              FOCUS
            )}
          >
            {heading}
          </button>
        ) : (
          <span className="flex h-8 items-center justify-between gap-2 border-b border-rule px-3">
            {heading}
          </span>
        )}
      </h3>
      {open ? <ul aria-labelledby={headingId}>{children}</ul> : null}
    </Panel>
  );
}
