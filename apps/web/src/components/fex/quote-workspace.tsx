'use client';

/**
 * The quoter: an insurance decision workstation.
 *
 * One component, four homes -- the Quote page, the drawer over a live call,
 * the call-center console's Quote tab, and a CRM customer's own quote
 * workspace. On a call, the draft and the quote the agent used live in the
 * QuoteSession under the call id; for a customer, under the customer
 * (`sessionKey`), so closing the drawer, switching tabs or stepping back to
 * the customer record loses nothing.
 *
 * The workspace knows nothing about who it is quoting beyond the ids it is
 * handed: `insuranceLeadId` is optional everywhere, and the server decides
 * whether a saved quote may be filed on that customer.
 *
 * ── What is on screen ────────────────────────────────────────────────────────
 *
 *   intake (left)     every answer, open: applicant, coverage, health,
 *                     medications; then whether it can quote, and the action
 *   results (right)   a command bar -- how many qualify, the prices that
 *                     matter, the categories (qualified, needs review,
 *                     declined), sort, filter and search -- pinned over one
 *                     dense list with column headings; what the last edit
 *                     changed, said carrier by carrier; the comparison tray
 *                     and the selected quote pinned at the foot
 *
 * ── Layout follows the space it is given ─────────────────────────────────────
 *
 * The workspace is a size container, and its layout is decided by its OWN
 * width, not the window's: the same code is a full-screen page, a 1180px
 * drawer and a console column. From 900px wide it is two columns that each
 * scroll on their own and the whole never scrolls; below that the results
 * lead, and the applicant is a one-line snapshot whose parts open the intake
 * at that part.
 */

import { BENEFIT_LABEL } from '@hopwhistle/fex-engine/catalog';
import type { QuoteLine } from '@hopwhistle/fex-engine/types';
import { ArrowDown, Pencil, RefreshCw } from 'lucide-react';
import * as React from 'react';

import { Notice } from '@/components/domain';
import { Button } from '@/components/ui/button';
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
  missingFieldsForQuote,
  toApplicant,
  type QuoteDraft,
} from '@/lib/fex/draft';
import { describeDraftChange } from '@/lib/fex/draft-diff';
import {
  applicantSummary,
  coverageSummary,
  MISSING_LABEL,
  medShortName,
  type IntakeSection,
} from '@/lib/fex/intake-status';
import {
  diffOutcomes,
  outcomeMap,
  type CarrierOutcome,
  type OutcomeChange,
} from '@/lib/fex/outcome-diff';
import {
  DEFAULT_FILTERS,
  groupResults,
  type ResultCategory,
  type ResultFilters,
  type SortKey,
} from '@/lib/fex/results-view';
import { cn } from '@/lib/utils';

import { ComparePanel, CompareTray } from './compare-panel';
import { FOCUS, shortLabel } from './parts';
import { QuoteIntake, type LiveState, type QuoteIntakeHandle } from './quote-intake';
import { ResultRow, SelectedQuoteBar } from './result-row';
import {
  ChangesStrip,
  ColumnHeadings,
  LoadingRows,
  PreQuotePane,
  ResultsBar,
  ShortcutList,
} from './results-parts';

export interface QuoteWorkspaceProps {
  variant: 'page' | 'drawer' | 'embedded';
  initialDraft: QuoteDraft;
  source: QuoteSource;
  callId?: string | null;
  insuranceLeadId?: string | null;
  prospectName?: string | null;
  /**
   * Where the draft and selection live in the QuoteSession, so they outlive
   * this component. Defaults to the call id; a customer's workspace passes
   * its own key. None: the workspace keeps them itself.
   */
  sessionKey?: string | null;
  onUseQuote?: (selection: FexSelection) => void;
  /** The selected quote's primary action (the console: open the disposition). */
  onStartApplication?: () => void;
  /** The selected quote's primary action label ("Start application"). */
  startLabel?: string;
  /** Shown with the selected quote instead of a Start button. */
  selectedNote?: string;
  /** Every edit to the draft, for a host that shows something about it. */
  onDraftChange?: (draft: QuoteDraft) => void;
  /** After a quote is saved, with or without a selection. */
  onSaved?: (saved: { id: string; selection: FexSelection | null }) => void;
  /** Where a saved quote can be found again, for its toast ("It is in History."). */
  savedWhere?: string;
  /** What "New quote" starts from. Default: an empty draft. A customer's: their record. */
  resetDraft?: () => QuoteDraft;
  /** The Quote page's other sections, offered before a quote ("Search underwriting"). */
  onOpenTab?: (tab: 'conditions' | 'history' | 'carriers') => void;
}

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

export function QuoteWorkspace({
  variant,
  initialDraft,
  source,
  callId,
  insuranceLeadId,
  prospectName,
  sessionKey: sessionKeyProp,
  onUseQuote,
  onStartApplication,
  startLabel,
  selectedNote,
  onDraftChange,
  onSaved,
  savedWhere = 'It is in History.',
  resetDraft,
  onOpenTab,
}: QuoteWorkspaceProps): JSX.Element {
  const session = useQuoteSession();
  const { isPlatformAdmin } = useAuth();
  const { catalog } = useFexCatalog();
  const idPrefix = React.useId().replace(/:/g, '');

  const sessionKey = session ? (sessionKeyProp ?? callId ?? null) : null;
  const [draft, dispatch] = React.useReducer(
    draftReducer,
    undefined,
    () => (sessionKey ? session?.getDraft(sessionKey) : undefined) ?? initialDraft
  );
  const onDraftChangeRef = React.useRef(onDraftChange);
  onDraftChangeRef.current = onDraftChange;
  React.useEffect(() => {
    if (sessionKey) session?.setDraft(sessionKey, draft);
    onDraftChangeRef.current?.(draft);
  }, [draft, sessionKey, session]);

  const quote = useFexQuote(draft);
  const [localSelection, setLocalSelection] = React.useState<FexSelection | null>(null);
  const selection = sessionKey ? (session?.getSelection(sessionKey) ?? null) : localSelection;
  const setSelection = (next: FexSelection | null) =>
    sessionKey ? session?.setSelection(sessionKey, next) : setLocalSelection(next);

  const [sort, setSort] = React.useState<SortKey | null>(null);
  const [filters, setFilters] = React.useState<ResultFilters>(DEFAULT_FILTERS);
  const [category, setCategory] = React.useState<ResultCategory>('qualified');
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [compare, setCompare] = React.useState<string[]>([]);
  const [compareOpen, setCompareOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const resultsRef = React.useRef<HTMLElement>(null);
  const intakeRef = React.useRef<QuoteIntakeHandle>(null);

  // Narrow (below the two-column width): the results lead and the applicant
  // folds to a snapshot. Open to start with only when there is nothing to quote.
  const [editing, setEditing] = React.useState(() => !toApplicant(draft));

  const naturalSort: SortKey = draft.coverage.mode === 'budget' ? 'face' : 'price';
  const effectiveSort: SortKey = sort ?? naturalSort;

  const results = React.useMemo(() => quote.data?.results ?? [], [quote.data]);
  const accendoAppointed =
    catalog?.products.find(p => p.id === 'accendo_final_expense')?.appointed ??
    results.find(r => r.productId === 'accendo_final_expense')?.appointed ??
    false;

  const conditionLabel = React.useCallback(
    (code: string) => catalog?.conditions.find(c => c.code === code)?.label ?? code,
    [catalog]
  );

  /*
   * What the last edit did to each carrier's answer, compared response to
   * response off the engine's own results (see outcome-diff.ts), and what the
   * agent changed in between (draft-diff.ts). A new quote starts it over.
   */
  const draftRef = React.useRef(draft);
  draftRef.current = draft;
  const previous = React.useRef<{
    outcomes: Map<string, CarrierOutcome>;
    draft: QuoteDraft;
  } | null>(null);
  const [changes, setChanges] = React.useState<{ list: OutcomeChange[]; trigger: string[] }>({
    list: [],
    trigger: [],
  });
  React.useEffect(() => {
    if (!quote.data) return;
    const next = quote.data.results;
    const was = previous.current;
    const list = was ? diffOutcomes(was.outcomes, next) : [];
    setChanges({
      list,
      trigger:
        was && list.length ? describeDraftChange(was.draft, draftRef.current, conditionLabel) : [],
    });
    previous.current = { outcomes: outcomeMap(next), draft: draftRef.current };
  }, [quote.data, conditionLabel]);
  const changeById = React.useMemo(
    () => new Map(changes.list.map(c => [c.productId, c])),
    [changes.list]
  );

  /** Drug ids a carrier asked about, with the uses offered: asked in the medication's row. */
  const needsIndication = React.useMemo(() => {
    const map = new Map<string, string[]>();
    for (const r of results) {
      for (const n of r.needsIndication) {
        map.set(n.drugId, [...new Set([...(map.get(n.drugId) ?? []), ...n.options])]);
      }
    }
    // Answered on the draft already: the next quote will drop it.
    for (const med of draft.meds) if (med.indication) map.delete(med.drugId);
    return map;
  }, [results, draft.meds]);

  const groups = React.useMemo(
    () => groupResults(results, filters, sort),
    [results, filters, sort]
  );

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
      onSaved?.({ id: saved.data.id, selection: null });
      toast({ title: 'Quote saved', description: savedWhere });
      return null;
    }
    const chosen = { fexQuoteId: saved.data.id, ...saved.data.selected };
    onSaved?.({ id: saved.data.id, selection: chosen });
    return chosen;
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
  // A carrier that leaves the results (a re-quote) leaves the comparison.
  const compared = React.useMemo(
    () =>
      compare
        .map(id => results.find(r => r.productId === id))
        .filter((r): r is FexResult => Boolean(r?.eligible && r.best)),
    [compare, results]
  );

  /*
   * The name a health answer is reported under on a row ("COPD → Graded"),
   * only when the applicant gave exactly one: one condition and no
   * medication. The engine does not say which condition a rule matched, so
   * with two or more the row says "2 health answers" rather than guess.
   */
  const healthSubject = React.useMemo(() => {
    if (draft.conditions.length !== 1 || draft.meds.length) return null;
    const label = catalog?.conditions.find(c => c.code === draft.conditions[0].code)?.label;
    return label ? shortLabel(label) : null;
  }, [draft.conditions, draft.meds, catalog]);

  // ── The recommendation, and the labels the figures bear out ──────────────
  const maxFace = groups.qualified.reduce((max, r) => Math.max(max, r.best?.face ?? 0), 0);
  const recommendedId = React.useMemo(() => {
    const priced = groups.qualified.filter(r => r.best?.premium != null);
    if (!priced.length) return null;
    const pick =
      naturalSort === 'face'
        ? [...priced].sort(
            (a, b) => b.best!.face - a.best!.face || a.best!.premium! - b.best!.premium!
          )[0]
        : [...priced].sort((a, b) => a.best!.premium! - b.best!.premium!)[0];
    return pick.productId;
  }, [groups.qualified, naturalSort]);
  const bestLevelId =
    groups.lowestLevel === null
      ? null
      : (groups.qualified.find(
          r => r.best?.benefit === 'LEVEL' && r.best.premium === groups.lowestLevel
        )?.productId ?? null);
  const labelsFor = (r: FexResult): string[] => {
    if (!r.best) return [];
    const labels: string[] = [];
    const bestPrice = r.best.premium != null && r.best.premium === groups.lowestAny;
    if (bestPrice) labels.push('Best price');
    if (naturalSort === 'face' && r.best.face === maxFace) labels.push('Most coverage');
    if (r.productId === bestLevelId && !bestPrice) labels.push('Best level');
    return labels;
  };

  const rowProps = (r: FexResult, opts: { priceOnly?: boolean; ranked?: boolean } = {}) => ({
    result: r,
    expanded: expanded === r.productId,
    onToggle: () => setExpanded(open => (open === r.productId ? null : r.productId)),
    onUse: (res: FexResult, line: QuoteLine) => void use(res, line),
    onCopy: (res: FexResult) => void copy(res),
    onSave: (res: FexResult) => void save(res, null),
    busy: busy === r.productId,
    isStaff: isPlatformAdmin,
    priceOnly: opts.priceOnly ?? (r.eligible && !r.uwLoaded),
    selected: selection?.productId === r.productId,
    recommended: Boolean(opts.ranked) && r.productId === recommendedId,
    labels: opts.ranked ? labelsFor(r) : [],
    compared: compare.includes(r.productId),
    onCompareToggle: () => toggleCompare(r.productId),
    compareFull: compare.length >= COMPARE_MAX,
    comparing: compare.length > 0,
    change: changeById.get(r.productId),
    healthSubject,
  });

  const ready = Boolean(toApplicant(draft));

  /** Open one carrier's row, in whichever category it is, and bring it into view. */
  const showCarrier = React.useCallback(
    (productId: string) => {
      const r = results.find(x => x.productId === productId);
      if (!r) return;
      const next: ResultCategory = !r.eligible
        ? 'declined'
        : !r.appointed
          ? 'notAppointed'
          : 'qualified';
      // Clear whatever would hide it.
      setFilters(f => ({
        ...f,
        search: '',
        benefit: 'any',
        hideStale: false,
        showNotAppointed: f.showNotAppointed || !r.appointed,
      }));
      setCategory(next);
      setExpanded(productId);
      setEditing(false);
      requestAnimationFrame(() =>
        rootRef.current
          ?.querySelector(`[data-product="${productId}"]`)
          ?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
      );
    },
    [results]
  );

  /** Alt+H: the condition search; Alt+M: the medication search. */
  const focusHealthSearch = React.useCallback((code?: string) => {
    setEditing(true);
    intakeRef.current?.focusSearch(code === 'KeyM' ? 'meds' : 'health');
  }, []);

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
      focusHealthSearch(event.code);
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
      focusHealthSearch(event.code);
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
        next.scrollIntoView?.({ block: 'nearest' });
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
  const mode = MODE_SHORT[draft.paymentMode];
  const live: LiveState = !quote.data
    ? 'idle'
    : quote.stale
      ? 'updating'
      : quote.status === 'error'
        ? 'error'
        : 'live';
  const listId = `${idPrefix}-results-list`;
  const counts: Record<ResultCategory, number> = {
    qualified: groups.qualified.length + groups.priceOnly.length,
    review: groups.review.length,
    declined: groups.declined.length,
    notAppointed: groups.notAppointed.length,
  };
  const coverageText =
    draft.coverage.mode === 'face'
      ? Number(draft.coverage.face)
        ? wholeDollars(Number(draft.coverage.face))
        : '—'
      : draft.coverage.budget
        ? `${money(Number(draft.coverage.budget))}/${mode} budget`
        : '—';

  let body: React.ReactNode;
  if (!ready) {
    const quotable = catalog?.products.filter(p => p.quotable) ?? null;
    body = (
      <PreQuotePane
        missing={missingFieldsForQuote(draft).map(f => MISSING_LABEL[f] ?? f)}
        network={
          quotable
            ? { configured: quotable.length, appointed: quotable.filter(p => p.appointed).length }
            : null
        }
        links={
          onOpenTab
            ? [
                {
                  label: 'Search underwriting',
                  detail: 'conditions and drugs, by carrier',
                  onSelect: () => onOpenTab('conditions'),
                },
                {
                  label: 'Recent quotes',
                  detail: 'reopen or requote',
                  onSelect: () => onOpenTab('history'),
                },
                {
                  label: 'Carrier coverage',
                  detail: 'states, ages and rate books',
                  onSelect: () => onOpenTab('carriers'),
                },
              ]
            : undefined
        }
      />
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
    body = <LoadingRows />;
  } else {
    const list = (rows: FexResult[], opts: { ranked?: boolean; priceOnly?: boolean } = {}) =>
      rows.map(r => <ResultRow key={r.productId} {...rowProps(r, opts)} />);
    const empty = (text: React.ReactNode) => (
      <p className="px-5 py-8 text-center text-[13px] text-ink-2">{text}</p>
    );
    let panel: React.ReactNode;
    if (category === 'qualified') {
      panel = (
        <>
          {groups.qualified.length ? (
            <ul aria-label="Qualifying carriers">{list(groups.qualified, { ranked: true })}</ul>
          ) : (
            empty(
              <>
                No appointed carrier qualifies with these answers
                {filters.search || groups.hiddenByFilters ? ' and filters' : ''}.{' '}
                {groups.declined.length ? (
                  <button
                    type="button"
                    onClick={() => setCategory('declined')}
                    className={cn('font-semibold text-brand-ink hover:underline', FOCUS)}
                  >
                    See why {groups.declined.length} declined
                  </button>
                ) : null}
              </>
            )
          )}
          {groups.priceOnly.length ? (
            <section aria-label="Price only">
              <h3 className="border-y border-rule bg-sunken px-4 py-1.5 text-[11.5px] font-semibold text-ink-2">
                Price only{' '}
                <span className="font-normal text-ink-3">
                  · {groups.priceOnly.length} · health questions not loaded
                </span>
              </h3>
              <ul>{list(groups.priceOnly, { priceOnly: true })}</ul>
            </section>
          ) : null}
        </>
      );
    } else if (category === 'review') {
      panel = groups.review.length ? (
        <ul aria-label="Carriers that need review">{list(groups.review)}</ul>
      ) : (
        empty('Nothing to review: no referral, and every medication’s use is confirmed.')
      );
    } else if (category === 'declined') {
      panel = groups.declined.length ? (
        <ul aria-label="Declined carriers">{list(groups.declined)}</ul>
      ) : (
        empty('No carrier declined these answers.')
      );
    } else {
      panel = groups.notAppointed.length ? (
        <ul aria-label="Carriers you are not appointed with">{list(groups.notAppointed)}</ul>
      ) : (
        empty('Every qualifying carrier is one you are appointed with.')
      );
    }

    body = (
      <div className="flex flex-col">
        {quote.status === 'error' ? (
          <Notice
            tone="error"
            title="Quotes could not refresh."
            className="mb-2"
            action={
              <Button size="sm" variant="outline" onClick={quote.retry}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                Retry
              </Button>
            }
          >
            Showing results from{' '}
            {new Date(quote.data.quotedAt).toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              second: '2-digit',
            })}
            . {quote.error}
          </Notice>
        ) : null}

        {quote.data.licensed === false ? (
          <Notice tone="warning" className="mb-2">
            You are not licensed in {draft.state}. Quotes are shown for reference.
          </Notice>
        ) : null}

        <p className="sr-only" aria-live="polite">
          {quote.stale
            ? 'Updating quotes'
            : `${groups.qualified.length} carriers qualify, ${groups.declined.length} declined`}
        </p>

        <ResultsBar
          idPrefix={idPrefix}
          quoted={results.length}
          qualified={groups.qualified.length}
          counts={counts}
          category={category}
          onCategory={setCategory}
          showNotAppointedTab={filters.showNotAppointed}
          lowestAny={groups.lowestAny}
          lowestLevel={groups.lowestLevel}
          coverage={coverageText}
          mode={mode}
          carriers={quote.data.carriers}
          updating={quote.stale}
          sort={effectiveSort}
          onSort={next => setSort(next === naturalSort ? null : next)}
          filters={filters}
          onFilters={patch => {
            setFilters(f => ({ ...f, ...patch }));
            if (patch.showNotAppointed === false && category === 'notAppointed')
              setCategory('qualified');
          }}
          hiddenByFilters={groups.hiddenByFilters}
          listId={listId}
        >
          {changes.list.length ? (
            <ChangesStrip
              changes={changes.list}
              trigger={changes.trigger}
              onShow={showCarrier}
              onDismiss={() => setChanges({ list: [], trigger: [] })}
            />
          ) : null}
          <ColumnHeadings compare />
        </ResultsBar>

        <div
          id={listId}
          role="tabpanel"
          aria-labelledby={`${idPrefix}-cat-${category}`}
          aria-busy={quote.stale}
          className="overflow-hidden rounded-b-[12px] border border-t-0 border-rule bg-surface shadow-card"
        >
          {panel}
        </div>
      </div>
    );
  }

  /** The applicant in one line of parts, each opening the intake at that part. */
  const snapshot: Array<{ section: IntakeSection; text: string }> = [
    { section: 'applicant', text: applicantSummary(draft).join(' · ') || 'Applicant: not entered' },
    { section: 'coverage', text: coverageSummary(draft).slice(0, 2).join(' · ') },
    {
      section: 'health',
      text: draft.conditions.length
        ? draft.conditions.map(c => shortLabel(conditionLabel(c.code))).join(', ')
        : 'No conditions',
    },
    {
      section: 'meds',
      text: draft.meds.length ? draft.meds.map(m => medShortName(m.name)).join(', ') : 'No meds',
    },
  ];

  const narrowBar = (
    <div className="mb-2.5 flex items-center gap-2 rounded-card border border-rule bg-surface px-3 py-2 shadow-card cq-lg:hidden">
      <div className="min-w-0 flex-1">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-ink-3">
          {prospectName ? `Quoting ${prospectName}` : 'Applicant'}
        </p>
        <p className="flex flex-wrap items-baseline gap-x-1 text-[13px] leading-5 tabular-nums text-ink">
          {snapshot.map((part, i) => (
            <React.Fragment key={part.section}>
              {i ? (
                <span aria-hidden className="text-ink-3">
                  ·
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setEditing(true);
                  intakeRef.current?.focusSection(part.section);
                }}
                className={cn(
                  'max-w-full rounded-[4px] text-left hover:underline',
                  part.section === 'meds' && draft.meds.length > 0 && 'capitalize',
                  part.section === 'health' || part.section === 'meds' ? 'text-ink-2' : 'text-ink',
                  FOCUS
                )}
              >
                {part.text}
              </button>
            </React.Fragment>
          ))}
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
              resultsRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
            );
          }}
        >
          {groups.qualified.length} qualify
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
            Edit applicant
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
          // its parent and never scrolls as a whole: the intake and the results
          // each scroll on their own, so both stay on one laptop screen. The
          // intake gets the width its fields need -- no squeezed rail.
          'cq-lg:grid cq-lg:h-full cq-lg:min-h-0 cq-lg:gap-3',
          'cq-lg:grid-cols-[minmax(392px,416px)_minmax(0,1fr)] cq-xl:grid-cols-[452px_minmax(0,1fr)]'
        )}
      >
        {narrowBar}

        <section
          id={`${idPrefix}-intake`}
          aria-label="Applicant and health"
          className={cn(
            // A size container from the two-column width, so the quick
            // reference under the intake appears only when the column is tall.
            'mb-3 min-w-0 cq-lg:mb-0 cq-lg:flex cq-lg:min-h-0 cq-lg:flex-col cq-lg:gap-3 cq-lg:[container-type:size]',
            !editing && 'hidden'
          )}
        >
          <QuoteIntake
            ref={intakeRef}
            idPrefix={idPrefix}
            draft={draft}
            dispatch={dispatch}
            conditions={catalog?.conditions ?? []}
            showAetnaMedSupp={accendoAppointed}
            needsIndication={needsIndication}
            live={live}
            quotedAt={quote.data?.quotedAt ?? null}
            onGetQuotes={() => {
              quote.retry();
              setEditing(false);
              requestAnimationFrame(() => {
                resultsRef.current?.scrollTo?.({ top: 0, behavior: 'smooth' });
                resultsRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
              });
            }}
            onReset={() => {
              dispatch({
                type: 'replace',
                draft: resetDraft?.() ?? emptyDraft(session?.settings?.agency),
              });
              setExpanded(null);
              setCompare([]);
              setCategory('qualified');
              setFilters(DEFAULT_FILTERS);
              previous.current = null;
              setChanges({ list: [], trigger: [] });
              setEditing(true);
            }}
          />
          <IntakeAside
            carriers={catalog?.products.filter(p => p.quotable).length ?? null}
            selection={selection}
          />
        </section>

        <section
          ref={resultsRef}
          aria-label="Results"
          className="cq flex min-w-0 scroll-mt-2 flex-col cq-lg:min-h-0 cq-lg:overflow-y-auto cq-lg:overflow-x-hidden cq-lg:overscroll-contain cq-lg:pr-1"
        >
          <div className="flex-1">{body}</div>
          {selection || compare.length ? (
            <div className="sticky bottom-0 z-10 mt-2 space-y-1.5 bg-paper pb-1 pt-1">
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
                  startLabel={startLabel}
                  note={selectedNote}
                  onView={
                    results.some(r => r.productId === selection.productId)
                      ? () => showCarrier(selection.productId)
                      : undefined
                  }
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

/**
 * Under the intake on a tall screen, the room the questions do not need:
 * the quote in use, and the keyboard. It is the first thing to give way --
 * it is shown only when the column is tall enough for it and the intake
 * together, and below the two-column width not at all.
 */
function IntakeAside({
  carriers,
  selection,
}: {
  carriers: number | null;
  selection: FexSelection | null;
}): JSX.Element {
  return (
    <aside
      aria-label="Quick reference"
      className="hidden min-h-0 shrink-[999] overflow-hidden rounded-[12px] border border-dashed border-rule-strong [@container(min-height:940px)]:block"
    >
      <div className="space-y-4 px-4 py-3.5">
        {selection ? (
          <div>
            <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-3">
              Quote in use
            </h3>
            <p className="mt-1 text-[13px] text-ink">
              <span className="font-semibold">{selection.carrier}</span> {selection.product}
            </p>
            <p className="text-[12.5px] tabular-nums text-ink-2">
              {selection.classLabel} · {wholeDollars(selection.face)} ·{' '}
              <span className="font-semibold text-ink">
                {selection.premium != null ? money(selection.premium) : '—'}/
                {MODE_SHORT[selection.mode]}
              </span>
            </p>
          </div>
        ) : null}
        <div>
          <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-3">
            Keyboard
          </h3>
          <ShortcutList />
        </div>
        {carriers ? (
          <p className="text-[12px] text-ink-3">
            {carriers} carriers configured · every one priced and underwritten on each edit
          </p>
        ) : null}
      </div>
    </aside>
  );
}
