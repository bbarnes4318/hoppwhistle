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
import { ArrowDown, Calculator, RefreshCw } from 'lucide-react';
import * as React from 'react';

import {
  EmptyState,
  Notice,
  Panel,
  Segmented,
  SegmentedItem,
  StatTile,
  StatTileRow,
  Toolbar,
} from '@/components/domain';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
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
import { ageFromDob, draftReducer, toApplicant, type QuoteDraft } from '@/lib/fex/draft';
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
  });

  const fill = variant !== 'page';
  const ready = Boolean(toApplicant(draft));

  // ── Results pane ─────────────────────────────────────────────────────────
  let body: React.ReactNode;
  if (!ready) {
    body = (
      <Panel>
        <EmptyState
          icon={Calculator}
          headline="Enter state, sex, age and coverage to see every carrier."
          body="Results update as you type. Add conditions and medications for the carriers' real answer."
        />
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
      <Panel aria-busy="true" aria-label="Quoting every carrier">
        <ul>
          {Array.from({ length: 6 }).map((_, i) => (
            <li
              key={i}
              className="flex h-14 items-center gap-3 border-b border-rule px-4 last:border-0"
            >
              <Skeleton className="h-3 w-48" />
              <Skeleton className="ml-auto h-4 w-16" />
            </li>
          ))}
        </ul>
      </Panel>
    );
  } else {
    body = (
      <div
        className={cn(
          'space-y-4 transition-opacity duration-150 ne-motion',
          quote.stale && 'opacity-60'
        )}
        aria-busy={quote.stale}
      >
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

        <StatTileRow>
          <StatTile
            label="Qualify"
            value={groups.qualifies.length}
            sub="carriers, health applied"
          />
          <StatTile
            label="Lowest Level premium"
            figure={lowestLevel === null ? '—' : money(lowestLevel)}
            sub={MODE_TITLE[draft.paymentMode]}
          />
          <StatTile label="Declined" value={groups.declined.length} sub="or not available" />
          <StatTile
            label="Needs answers"
            value={needsIndication.size}
            sub={
              needsIndication.size ? (
                <button
                  type="button"
                  className={cn('text-brand-ink hover:underline', FOCUS)}
                  onClick={() =>
                    bannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                  }
                >
                  Show
                </button>
              ) : (
                'medication uses'
              )
            }
          />
        </StatTileRow>

        {quote.data.licensed === false ? (
          <Notice tone="warning">
            You are not licensed in {draft.state}. Quotes are shown for reference.
          </Notice>
        ) : null}

        {needsIndication.size ? (
          <div ref={bannerRef}>
            <Notice tone="warning" title="Confirm what these are prescribed for">
              <ul className="mt-1 space-y-2">
                {[...needsIndication.entries()].map(([drugId, need]) => (
                  <li key={drugId} className="flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 font-medium capitalize">{need.name}:</span>
                    {need.options.map(code => (
                      <button
                        key={code}
                        type="button"
                        onClick={() =>
                          dispatch({ type: 'setIndication', drugId, indication: code })
                        }
                        className={cn(
                          'h-7 rounded-full border border-rule-strong bg-surface px-2.5 text-xs font-medium text-ink hover:bg-sunken',
                          FOCUS
                        )}
                      >
                        {catalog?.conditions.find(c => c.code === code)?.label ?? code}
                      </button>
                    ))}
                  </li>
                ))}
              </ul>
            </Notice>
          </div>
        ) : null}

        <Toolbar aria-label="Sort and filter results" className="xl:flex-wrap">
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
              Largest face
            </SegmentedItem>
          </Segmented>
          <Segmented role="radiogroup" aria-label="Benefit">
            <SegmentedItem
              role="radio"
              aria-checked={!levelOnly}
              active={!levelOnly}
              onClick={() => setLevelOnly(false)}
            >
              All
            </SegmentedItem>
            <SegmentedItem
              role="radio"
              aria-checked={levelOnly}
              active={levelOnly}
              onClick={() => setLevelOnly(true)}
            >
              Level only
            </SegmentedItem>
          </Segmented>
          <label className="flex items-center gap-2 px-1 text-sm text-ink-2">
            <Switch
              checked={hideStale}
              onCheckedChange={setHideStale}
              aria-label="Hide older rate books"
            />
            Hide older rate books
          </label>
          <label className="flex items-center gap-2 px-1 text-sm text-ink-2">
            <Switch
              checked={showNotAppointed}
              onCheckedChange={setShowNotAppointed}
              aria-label="Show not appointed"
            />
            Show not appointed
          </label>
        </Toolbar>

        <ResultGroup title="Qualifies" count={groups.qualifies.length}>
          {groups.qualifies.length ? (
            groups.qualifies.map(r => <ResultRow key={r.productId} {...rowProps(r)} />)
          ) : (
            <li className="px-4 py-6 text-sm text-ink-2">
              No appointed carrier qualifies with these answers. Check the declined list for why.
            </li>
          )}
        </ResultGroup>

        {groups.priceOnly.length ? (
          <ResultGroup
            title="Price only — health questions not loaded"
            count={groups.priceOnly.length}
          >
            {groups.priceOnly.map(r => (
              <ResultRow key={r.productId} {...rowProps(r, true)} />
            ))}
          </ResultGroup>
        ) : null}

        {showNotAppointed && groups.notAppointed.length ? (
          <ResultGroup
            title="Not appointed"
            count={groups.notAppointed.length}
            collapsible
            defaultOpen={false}
          >
            {groups.notAppointed.map(r => (
              <ResultRow key={r.productId} {...rowProps(r, !r.uwLoaded)} />
            ))}
          </ResultGroup>
        ) : null}

        {groups.declined.length ? (
          <ResultGroup
            title="Declined or not available"
            count={groups.declined.length}
            collapsible
            open={showDeclined}
            onOpenChange={setShowDeclined}
          >
            {groups.declined.map(r => (
              <ResultRow key={r.productId} {...rowProps(r)} />
            ))}
          </ResultGroup>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'relative lg:grid lg:grid-cols-[minmax(380px,440px)_minmax(0,1fr)] lg:gap-5',
        fill && 'lg:h-full lg:min-h-0'
      )}
      data-variant={variant}
    >
      {ready && quote.data ? (
        <div className="sticky top-0 z-20 -mx-1 mb-3 flex items-center justify-between gap-3 rounded-card border border-rule bg-surface px-3 py-2 shadow-raised lg:hidden">
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
        />
      </section>

      <section
        ref={resultsRef}
        aria-label="Results"
        aria-live="polite"
        className={cn(
          'mt-4 flex min-w-0 flex-col lg:mt-0',
          fill && 'lg:min-h-0 lg:overflow-y-auto'
        )}
      >
        <div className="flex-1">{body}</div>
        {selection ? (
          <div className="mt-4">
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

function ResultGroup({
  title,
  count,
  children,
  collapsible = false,
  defaultOpen = true,
  open: controlledOpen,
  onOpenChange,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}): JSX.Element {
  const [ownOpen, setOwnOpen] = React.useState(defaultOpen);
  const open = collapsible ? (controlledOpen ?? ownOpen) : true;
  const toggle = () => {
    onOpenChange?.(!open);
    setOwnOpen(!open);
  };
  const headingId = React.useId();
  return (
    <Panel className="overflow-hidden">
      <h3 id={headingId} className="m-0">
        {collapsible ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={toggle}
            className={cn(
              'flex w-full items-center justify-between gap-2 border-b border-rule px-4 py-3 text-left',
              FOCUS
            )}
          >
            <span className="t-section text-ink">{title}</span>
            <span className="t-meta tabular-nums text-ink-3">
              {count} · {open ? 'Hide' : 'Show'}
            </span>
          </button>
        ) : (
          <span className="flex items-center justify-between gap-2 border-b border-rule px-4 py-3">
            <span className="t-section text-ink">{title}</span>
            <span className="t-meta tabular-nums text-ink-3">{count}</span>
          </span>
        )}
      </h3>
      {open ? <ul aria-labelledby={headingId}>{children}</ul> : null}
    </Panel>
  );
}
