'use client';

/**
 * The quoter's intake: who is being quoted, how much, and their health --
 * every answer on screen at once, and one place that says whether it can
 * quote.
 *
 * ── A workflow, not a settings panel ─────────────────────────────────────────
 *
 * Four blocks in the order an agent asks -- Applicant, Coverage, Health,
 * Medications -- and all of them open. Nothing is behind an accordion: an
 * agent on a call changes an answer where they see it. Each block's title
 * carries its state (a mark, and "1 to review" when something is open).
 *
 * ── Required work never appears out of sight ─────────────────────────────────
 *
 * A condition's questions open under that condition, opened into view, with
 * the cursor in the first. A medication's "what is it for?" is asked in the
 * medication's own row. And the readiness panel at the foot of the column
 * names every required field still missing, and every answer the carriers
 * are assuming; each one moves the cursor straight to its question.
 *
 * ── The column ends where its content does ───────────────────────────────────
 *
 * The panel is as tall as what it holds, with its readiness and actions
 * directly under the last block: no stretch of empty column between the
 * questions and Get quotes. When it holds more than the screen, the blocks
 * scroll and the actions stay put.
 *
 * Every edit re-quotes; the results follow as the agent types.
 */

import { AlertCircle, ArrowRight, CheckCircle2, RefreshCw, RotateCcw } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { missingFieldsForQuote, type DraftAction, type QuoteDraft } from '@/lib/fex/draft';
import {
  applicantDone,
  applicantUnasked,
  attentionItems,
  conditionComplete,
  coverageDone,
  medNeedsUse,
  MISSING_LABEL,
  sectionOfMissing,
  type AttentionItem,
  type IntakeSection as SectionKey,
} from '@/lib/fex/intake-status';
import { cn } from '@/lib/utils';

import { ApplicantEditor } from './intake/applicant-editor';
import { CoverageEditor, CoverageModeSwitch } from './intake/coverage-editor';
import { HealthManager, healthSearchId, type ConditionMeta } from './intake/health-manager';
import { MedicationManager, medsSearchId } from './intake/medication-manager';
import { IntakeBlock, type SectionStatus } from './intake/section';
import { FOCUS, shortLabel } from './parts';

export { healthSearchId, medsSearchId, type ConditionMeta };

/** Where the quote is, as the intake's footer says it. */
export type LiveState = 'idle' | 'updating' | 'live' | 'error';

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
  /** The live quote's state, once there are results. */
  live?: LiveState;
  /** When the results on screen were quoted (ISO). */
  quotedAt?: string | null;
}

/** What the workspace may ask of the intake from outside it (Alt+H, Alt+M, the snapshot). */
export interface QuoteIntakeHandle {
  /** Put the cursor in the condition (or medication) search. */
  focusSearch: (which: 'health' | 'meds') => void;
  /** Bring a block into view and put the cursor in its first field. */
  focusSection: (section: SectionKey) => void;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const QuoteIntake = React.forwardRef<QuoteIntakeHandle, QuoteIntakeProps>(
  function QuoteIntake(props, ref) {
    const { idPrefix, draft, dispatch, conditions, needsIndication, showAetnaMedSupp, onReset } =
      props;
    const byCode = React.useMemo(() => new Map(conditions.map(c => [c.code, c])), [conditions]);
    const conditionLabel = React.useCallback(
      (code: string) => byCode.get(code)?.label ?? code,
      [byCode]
    );
    const rootRef = React.useRef<HTMLDivElement>(null);

    const [healthItem, setHealthItem] = React.useState<string | null>(null);
    const [medItem, setMedItem] = React.useState<string | null>(null);
    /** Get quotes was pressed with something missing: mark the fields. */
    const [tried, setTried] = React.useState(false);

    const missing = missingFieldsForQuote(draft);
    React.useEffect(() => {
      if (!missing.length) setTried(false);
    }, [missing.length]);
    const invalid = React.useMemo(
      () => new Set(tried ? missing : []),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [tried, missing.join()]
    );

    /** Focus the first match inside the intake, scrolled into view. */
    const focusIn = React.useCallback((selector: string) => {
      requestAnimationFrame(() => {
        const target = rootRef.current?.querySelector<HTMLElement>(selector);
        target?.scrollIntoView?.({ block: 'nearest' });
        target?.focus();
      });
    }, []);

    const byId = (id: string) => `[id="${id}"]`;
    const sectionSel = (s: SectionKey) => byId(`${idPrefix}-sec-${s}`);
    const fieldSel = (field: string) =>
      field === 'sex'
        ? `${sectionSel('applicant')} [role="radiogroup"][aria-label="Sex"] [role="radio"]`
        : field === 'face'
          ? `${sectionSel('coverage')} [aria-labelledby="${idPrefix}-face-label"] [role="radio"][tabindex="0"]`
          : byId(`${idPrefix}-${field}`);

    React.useImperativeHandle(
      ref,
      () => ({
        focusSearch: which => {
          setHealthItem(null);
          setMedItem(null);
          focusIn(byId(which === 'meds' ? medsSearchId(idPrefix) : healthSearchId(idPrefix)));
        },
        focusSection: section =>
          focusIn(
            section === 'health'
              ? byId(healthSearchId(idPrefix))
              : section === 'meds'
                ? byId(medsSearchId(idPrefix))
                : `${sectionSel(section)} :is(input, select, [role="radio"][tabindex="0"]):not([disabled])`
          ),
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [idPrefix, focusIn]
    );

    const attention = attentionItems(draft, needsIndication, conditionLabel);

    // ── Block states ──────────────────────────────────────────────────────
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

    const fix = (item: AttentionItem) => {
      if (item.section === 'health') {
        setMedItem(null);
        setHealthItem(item.itemKey ?? null);
      } else if (item.section === 'meds') {
        setHealthItem(null);
        setMedItem(item.itemKey ?? null);
      } else {
        focusIn(
          `${sectionSel('applicant')} [role="radiogroup"][aria-label^="Tobacco"] [role="radio"][tabindex="0"]`
        );
      }
    };

    return (
      <div
        ref={rootRef}
        className="flex min-w-0 flex-col overflow-hidden rounded-[12px] border border-rule bg-surface shadow-card max-h-full min-h-0 shrink"
      >
        <div
          data-intake-body=""
          // No container queries in here: the column is a size container of its own
          // from the two-column width. Without a height to fill (narrow), these
          // do nothing.
          className="min-h-0 min-w-0 flex-1 divide-y divide-rule overflow-y-auto overflow-x-hidden overscroll-contain"
        >
          <IntakeBlock
            id={`${idPrefix}-sec-applicant`}
            title="Applicant"
            status={applicantStatus}
            meta={
              missing.some(m => sectionOfMissing(m) === 'applicant')
                ? 'Required to quote'
                : unasked.length
                  ? `Ask ${unasked.join(', ').toLowerCase()}`
                  : null
            }
            metaTone="attention"
          >
            <ApplicantEditor
              idPrefix={idPrefix}
              draft={draft}
              dispatch={dispatch}
              invalid={invalid}
            />
          </IntakeBlock>

          <IntakeBlock
            id={`${idPrefix}-sec-coverage`}
            title="Coverage"
            status={coverageStatus}
            action={<CoverageModeSwitch draft={draft} dispatch={dispatch} />}
          >
            <CoverageEditor
              idPrefix={idPrefix}
              draft={draft}
              dispatch={dispatch}
              showAetnaMedSupp={showAetnaMedSupp}
              invalid={invalid}
            />
          </IntakeBlock>

          <IntakeBlock
            id={`${idPrefix}-sec-health`}
            title="Health"
            status={healthStatus}
            meta={
              healthOpen
                ? `${healthOpen} to review`
                : draft.conditions.length
                  ? plural(draft.conditions.length, 'condition')
                  : null
            }
            metaTone={healthOpen ? 'attention' : 'quiet'}
          >
            <HealthManager
              idPrefix={idPrefix}
              draft={draft}
              dispatch={dispatch}
              conditions={conditions}
              item={healthItem}
              onItem={key => {
                setHealthItem(key);
                if (key) setMedItem(null);
              }}
            />
          </IntakeBlock>

          <IntakeBlock
            id={`${idPrefix}-sec-meds`}
            title="Medications"
            status={medsStatus}
            meta={
              medsOpen
                ? `${medsOpen} to review`
                : draft.meds.length
                  ? plural(draft.meds.length, 'medication')
                  : null
            }
            metaTone={medsOpen ? 'attention' : 'quiet'}
          >
            <MedicationManager
              idPrefix={idPrefix}
              draft={draft}
              dispatch={dispatch}
              needsIndication={needsIndication}
              conditionLabel={conditionLabel}
              item={medItem}
              onItem={key => {
                setMedItem(key);
                if (key) setHealthItem(null);
              }}
            />
          </IntakeBlock>
        </div>

        <QuoteReadiness
          missing={missing}
          attention={attention}
          tried={tried}
          live={props.live ?? 'idle'}
          quotedAt={props.quotedAt ?? null}
          onFixMissing={field => focusIn(fieldSel(field))}
          onFix={fix}
          onGetQuotes={() => {
            if (missing.length) {
              setTried(true);
              focusIn(fieldSel(missing[0]));
              return;
            }
            props.onGetQuotes?.();
          }}
          onReset={
            onReset
              ? () => {
                  onReset();
                  setTried(false);
                  setHealthItem(null);
                  setMedItem(null);
                  focusIn(byId(`${idPrefix}-state`));
                }
              : undefined
          }
        />
      </div>
    );
  }
);

const timeOf = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
      })
    : null;

/**
 * The column's foot: can it quote, and the one button.
 *
 *   2 items required    • State  • Face amount        (each moves the cursor)
 *   Quoting on assumptions   Tobacco · Diabetes       (each opens its question)
 *   Ready to quote      All required information entered
 *
 * Before the first quote the action is Get quotes. After it, every edit
 * re-quotes by itself, so the foot says so -- "Live quoting · updated
 * 11:42:03 AM", or "Updating quotes…" -- with Refresh as the quiet action.
 */
function QuoteReadiness({
  missing,
  attention,
  tried,
  live,
  quotedAt,
  onFixMissing,
  onFix,
  onGetQuotes,
  onReset,
}: {
  missing: string[];
  attention: AttentionItem[];
  tried: boolean;
  live: LiveState;
  quotedAt: string | null;
  onFixMissing: (field: string) => void;
  onFix: (item: AttentionItem) => void;
  onGetQuotes: () => void;
  onReset?: () => void;
}): JSX.Element {
  const quoting = live !== 'idle' && !missing.length;
  return (
    <div className="shrink-0 space-y-2 border-t border-rule bg-paper px-4 pb-3 pt-2.5">
      {missing.length ? (
        <div role={tried ? 'alert' : undefined}>
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
            <AlertCircle className="h-4 w-4 shrink-0 text-ringing-ink" aria-hidden />
            {missing.length === 1 ? '1 item required' : `${missing.length} items required`}
          </p>
          <ul className="mt-1 flex flex-wrap gap-x-1 gap-y-1 pl-[22px]">
            {missing.map(field => (
              <li key={field}>
                <button
                  type="button"
                  onClick={() => onFixMissing(field)}
                  className={cn(
                    'inline-flex h-6 items-center gap-1 rounded-full bg-ringing-tint px-2 text-[12px] font-semibold text-ringing-ink hover:underline',
                    FOCUS
                  )}
                >
                  {MISSING_LABEL[field] ?? field}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : attention.length ? (
        <div>
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
            <AlertCircle className="h-4 w-4 shrink-0 text-ringing-ink" aria-hidden />
            Quoting on assumptions
          </p>
          <ul className="mt-1 flex flex-wrap gap-x-1 gap-y-1 pl-[22px]">
            {attention.map(item => (
              <li key={`${item.section}-${item.itemKey ?? item.subject}`}>
                <button
                  type="button"
                  onClick={() => onFix(item)}
                  title={`${item.subject}: ${item.need}`}
                  className={cn(
                    'inline-flex h-6 items-center gap-1 rounded-full bg-ringing-tint px-2 text-[12px] font-semibold text-ringing-ink hover:underline',
                    FOCUS
                  )}
                >
                  <span className={cn(item.section === 'meds' && 'capitalize')}>
                    {shortLabel(item.subject)}
                  </span>
                  <span className="font-normal">· {item.need}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : quoting ? null : (
        <p className="flex items-center gap-1.5 text-[13px] leading-[18px]">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-live-ink" aria-hidden />
          <span className="font-semibold text-ink">Ready to quote</span>
          <span className="truncate text-[12px] text-ink-2">
            · all required information entered
          </span>
        </p>
      )}

      {quoting ? (
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 text-[12.5px] leading-4" aria-live="polite">
            {live === 'updating' ? (
              <span className="flex items-center gap-1.5 font-semibold text-ink">
                <RefreshCw className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden />
                Updating quotes…
              </span>
            ) : live === 'error' ? (
              <span className="font-semibold text-dropped-ink">Quotes could not refresh</span>
            ) : (
              <span className="flex items-center gap-1.5 font-semibold text-ink">
                <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-live" />
                Live quoting
              </span>
            )}
            {quotedAt && live !== 'updating' ? (
              <span className="block truncate pl-3.5 text-[11.5px] font-normal text-ink-3">
                Updated {timeOf(quotedAt)}
              </span>
            ) : null}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={onGetQuotes}
            className="h-9 shrink-0 px-3 text-[13px]"
          >
            Refresh quotes
          </Button>
          {onReset ? (
            <Button
              type="button"
              variant="ghost"
              onClick={onReset}
              className="h-9 shrink-0 px-2.5 text-[13px] font-medium text-ink-2"
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              New quote
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="flex items-stretch gap-2">
          {onReset ? (
            <Button
              type="button"
              variant="ghost"
              onClick={onReset}
              className="h-11 shrink-0 px-3 text-[13px] font-medium text-ink-2"
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              New quote
            </Button>
          ) : null}
          <Button
            type="button"
            onClick={onGetQuotes}
            className="h-11 min-w-0 flex-1 rounded-[10px] text-[15px] font-semibold shadow-raised"
          >
            Get quotes
            {missing.length ? null : <ArrowRight className="ml-2 h-4 w-4" aria-hidden />}
          </Button>
        </div>
      )}
    </div>
  );
}
