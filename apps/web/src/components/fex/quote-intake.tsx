'use client';

/**
 * The quoter's left column: the quote's state, and one place to change it.
 *
 * ── State, not a form ────────────────────────────────────────────────────────
 *
 * Four sections, in the order an agent asks: Applicant, Coverage, Health,
 * Medications. Each is always on screen as what it holds -- "AL · Male ·
 * Age 65 · Non-tobacco", "$10,000 face · Monthly", "Diabetes — 2 details
 * needed" -- with a mark that says complete, needs review, or required.
 * Exactly ONE section is open as an editor at a time, in its own place in
 * the stack. So the column never becomes a page to scroll through: on a
 * laptop all four sections and the Get quotes button stay in view, and the
 * open editor is the only thing with height.
 *
 * ── Required work never appears out of sight ─────────────────────────────────
 *
 * Health and Medications are a list or ONE item, never both: adding Diabetes
 * replaces the list with Diabetes's questions, right where the search was,
 * cursor in the first. Done returns to the list with the cursor back in the
 * search. Anything still unanswered is named in its section's summary and
 * above Get quotes, and each mention opens that exact question.
 *
 * Every edit re-quotes; the results on the right follow as the agent types.
 */

import { AlertCircle, ArrowRight, RotateCcw } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { missingForQuote, type DraftAction, type QuoteDraft } from '@/lib/fex/draft';
import {
  applicantDone,
  applicantSummary,
  applicantUnasked,
  attentionItems,
  conditionComplete,
  conditionFacts,
  coverageDone,
  coverageSummary,
  detailsNeededText,
  medConditionCodes,
  medNeedsUse,
  medShortName,
  medTakenText,
  MISSING_TEXT,
  SECTION_TITLE,
  sectionOfMissing,
  type AttentionItem,
  type IntakeSection as SectionKey,
} from '@/lib/fex/intake-status';
import { cn } from '@/lib/utils';

import { ApplicantEditor } from './intake/applicant-editor';
import { CoverageEditor } from './intake/coverage-editor';
import { HealthManager, healthSearchId, type ConditionMeta } from './intake/health-manager';
import { MedicationManager, medsSearchId } from './intake/medication-manager';
import { IntakeSection, SummaryItem, SummaryText, type SectionStatus } from './intake/section';
import { FOCUS, shortLabel } from './parts';

export { healthSearchId, medsSearchId, type ConditionMeta };

export interface QuoteIntakeProps {
  idPrefix: string;
  /** Get quotes: run the quote now and bring the results into view. */
  onGetQuotes?: () => void;
  /** Start over: clears every answer back to the agency defaults. */
  onReset?: () => void;
  draft: QuoteDraft;
  dispatch: React.Dispatch<DraftAction>;
  conditions: ConditionMeta[];
  /** Show the Aetna Medicare Supplement question (Accendo is appointed). */
  showAetnaMedSupp: boolean;
  /** Drug ids the last quote said need their use confirmed. */
  needsIndication: Map<string, string[]>;
}

/** What the workspace may ask of the intake from outside it (Alt+H, Alt+M). */
export interface QuoteIntakeHandle {
  /** Open Health (or Medications) on its list and put the cursor in its search. */
  focusSearch: (which: 'health' | 'meds') => void;
}

const NEXT: Record<SectionKey, SectionKey | null> = {
  applicant: 'coverage',
  coverage: 'health',
  health: 'meds',
  meds: null,
};

/** Where a quote starts: the first section that still stops it, else Health. */
function firstOpen(draft: QuoteDraft): SectionKey {
  if (!applicantDone(draft) || applicantUnasked(draft).length) return 'applicant';
  if (!coverageDone(draft)) return 'coverage';
  return 'health';
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** How many item lines a closed Health or Medications section shows. */
const SUMMARY_LINES = 3;

export const QuoteIntake = React.forwardRef<QuoteIntakeHandle, QuoteIntakeProps>(
  function QuoteIntake(props, ref) {
    const { idPrefix, draft, dispatch, conditions, needsIndication, showAetnaMedSupp, onReset } =
      props;
    const byCode = React.useMemo(() => new Map(conditions.map(c => [c.code, c])), [conditions]);
    const conditionLabel = React.useCallback(
      (code: string) => byCode.get(code)?.label ?? code,
      [byCode]
    );

    const [open, setOpen] = React.useState<SectionKey | null>(() => firstOpen(draft));
    const [healthItem, setHealthItem] = React.useState<string | null>(null);
    const [medItem, setMedItem] = React.useState<string | null>(null);

    /*
     * Focus follows the agent's move, after the editor it lands in has
     * rendered: a selector, consumed by the effect below on the next commit.
     */
    const [focusWanted, setFocusWanted] = React.useState<{ selector: string } | null>(null);
    React.useEffect(() => {
      if (!focusWanted) return;
      const target = document.querySelector<HTMLElement>(focusWanted.selector);
      target?.scrollIntoView?.({ block: 'nearest' });
      target?.focus();
      setFocusWanted(null);
    }, [focusWanted]);

    const byId = (id: string) => `[id="${id}"]`;
    const sectionSel = (s: SectionKey) => byId(`${idPrefix}-sec-${s}-body`);
    const firstControl = (s: SectionKey) =>
      `${sectionSel(s)} :is(input, select, [role="radio"][tabindex="0"], button):not([disabled])`;

    /** Open a section (and one of its items); focus lands in it. */
    const goTo = React.useCallback(
      (section: SectionKey | null, itemKey: string | null = null) => {
        setOpen(section);
        setHealthItem(section === 'health' ? itemKey : null);
        setMedItem(section === 'meds' ? itemKey : null);
        // An item's editor focuses its own first question.
        if (section && !itemKey) setFocusWanted({ selector: firstControl(section) });
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [idPrefix]
    );

    React.useImperativeHandle(
      ref,
      () => ({
        focusSearch: which => {
          setOpen(which);
          setHealthItem(null);
          setMedItem(null);
          setFocusWanted({
            selector: byId(which === 'meds' ? medsSearchId(idPrefix) : healthSearchId(idPrefix)),
          });
        },
      }),
      [idPrefix]
    );

    const missing = missingForQuote(draft);
    const attention = attentionItems(draft, needsIndication, conditionLabel);

    // ── Section states ────────────────────────────────────────────────────
    const unasked = applicantUnasked(draft);
    const applicantStatus: SectionStatus = !applicantDone(draft)
      ? 'required'
      : unasked.length
        ? 'attention'
        : 'complete';
    const coverageStatus: SectionStatus = coverageDone(draft) ? 'complete' : 'required';
    const healthOpen = draft.conditions.filter(c => !conditionComplete(c)).length;
    const healthStatus: SectionStatus = !draft.conditions.length
      ? 'empty'
      : healthOpen
        ? 'attention'
        : 'complete';
    const medsOpen = draft.meds.filter(m =>
      medNeedsUse(m, needsIndication.get(m.drugId), conditionLabel)
    ).length;
    const medsStatus: SectionStatus = !draft.meds.length
      ? 'empty'
      : medsOpen
        ? 'attention'
        : 'complete';

    const nextOf = (s: SectionKey) => {
      const next = NEXT[s];
      return next
        ? { label: `Next: ${SECTION_TITLE[next]}`, onClick: () => goTo(next) }
        : { label: 'Done', onClick: () => goTo(null) };
    };
    const common = (s: SectionKey) => ({
      id: `${idPrefix}-sec-${s}`,
      title: SECTION_TITLE[s],
      open: open === s,
      onOpen: () => goTo(s),
      onClose: () => goTo(null),
    });

    const missingHere = (s: SectionKey) =>
      missing && sectionOfMissing(missing) === s
        ? (MISSING_TEXT[missing] ?? 'Needs an answer')
        : null;

    return (
      <div className="flex min-w-0 flex-col cq-lg:h-full cq-lg:min-h-0">
        {/* One scroll region, and in the common case nothing to scroll: the
            open editor is the only part of the stack with height. */}
        <div
          data-intake-body=""
          className="min-w-0 cq-lg:min-h-0 cq-lg:flex-1 cq-lg:overflow-y-auto cq-lg:overflow-x-hidden cq-lg:overscroll-contain cq-lg:pb-2.5 cq-lg:pr-1"
        >
          <div className="divide-y divide-rule rounded-[12px] border border-rule bg-surface shadow-card">
            <IntakeSection
              {...common('applicant')}
              status={applicantStatus}
              meta={
                missingHere('applicant') ??
                (unasked.length ? `Ask ${unasked.join(', ').toLowerCase()}` : null)
              }
              metaTone="attention"
              summary={
                <SummaryText tone={applicantSummary(draft).length ? 'ink' : 'quiet'}>
                  {applicantSummary(draft).join(' · ') || 'Not entered yet'}
                </SummaryText>
              }
              next={nextOf('applicant')}
            >
              <ApplicantEditor idPrefix={idPrefix} draft={draft} dispatch={dispatch} />
            </IntakeSection>

            <IntakeSection
              {...common('coverage')}
              status={coverageStatus}
              meta={missingHere('coverage')}
              metaTone="attention"
              summary={<SummaryText>{coverageSummary(draft).join(' · ')}</SummaryText>}
              next={nextOf('coverage')}
            >
              <CoverageEditor
                idPrefix={idPrefix}
                draft={draft}
                dispatch={dispatch}
                showAetnaMedSupp={showAetnaMedSupp}
              />
            </IntakeSection>

            <IntakeSection
              {...common('health')}
              status={healthStatus}
              meta={
                healthOpen
                  ? `${healthOpen} to review`
                  : draft.conditions.length
                    ? plural(draft.conditions.length, 'condition')
                    : null
              }
              metaTone={healthOpen ? 'attention' : 'quiet'}
              summary={
                draft.conditions.length ? (
                  <ItemSummary
                    count={draft.conditions.length}
                    items={draft.conditions.map(c => {
                      const complete = conditionComplete(c);
                      const meds = draft.meds
                        .filter(m => medConditionCodes(m).includes(c.code))
                        .map(m => medShortName(m.name));
                      return {
                        key: c.key,
                        complete,
                        title: shortLabel(conditionLabel(c.code)),
                        detail: [...conditionFacts(c), ...meds].join(' · '),
                        attention: complete ? undefined : detailsNeededText(c),
                      };
                    })}
                    onItem={key => goTo('health', key)}
                    onMore={() => goTo('health')}
                  />
                ) : (
                  <SummaryText tone="quiet">No conditions</SummaryText>
                )
              }
              next={healthItem ? undefined : nextOf('health')}
            >
              <HealthManager
                idPrefix={idPrefix}
                draft={draft}
                dispatch={dispatch}
                conditions={conditions}
                item={healthItem}
                onItem={setHealthItem}
              />
            </IntakeSection>

            <IntakeSection
              {...common('meds')}
              status={medsStatus}
              meta={
                medsOpen
                  ? `${medsOpen} to review`
                  : draft.meds.length
                    ? plural(draft.meds.length, 'medication')
                    : null
              }
              metaTone={medsOpen ? 'attention' : 'quiet'}
              summary={
                draft.meds.length ? (
                  <ItemSummary
                    count={draft.meds.length}
                    capitalize
                    items={draft.meds.map(m => {
                      const needs = medNeedsUse(m, needsIndication.get(m.drugId), conditionLabel);
                      const uses = medConditionCodes(m).map(code =>
                        shortLabel(conditionLabel(code))
                      );
                      const taken = medTakenText(m);
                      return {
                        key: m.key,
                        complete: !needs,
                        title: m.name,
                        detail: [...uses.map(u => `for ${u}`), taken].filter(Boolean).join(' · '),
                        attention: needs ? 'what is it for?' : undefined,
                      };
                    })}
                    onItem={key => goTo('meds', key)}
                    onMore={() => goTo('meds')}
                  />
                ) : (
                  <SummaryText tone="quiet">No medications</SummaryText>
                )
              }
              next={medItem ? undefined : nextOf('meds')}
            >
              <MedicationManager
                idPrefix={idPrefix}
                draft={draft}
                dispatch={dispatch}
                needsIndication={needsIndication}
                conditionLabel={conditionLabel}
                item={medItem}
                onItem={setMedItem}
              />
            </IntakeSection>
          </div>
        </div>

        <IntakeFooter
          {...props}
          missing={missing}
          attention={attention}
          onFix={item => {
            goTo(item.section, item.itemKey ?? null);
            if (item.section === 'applicant')
              setFocusWanted({
                selector: `${sectionSel('applicant')} [role="radiogroup"][aria-label^="Tobacco"] [role="radio"][tabindex="0"]`,
              });
          }}
          onFixMissing={field => {
            const section = sectionOfMissing(field);
            setOpen(section);
            setHealthItem(null);
            setMedItem(null);
            setFocusWanted({
              selector:
                field === 'sex'
                  ? `${sectionSel(section)} [role="radiogroup"][aria-label="Sex"] [role="radio"]`
                  : field === 'face'
                    ? `${sectionSel(section)} [aria-labelledby="${idPrefix}-face-label"] [role="radio"]`
                    : byId(`${idPrefix}-${field}`),
            });
          }}
          onReset={
            onReset
              ? () => {
                  onReset();
                  setHealthItem(null);
                  setMedItem(null);
                  setOpen('applicant');
                }
              : undefined
          }
        />
      </div>
    );
  }
);

/** A closed Health or Medications section: one line per item, each opening it. */
function ItemSummary({
  count,
  items,
  capitalize,
  onItem,
  onMore,
}: {
  count: number;
  items: Array<{
    key: string;
    complete: boolean;
    title: string;
    detail: string;
    attention?: string;
  }>;
  capitalize?: boolean;
  onItem: (key: string) => void;
  onMore: () => void;
}): JSX.Element {
  // What needs the agent first, so it is never the line cut off.
  const ordered = [...items].sort((a, b) => Number(a.complete) - Number(b.complete));
  const shown = ordered.slice(0, count > SUMMARY_LINES ? SUMMARY_LINES - 1 : SUMMARY_LINES);
  const hidden = count - shown.length;
  return (
    <div className="space-y-0.5">
      {shown.map(item => (
        <SummaryItem
          key={item.key}
          status={item.complete ? 'complete' : 'attention'}
          title={item.title}
          detail={item.detail}
          attention={item.attention}
          capitalize={capitalize}
          onClick={() => onItem(item.key)}
        />
      ))}
      {hidden > 0 ? (
        <button
          type="button"
          onClick={onMore}
          className={cn(
            'rounded-[4px] pl-5 text-[12.5px] font-medium text-brand-ink hover:underline',
            FOCUS
          )}
        >
          +{hidden} more
        </button>
      ) : null}
    </div>
  );
}

/**
 * The column's foot: what the quote is waiting on, and the one button.
 * Quotes also run on every edit, but an agent should never have to know
 * that: this is where they look for "go". With something required missing
 * it says what and opens the question; with details unanswered it quotes,
 * and says which answers the carriers are assuming.
 */
function IntakeFooter({
  draft,
  missing,
  attention,
  onFix,
  onFixMissing,
  onGetQuotes,
  onReset,
}: QuoteIntakeProps & {
  missing: string | null;
  attention: AttentionItem[];
  onFix: (item: AttentionItem) => void;
  onFixMissing: (field: string) => void;
}): JSX.Element {
  const [tried, setTried] = React.useState(false);
  React.useEffect(() => {
    if (!missing) setTried(false);
  }, [missing]);

  return (
    <div className="shrink-0 space-y-2 border-t border-rule pt-2.5 cq-lg:mr-1">
      {missing ? (
        <div className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
          <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-ringing" />
          {/* After a press of Get quotes, the same line is announced. */}
          <p role={tried ? 'alert' : undefined} className="min-w-0 truncate">
            <button
              type="button"
              onClick={() => onFixMissing(missing)}
              className={cn('rounded-[4px] font-semibold text-ringing-ink hover:underline', FOCUS)}
            >
              {MISSING_TEXT[missing] ?? 'Needs more answers'}
            </button>{' '}
            to quote.
          </p>
        </div>
      ) : attention.length ? (
        <div className="flex items-center gap-1.5 text-[12.5px] leading-[18px] text-ink-2">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-ringing-ink" aria-hidden />
          <p className="min-w-0 truncate">
            <span className="text-ink-2">Quoting on assumptions · </span>
            {attention.slice(0, 3).map((item, i) => (
              <React.Fragment key={`${item.section}-${item.itemKey}`}>
                {i ? ', ' : null}
                <button
                  type="button"
                  onClick={() => onFix(item)}
                  title={`${item.subject}: ${item.need}`}
                  className={cn(
                    'rounded-[4px] font-semibold text-ringing-ink underline-offset-2 hover:underline',
                    item.section === 'meds' && 'capitalize',
                    FOCUS
                  )}
                >
                  {shortLabel(item.subject)}
                </button>
              </React.Fragment>
            ))}
            {attention.length > 3 ? ` +${attention.length - 3} more` : null}
          </p>
        </div>
      ) : (
        <p className="flex items-center gap-1.5 text-[12.5px] text-live-ink" aria-live="polite">
          <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-live" />
          {draft.conditions.length || draft.meds.length
            ? 'Every answer in · quoting live'
            : 'Ready · quoting live as you edit'}
        </p>
      )}

      <div className="flex items-stretch gap-2">
        {onReset ? (
          <Button
            type="button"
            variant="outline"
            onClick={onReset}
            className="h-12 shrink-0 rounded-[10px] px-3 text-[13px] font-medium text-ink-2"
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            New quote
          </Button>
        ) : null}
        <Button
          type="button"
          onClick={() => {
            if (missing) {
              setTried(true);
              onFixMissing(missing);
              return;
            }
            onGetQuotes?.();
          }}
          className="h-12 min-w-0 flex-1 rounded-[10px] text-[15.5px] font-semibold tracking-[-0.005em] shadow-raised"
        >
          Get quotes
          {missing ? null : <ArrowRight className="ml-2 h-4 w-4" aria-hidden />}
        </Button>
      </div>
    </div>
  );
}
