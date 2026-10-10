'use client';

/**
 * One carrier's answer -- a row in the results list, and the selected-quote
 * panel.
 *
 * ── A list, not a gallery ───────────────────────────────────────────────────
 *
 * Every carrier gets the same row, whatever its rank: the logo on one plate
 * size, the full product name (it wraps; it is never cut to "Final Expens…"),
 * the carrier under it, then fixed columns an agent scans down -- the
 * underwriting answer, the premium with the face under it, and Use Quote.
 * The recommendation is the same row with a tint, a green edge and a small
 * label; it is not two or three times taller than its neighbours.
 *
 * Underwriting is said on the row only when it changes the decision: a
 * referral, a medication whose use is not confirmed, the answer that set the
 * class ("COPD → Graded"), or what the last edit did ("was Level"). The
 * evidence in full -- every reason with its page, the rate source, the other
 * classes and the plan's limits -- is in the opened row.
 *
 * ── Layout ───────────────────────────────────────────────────────────────────
 *
 * Columns from the row's own width (a container query), so a list lines up
 * wherever it is: a full page, a drawer over a call, a console tab, History.
 *
 *   < 560px   name block | price               (Use Quote in the opened row)
 *   ≥ 560px   logo | name block | price | Use Quote   (underwriting under the name)
 *   ≥ 800px   logo | name block | underwriting | price | Use Quote
 *
 * `RESULT_COLUMNS` is exported so the list's sticky column headings use the
 * same grid as the rows under them.
 */

import type { QuoteLine, Reason } from '@hopwhistle/fex-engine/types';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Info,
  Save,
  Star,
  X,
} from 'lucide-react';
import * as React from 'react';

import { CarrierLogo } from '@/components/domain';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { MODE_SHORT, money, wholeDollars, type FexResult, type FexSelection } from '@/lib/fex/api';
import type { OutcomeChange } from '@/lib/fex/outcome-diff';
import { assumedAnswers } from '@/lib/fex/results-view';
import { cn } from '@/lib/utils';

import { benefitShort, benefitTone, benefitWord, FOCUS, outcomeTone } from './parts';

/**
 * The row's grid, shared with the list's column headings. Applies inside a
 * `cq` container (the row's `li`, or the heading's own wrapper).
 */
export const RESULT_COLUMNS = cn(
  'grid items-center gap-x-4',
  'grid-cols-[minmax(0,1fr)_auto]',
  'cq-sm:grid-cols-[104px_minmax(0,1fr)_112px]',
  '[@container(min-width:800px)]:grid-cols-[104px_minmax(0,1fr)_minmax(150px,190px)_112px]'
);

export interface ResultRowProps {
  result: FexResult;
  expanded: boolean;
  onToggle: () => void;
  /** Absent in read-only views (history). */
  onUse?: (result: FexResult, line: QuoteLine) => void;
  onCopy?: (result: FexResult) => void;
  onSave?: (result: FexResult) => void;
  /** The line being saved right now, to disable its button. */
  busy?: boolean;
  isStaff?: boolean;
  /** Tagged "Price only" (health questions not loaded). */
  priceOnly?: boolean;
  /** This row is the quote in use. */
  selected?: boolean;
  /** The strongest answer on the list: a tint, a green edge, the label above the name. */
  recommended?: boolean;
  /**
   * What the row is, said above its name ("Best price", "Best level"), only
   * when the figures bear it out.
   */
  labels?: string[];
  /** In the comparison; absent where there is no comparing (history). */
  compared?: boolean;
  onCompareToggle?: () => void;
  /** The comparison is full and this row is not in it. */
  compareFull?: boolean;
  /** Something is being compared: every row shows its compare box. */
  comparing?: boolean;
  /** This carrier's answer moved with the last edit. */
  change?: OutcomeChange;
  /**
   * What the applicant told us, when it can only be one thing (a single
   * condition and no medication): the name a health answer is reported
   * under ("COPD → Graded"). Otherwise the row says "Health answer".
   */
  healthSubject?: string | null;
}

function feeText(fee: NonNullable<FexResult['facts']>['policyFeeAnnual']): string {
  if (fee == null) return 'Not published';
  if (typeof fee === 'number') return `${money(fee)} a year`;
  return fee
    .map(band => {
      const range =
        band.face_lt != null
          ? `under ${wholeDollars(band.face_lt)}`
          : band.face_gte != null
            ? `${wholeDollars(band.face_gte)}+`
            : 'all faces';
      return `${money(band.fee_annual)} (${range})`;
    })
    .join(' · ');
}

const TAG_TONE = {
  live: 'bg-live-tint text-live-ink',
  ringing: 'bg-ringing-tint text-ringing-ink',
  dropped: 'bg-dropped-tint text-dropped-ink',
  blocked: 'bg-blocked-tint text-blocked-ink',
  money: 'bg-money-tint text-money-ink',
  neutral: 'bg-sunken text-ink-2',
} as const;

/** The one kind of badge on a row: a benefit, or a decline. Small, tinted, no border. */
export function Tag({
  tone,
  title,
  children,
}: {
  tone: keyof typeof TAG_TONE;
  title?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-[18px] shrink-0 items-center rounded-[4px] px-1.5 text-[10.5px] font-semibold uppercase leading-none tracking-[0.05em]',
        TAG_TONE[tone]
      )}
    >
      {children}
    </span>
  );
}

/**
 * The benefit as one small badge -- LEVEL, GRADED, MODIFIED, ROP, GI -- with
 * the carrier's class name after it, as plain text, when that says something
 * more ("LEVEL  Preferred"). Green is Level and nothing else. A carrier that
 * does not say what the benefit is gets its class name and no badge.
 */
export function BenefitBadge({
  line,
  className,
  wrap = false,
}: {
  line: QuoteLine;
  className?: string;
  /** Let the class name wrap under the badge instead of truncating (the underwriting column). */
  wrap?: boolean;
}): JSX.Element {
  const word = benefitShort(line.benefit);
  const long = benefitWord(line.benefit);
  const extra =
    long && line.classLabel.toLowerCase().includes(long.toLowerCase()) ? null : line.classLabel;
  return (
    <span
      className={cn(
        'inline-flex min-w-0 gap-x-2 gap-y-0.5',
        wrap ? 'flex-wrap items-baseline' : 'items-center',
        className
      )}
    >
      {word ? (
        <Tag tone={benefitTone(line.benefit)} title={long !== word ? long : undefined}>
          {word}
        </Tag>
      ) : null}
      {extra ? (
        <span
          className={cn('min-w-0 text-[12.5px] leading-[18px] text-ink-2', !wrap && 'truncate')}
          title={line.classLabel}
        >
          {extra}
        </span>
      ) : null}
    </span>
  );
}

/**
 * How current the carrier's rate book is, said the same way on every row:
 *
 *   ● Current       the rate book is the carrier's current one
 *   ▲ Verify rate   older than current: check before submitting
 *   ● Stale         known to be out of date
 *
 * The detail (the rate source and its date) is in the tooltip and the opened row.
 */
export function RateStatus({ result }: { result: FexResult }): JSX.Element | null {
  const facts = result.facts;
  if (!facts) return null;
  const tone = facts.ratesStatus.tone;
  const detail = facts.sourceDate
    ? `${facts.ratesStatus.label}. Carrier rate source dated ${facts.sourceDate}.`
    : `${facts.ratesStatus.label}.`;
  if (tone === 'warn' || tone === 'mod') {
    return (
      <Tooltip
        content={`${detail} Verify before submitting.`}
        side="top"
        align="end"
        className="relative z-[1] mt-1"
      >
        <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-semibold leading-4 text-ringing-ink">
          <AlertTriangle className="h-3 w-3" aria-hidden />
          Verify rate
          <span className="sr-only">: {detail} Verify before submitting.</span>
        </span>
      </Tooltip>
    );
  }
  const stale = tone === 'bad';
  return (
    <Tooltip content={detail} side="top" align="end" className="relative z-[1] mt-1">
      <span
        className={cn(
          'inline-flex items-center gap-1 whitespace-nowrap text-[11px] leading-4',
          stale ? 'font-semibold text-dropped-ink' : 'text-ink-3'
        )}
      >
        <span
          aria-hidden
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            stale ? 'bg-dropped' : tone === 'good' ? 'bg-live' : 'bg-ink-3'
          )}
        />
        {stale ? 'Stale rates' : tone === 'good' ? 'Current' : facts.ratesStatus.label}
        <span className="sr-only">: {detail}</span>
      </span>
    </Tooltip>
  );
}

/** Kept for callers of the old name. */
export const RateVerify = RateStatus;

/**
 * The premium and what it buys. Two shapes, each said as what it is: a modal
 * premium ("$71.64 /mo") and a single premium paid once. Never an annual
 * figure: a carrier with no published monthly factor is priced on an
 * estimated one by the server, and a mode the carrier cannot price is a dash.
 */
const PRICE_SIZE = {
  16: 'text-[16px]',
  17: 'text-[17px]',
  18: 'text-[18px]',
  20: 'text-[20px]',
  26: 'text-[26px]',
} as const;

export function Price({
  line,
  size = 17,
  align = 'end',
}: {
  line: QuoteLine;
  /** Which edge the figure and the face under it share. */
  align?: 'start' | 'end';
  size?: 16 | 17 | 18 | 20 | 26;
}): JSX.Element {
  const single = line.basis === 'SINGLE_PREMIUM_PER_1000';
  const amount = line.premium;
  const unit = single ? 'single' : `/${MODE_SHORT[line.mode]}`;
  const figure = PRICE_SIZE[size];
  const big = size >= 20;
  return (
    <span
      className={cn(
        'flex flex-col',
        align === 'start' ? 'items-start text-left' : 'items-end text-right'
      )}
    >
      <span className="inline-flex items-baseline whitespace-nowrap leading-none tabular-nums">
        {amount == null ? (
          <span className={cn(figure, 'font-semibold text-ink-3')}>—</span>
        ) : (
          <>
            <span
              className={cn(
                figure,
                big ? 'font-bold tracking-[-0.02em]' : 'font-bold tracking-[-0.01em]',
                'text-ink'
              )}
            >
              {money(amount)}
            </span>
            <span
              className={cn('ml-0.5 font-normal text-ink-3', big ? 'text-[13px]' : 'text-[11.5px]')}
            >
              {unit}
            </span>
          </>
        )}
        {line.premiumNote ? (
          <Tooltip content={line.premiumNote} side="top" align="end" className="relative z-[1]">
            <Info className="ml-1 h-3 w-3 self-center text-ink-3" aria-label={line.premiumNote} />
          </Tooltip>
        ) : null}
      </span>
      <span
        className={cn(
          'mt-1 inline-flex items-center gap-1 whitespace-nowrap font-medium leading-4 tabular-nums text-ink-2',
          big ? 'text-[12.5px]' : 'text-[12px]'
        )}
      >
        {line.faceAdjusted ? (
          <Tooltip content={line.faceAdjusted} side="top" align="end" className="relative z-[1]">
            <Info className="h-3 w-3 text-ringing-ink" aria-label={line.faceAdjusted} />
          </Tooltip>
        ) : null}
        {wholeDollars(line.face)}
      </span>
    </span>
  );
}

// ─── What the row says about underwriting ────────────────────────────────────

export interface Note {
  text: string;
  tone: 'quiet' | 'warn';
}

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * The reason that set the class: the first one whose outcome is the class the
 * best line was decided at, else the first that is not a decline (an
 * eligible carrier may decline one of its other classes).
 */
function decisiveReason(result: FexResult): Reason | null {
  const reasons = result.reasons.filter(r => r.outcome !== 'DECLINE');
  if (!reasons.length) return null;
  const decided = result.best?.uwClass ?? result.outcome;
  return reasons.find(r => r.outcome === decided) ?? reasons[0];
}

/** The rule that declined the carrier, with its source, when the engine named one. */
export function declineReason(result: FexResult): Reason | null {
  return result.reasons.find(r => r.outcome === 'DECLINE') ?? null;
}

/**
 * What a reason was about, in a word or two. Only what the engine's own
 * fields say: an Rx reason names its drug first ("Gabapentin — ..."), a build
 * reason is the build. An application question is the applicant's condition
 * only when there is exactly one thing it could be.
 */
function reasonSubject(
  reason: Reason,
  result: FexResult,
  healthSubject: string | null | undefined
): string {
  switch (reason.kind) {
    case 'rx': {
      const name = reason.text.split(' — ')[0]?.trim();
      return name && name.length <= 32 ? name : 'Medication';
    }
    case 'build':
      return 'Build';
    case 'age':
      return 'Age';
    default: {
      if (healthSubject) return healthSubject;
      const answers = result.reasons.filter(r => r.kind === 'rule' || r.kind === 'combo').length;
      return answers > 1 ? `${answers} health answers` : 'Health answer';
    }
  }
}

/**
 * The one thing about underwriting worth a closed row's space, or nothing.
 * What the agent can act on before applying comes first: a referral, an
 * unconfirmed medication, a health answer the carrier assumed.
 */
export function materialNote(
  result: FexResult,
  healthSubject: string | null | undefined
): Note | null {
  if (!result.eligible) return null; // a decline says its own reason
  if (result.refer) return { text: 'Referral required', tone: 'warn' };
  if (result.needsIndication.length) {
    const [first, ...rest] = result.needsIndication;
    return {
      text: `${capitalize(first.name)} use unconfirmed${rest.length ? ` +${rest.length}` : ''}`,
      tone: 'warn',
    };
  }
  const assumed = assumedAnswers(result);
  if (assumed.length) {
    const n = assumed.length;
    return {
      text: `${n} health answer${n === 1 ? '' : 's'} assumed`,
      tone: 'warn',
    };
  }
  const reason = decisiveReason(result);
  if (!reason) return null;
  if (reason.kind === 'state' || reason.kind === 'routing')
    return { text: reason.text, tone: 'quiet' };
  const to = benefitWord(result.best?.benefit) || result.best?.classLabel || result.outcomeLabel;
  return { text: `${reasonSubject(reason, result, healthSubject)} → ${to}`, tone: 'quiet' };
}

// ─── The row ─────────────────────────────────────────────────────────────────

export function ResultRow({
  result,
  expanded,
  onToggle,
  onUse,
  onCopy,
  onSave,
  busy = false,
  isStaff = false,
  priceOnly = false,
  selected = false,
  recommended = false,
  labels = [],
  compared = false,
  onCompareToggle,
  compareFull = false,
  comparing = false,
  change,
  healthSubject,
}: ResultRowProps): JSX.Element {
  const best = result.best;
  const declined = !result.eligible;
  const detailId = `fex-detail-${result.productId}`;
  const note = declined ? null : materialNote(result, healthSubject);
  const canCompare = Boolean(onCompareToggle) && !declined && Boolean(best);
  // Room for the compare box is kept on every row of a list that compares,
  // so the logos stay in one column.
  const compareSlot = Boolean(onCompareToggle);
  const recommend = recommended && !declined;
  const decline = declined ? declineReason(result) : null;

  /** The underwriting answer: the benefit, then the one note, then what moved. */
  const underwriting = declined ? (
    <span className="flex min-w-0 flex-col items-start gap-1">
      <Tag tone={result.outcome === 'DECLINE' ? 'dropped' : 'neutral'}>
        {result.outcome === 'DECLINE' ? 'Declined' : 'Not available'}
      </Tag>
    </span>
  ) : best ? (
    <span className="flex min-w-0 flex-col items-start gap-1">
      <BenefitBadge line={best} wrap className="max-w-full" />
      <StatusNote note={note} priceOnly={priceOnly} change={change} stacked />
    </span>
  ) : null;

  /** The same, on one line beside the carrier (narrow rows). */
  const underwritingInline = declined ? (
    <Tag tone={result.outcome === 'DECLINE' ? 'dropped' : 'neutral'}>
      {result.outcome === 'DECLINE' ? 'Declined' : 'Not available'}
    </Tag>
  ) : best ? (
    <>
      <BenefitBadge line={best} className="max-w-full" />
      <StatusNote note={note} priceOnly={priceOnly} change={change} />
    </>
  ) : null;

  return (
    <li
      className={cn(
        'cq group/row relative border-b border-rule last:border-0',
        recommend && !selected && 'bg-[color-mix(in_srgb,var(--live-tint)_55%,var(--surface))]',
        selected && 'bg-brand-tint',
        // The recommendation: a 3px green edge and its label, nothing louder.
        recommend && 'shadow-[inset_3px_0_0_var(--live)]',
        selected && !recommend && 'shadow-[inset_3px_0_0_var(--brand-strong)]'
      )}
      data-product={result.productId}
      data-selected={selected ? '' : undefined}
      data-recommended={recommend ? '' : undefined}
    >
      <div
        className={cn(
          'relative flex items-center transition-colors duration-150 ne-motion',
          !selected && !recommend && 'hover:bg-[#f8f9fb]',
          compareSlot ? 'pl-3' : 'pl-4',
          'pr-2'
        )}
      >
        {compareSlot ? (
          <span className="relative z-[1] mr-3 flex w-5 shrink-0 items-center justify-center">
            {canCompare ? (
              <input
                type="checkbox"
                checked={compared}
                disabled={compareFull && !compared}
                onChange={onCompareToggle}
                aria-label={`Add ${result.family} ${result.product} to comparison`}
                title={compareFull && !compared ? 'Compare up to 4' : 'Add to comparison (C)'}
                className={cn(
                  'h-4 w-4 cursor-pointer accent-[var(--brand-strong)] transition-opacity duration-150 ne-motion disabled:cursor-not-allowed',
                  compared || comparing
                    ? 'opacity-100'
                    : 'opacity-40 focus-visible:opacity-100 group-hover/row:opacity-100 [@media(hover:none)]:opacity-100',
                  FOCUS
                )}
              />
            ) : null}
          </span>
        ) : null}

        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={detailId}
          onClick={onToggle}
          data-row-toggle=""
          className={cn(
            // The toggle's hit area covers the whole row (the chevron and the
            // gaps included); the compare box and Use Quote sit above it.
            RESULT_COLUMNS,
            'min-h-[64px] min-w-0 flex-1 cursor-pointer py-2 text-left',
            "after:absolute after:inset-0 after:content-['']",
            'focus-visible:outline-none focus-visible:after:shadow-[inset_0_0_0_2px_var(--brand-ink)]'
          )}
        >
          <CarrierLogo
            names={[result.family, result.productId]}
            size="quoteList"
            className={cn('hidden cq-sm:inline-flex', declined && 'opacity-50 grayscale')}
          />

          <span className="min-w-0">
            {recommend || labels.length ? (
              <span className="mb-0.5 flex flex-wrap items-center gap-x-1.5 text-[10.5px] font-bold uppercase leading-[14px] tracking-[0.07em] text-live-ink">
                {recommend ? (
                  <span className="inline-flex items-center gap-1">
                    <Star className="h-2.5 w-2.5 fill-current" aria-hidden />
                    Recommended
                  </span>
                ) : null}
                {labels.map((label, i) => (
                  <React.Fragment key={label}>
                    {recommend || i ? (
                      <span aria-hidden className="text-ink-3">
                        ·
                      </span>
                    ) : null}
                    <span className={recommend ? undefined : 'text-ink-2'}>{label}</span>
                  </React.Fragment>
                ))}
              </span>
            ) : null}
            {/* The product's name in full: it wraps rather than truncates. */}
            <span
              className={cn(
                'block break-words text-[14.5px] font-semibold leading-5 tracking-[-0.005em]',
                declined ? 'text-ink-2' : 'text-ink'
              )}
            >
              {result.product}
            </span>
            <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] leading-[18px] text-ink-2">
              <span>
                {result.family}
                {!result.appointed ? <span className="text-ink-3"> · Not appointed</span> : null}
              </span>
              {/* Below 800px the underwriting column folds in beside the carrier. */}
              <span className="contents [@container(min-width:800px)]:hidden">
                {underwritingInline}
              </span>
            </span>
            {declined && (result.ineligibleReason || decline) ? (
              <DeclineEvidence result={result} reason={decline} />
            ) : null}
          </span>

          <span className="hidden min-w-0 [@container(min-width:800px)]:block">{underwriting}</span>

          {!declined && best ? (
            <span className="flex flex-col items-end self-center">
              <Price line={best} />
              <RateStatus result={result} />
            </span>
          ) : (
            <span aria-hidden className="text-right text-[13px] text-ink-3">
              —
            </span>
          )}
          <span className="sr-only">{expanded ? 'Hide details' : 'Show details'}</span>
        </button>

        {onUse ? (
          <div className="relative z-[1] ml-3 hidden w-[92px] shrink-0 cq-sm:block">
            {!declined && best ? (
              <Button
                size="sm"
                disabled={busy}
                variant={recommend && !selected ? 'default' : 'outline'}
                onClick={() => onUse(result, best)}
                className={cn(
                  'h-8 w-full px-2 text-[13px] font-semibold',
                  selected
                    ? 'border-live text-live-ink shadow-none hover:bg-live-tint hover:text-live-ink'
                    : !recommend &&
                        'border-rule-strong bg-surface text-brand-ink shadow-none hover:border-brand-ink hover:bg-brand-tint hover:text-brand-ink'
                )}
              >
                {busy ? (
                  'Saving…'
                ) : selected ? (
                  <>
                    <Check className="mr-1 h-3.5 w-3.5" aria-hidden />
                    Selected
                  </>
                ) : (
                  'Use Quote'
                )}
              </Button>
            ) : null}
          </div>
        ) : null}
        <ChevronDown
          aria-hidden
          className={cn(
            'ml-2 h-4 w-4 shrink-0 text-ink-3 transition-transform duration-150 ne-motion motion-reduce:transition-none',
            expanded && 'rotate-180'
          )}
        />
      </div>

      {expanded ? (
        <ResultDetail
          id={detailId}
          result={result}
          onUse={onUse}
          onCopy={onCopy}
          onSave={onSave}
          busy={busy}
          isStaff={isStaff}
          selected={selected}
          compared={compared}
          onCompareToggle={canCompare ? onCompareToggle : undefined}
          compareFull={compareFull}
          indent={compareSlot ? 'compare' : 'plain'}
        />
      ) : null}
    </li>
  );
}

/**
 * Why a carrier declined, on its closed row: the carrier's reason, and the
 * rule's own text and page when the engine cited one.
 */
function DeclineEvidence({
  result,
  reason,
}: {
  result: FexResult;
  reason: Reason | null;
}): JSX.Element {
  const main = result.ineligibleReason ?? reason?.text ?? '';
  return (
    <span className="mt-1 block text-[12.5px] leading-[18px] text-ink">
      {main}
      {reason && reason.text !== main ? (
        <span className="block text-ink-2">{reason.text}</span>
      ) : null}
      {reason?.page != null ? (
        <span className="text-ink-3">
          {' '}
          ·{' '}
          {reason.src === 'application'
            ? 'Application'
            : reason.src === 'guide'
              ? 'Agent guide'
              : 'Source'}{' '}
          p. {reason.page}
        </span>
      ) : null}
    </span>
  );
}

const signed = (n: number, format: (v: number) => string) =>
  `${n > 0 ? '+' : n < 0 ? '−' : '±'}${format(Math.abs(n))}`;

/**
 * What the last edit did to a carrier, said both ways the screen needs it:
 * `from` → `to` with the delta (the change strip), and a short note for the
 * row ("↓ was Level", "↑ +$7.85, was $138.17").
 */
export function changeParts(change: OutcomeChange): { from: string; to: string; delta?: string } {
  const { premiumFrom: pf, premiumTo: pt, faceFrom: ff, faceTo: ft } = change;
  if (change.kind === 'premium' && pf != null && pt != null) {
    return { from: money(pf), to: money(pt), delta: signed(pt - pf, money) };
  }
  if (change.kind === 'face' && ff != null && ft != null) {
    return {
      from: `${wholeDollars(ff)} face`,
      to: `${wholeDollars(ft)} face`,
      delta: signed(ft - ff, wholeDollars),
    };
  }
  return { from: change.from, to: change.to === 'Declined' ? 'No longer qualifies' : change.to };
}

export function changeNote(change: OutcomeChange): string {
  const arrow = change.direction === 'worse' ? '↓' : change.direction === 'better' ? '↑' : '↔';
  const parts = changeParts(change);
  if (change.kind === 'premium') return `${arrow} ${parts.delta}, was ${parts.from}`;
  if (change.kind === 'face') return `${arrow} ${parts.delta} face`;
  return `${arrow} was ${change.from}`;
}

/**
 * The one underwriting fact worth the space, then "Price only" and what the
 * last edit changed. Nothing when there is nothing to say.
 */
export function StatusNote({
  note,
  priceOnly,
  change,
  separator = false,
  stacked = false,
}: {
  note: Note | null;
  priceOnly: boolean;
  change?: OutcomeChange;
  /** A "·" before it, when it follows the benefit on the same line. */
  separator?: boolean;
  /** One fact per line (the underwriting column), rather than one line. */
  stacked?: boolean;
}): JSX.Element | null {
  if (!note && !priceOnly && !change) return null;
  return (
    <span
      className={cn(
        'flex min-w-0 max-w-full text-[12px] leading-4',
        stacked ? 'flex-col items-start gap-0.5' : 'items-center gap-2'
      )}
    >
      {separator ? (
        <span aria-hidden className="text-ink-3">
          ·
        </span>
      ) : null}
      {note ? (
        <span
          className={cn(
            'inline-flex min-w-0 items-start gap-1',
            note.tone === 'warn' ? 'font-medium text-ringing-ink' : 'text-ink-2'
          )}
        >
          {note.tone === 'warn' ? (
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          ) : null}
          <span className="min-w-0 break-words">{note.text}</span>
        </span>
      ) : null}
      {priceOnly ? <span className="shrink-0 text-ink-3">Price only</span> : null}
      {change ? (
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-semibold',
            change.direction === 'worse'
              ? 'text-dropped-ink'
              : change.direction === 'better'
                ? 'text-live-ink'
                : 'text-ink-2'
          )}
        >
          {changeNote(change)}
        </span>
      ) : null}
    </span>
  );
}

// ─── The opened row ──────────────────────────────────────────────────────────

const SOURCE_NAME: Record<string, string> = {
  application: 'Application',
  guide: 'Agent guide',
};

/**
 * Where the reasons come from: each distinct document reference and page the
 * engine cited. Only what a reason carries -- nothing is added to fill space.
 */
function sourcesOf(result: FexResult) {
  const seen = new Set<string>();
  const sources: Array<{
    name: string;
    ref: string | null;
    page: string | null;
    url: string | null;
  }> = [];
  for (const reason of result.reasons) {
    if (reason.page == null && !reason.ref) continue;
    const name = reason.src ? (SOURCE_NAME[reason.src] ?? reason.src) : 'Carrier document';
    const page = reason.page == null ? null : String(reason.page);
    const key = `${name}|${reason.ref ?? ''}|${page ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({ name, ref: reason.ref ?? null, page, url: reason.url ?? null });
  }
  return sources;
}

function DetailHeading({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <h4 className="mb-2 text-[10.5px] font-semibold uppercase leading-4 tracking-[0.08em] text-ink-3">
      {children}
    </h4>
  );
}

const OUTCOME_INK = {
  live: 'text-live-ink',
  ringing: 'text-ringing-ink',
  dropped: 'text-dropped-ink',
  blocked: 'text-blocked-ink',
  money: 'text-money-ink',
  neutral: 'text-ink-2',
} as const;

export function ResultDetail({
  id,
  result,
  onUse,
  onCopy,
  onSave,
  busy,
  isStaff,
  selected,
  compared,
  onCompareToggle,
  compareFull,
  indent,
}: {
  id: string;
  result: FexResult;
  onUse?: ResultRowProps['onUse'];
  onCopy?: ResultRowProps['onCopy'];
  onSave?: ResultRowProps['onSave'];
  busy: boolean;
  isStaff: boolean;
  selected: boolean;
  compared: boolean;
  onCompareToggle?: () => void;
  compareFull: boolean;
  /** Line the detail up under the name: past the compare box, or not. */
  indent: 'compare' | 'plain' | 'none';
}): JSX.Element {
  const facts = result.facts;
  const best = result.best;
  const sources = sourcesOf(result);
  const rateWarn = facts?.ratesStatus.tone === 'warn' || facts?.ratesStatus.tone === 'mod';
  const hasActions =
    Boolean(best) && result.eligible && (onUse || onCopy || onSave || onCompareToggle);

  return (
    <div
      id={id}
      className={cn(
        'border-t border-rule bg-[#f9fafb] px-4 pb-5 pt-4 animate-in fade-in-0 duration-150 motion-reduce:animate-none',
        indent === 'compare'
          ? 'cq-md:pl-[164px]'
          : indent === 'plain'
            ? 'cq-md:pl-[136px]'
            : 'rounded-b-[inherit] cq-md:px-5'
      )}
    >
      {hasActions && best ? (
        <div className="-ml-2 mb-4 flex flex-wrap items-center gap-1">
          {onUse ? (
            // The row's own Use Quote is hidden below 560px; here it is always.
            <Button
              size="sm"
              disabled={busy}
              variant={selected ? 'outline' : 'default'}
              onClick={() => onUse(result, best)}
              className="ml-2 mr-1 h-8 cq-sm:hidden"
            >
              {selected ? 'Selected' : 'Use Quote'}
            </Button>
          ) : null}
          {onCopy ? (
            <DetailAction icon={Copy} onClick={() => onCopy(result)}>
              Copy summary
            </DetailAction>
          ) : null}
          {onSave ? (
            <DetailAction icon={Save} onClick={() => onSave(result)}>
              Save quote
            </DetailAction>
          ) : null}
          {onCompareToggle ? (
            <label
              className={cn(
                'inline-flex h-8 cursor-pointer items-center gap-2 rounded-control px-2 text-[12.5px] font-medium text-ink-2 hover:bg-sunken hover:text-ink',
                compareFull && !compared && 'cursor-not-allowed opacity-50'
              )}
            >
              <input
                type="checkbox"
                checked={compared}
                disabled={compareFull && !compared}
                onChange={onCompareToggle}
                className={cn('h-3.5 w-3.5 cursor-pointer accent-[var(--brand-strong)]', FOCUS)}
              />
              {compareFull && !compared ? 'Compare (4 max)' : 'Compare'}
            </label>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-x-10 gap-y-6 cq-md:grid-cols-2 cq-xl:grid-cols-3">
        <section
          aria-label={result.eligible ? 'Why this qualifies' : 'Why it was declined'}
          className="min-w-0"
        >
          <DetailHeading>
            {result.eligible ? 'Why this qualifies' : 'Why it was declined'}
          </DetailHeading>
          {!result.uwLoaded ? (
            <p className="mb-2 text-[13px] leading-5 text-ink-2">
              This carrier&apos;s health questions are not loaded yet; the best class is shown for
              price only.
            </p>
          ) : null}
          {result.reasons.length ? (
            <ol className="space-y-2">
              {result.reasons.map((reason, i) => {
                const tone = outcomeTone(reason.outcome);
                return (
                  <li key={i} className="flex items-start gap-2 text-[13px] leading-5 text-ink">
                    <span
                      aria-hidden
                      className={cn(
                        'mt-[3px] flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-surface',
                        reason.outcome === 'DECLINE'
                          ? 'bg-dropped'
                          : tone === 'ringing'
                            ? 'bg-ringing'
                            : 'bg-live'
                      )}
                    >
                      {reason.outcome === 'DECLINE' ? (
                        <X className="h-2.5 w-2.5" strokeWidth={3} />
                      ) : (
                        <Check className="h-2.5 w-2.5" strokeWidth={3} />
                      )}
                    </span>
                    <span className="min-w-0">
                      {reason.text}
                      <span className="ml-1.5 inline-flex flex-wrap items-baseline gap-1.5 whitespace-nowrap align-baseline">
                        <span
                          className={cn(
                            'text-[10.5px] font-semibold uppercase tracking-[0.06em]',
                            OUTCOME_INK[tone]
                          )}
                        >
                          {reason.outcome === 'DECLINE'
                            ? 'Decline'
                            : reason.outcome === 'REFER'
                              ? 'Refer'
                              : reason.outcome.replace(/_/g, ' ')}
                        </span>
                        {reason.page != null ? (
                          reason.url ? (
                            <a
                              href={reason.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={cn(
                                'inline-flex items-center gap-0.5 text-[12px] text-brand-ink hover:underline',
                                FOCUS
                              )}
                            >
                              p. {reason.page}
                              <ExternalLink className="h-3 w-3" aria-hidden />
                              <span className="sr-only"> (opens the carrier document)</span>
                            </a>
                          ) : (
                            <span className="text-[12px] text-ink-3">p. {reason.page}</span>
                          )
                        ) : null}
                      </span>
                      {isStaff && reason.note ? (
                        <span className="mt-0.5 block text-[12px] text-ink-3">
                          Source note: {reason.note}
                        </span>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ol>
          ) : result.eligible && result.uwLoaded ? (
            <p className="flex items-start gap-2 text-[13px] leading-5 text-ink-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-live-ink" aria-hidden />
              No health question, guide rule, medication or build limit triggered — best class.
            </p>
          ) : null}
          {result.assumptions.length ? (
            <div className="mt-3">
              <h5 className="mb-1 text-[12px] font-medium text-ink-2">Assumed</h5>
              <ul className="list-disc space-y-0.5 pl-4 text-[12.5px] leading-5 text-ink-2">
                {result.assumptions.map(a => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {sources.length ? (
            <div className="mt-4">
              <DetailHeading>Underwriting sources</DetailHeading>
              <ul className="space-y-1 text-[12.5px] leading-5">
                {sources.map(source => (
                  <li
                    key={`${source.name}-${source.ref}-${source.page}`}
                    className="flex items-baseline gap-2"
                  >
                    <span className="text-ink">
                      {source.name}
                      {source.ref ? <span className="text-ink-2"> · {source.ref}</span> : null}
                    </span>
                    {source.page ? (
                      source.url ? (
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={cn('tabular-nums text-brand-ink hover:underline', FOCUS)}
                        >
                          Page {source.page}
                        </a>
                      ) : (
                        <span className="tabular-nums text-ink-3">Page {source.page}</span>
                      )
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <section aria-label="Pricing" className="min-w-0">
          <DetailHeading>Pricing</DetailHeading>
          {best ? (
            <dl className="grid gap-y-1.5 text-[12.5px] leading-5">
              <Fact label="Premium">
                <span className="font-semibold tabular-nums">
                  {best.premium != null ? money(best.premium) : '—'}
                </span>
                <span className="text-ink-2"> {best.modeLabel.toLowerCase()}</span>
                {best.premiumNote ? (
                  <span className="block text-[12px] text-ink-3">{best.premiumNote}</span>
                ) : null}
              </Fact>
              <Fact label="Face">
                <span className="tabular-nums">{wholeDollars(best.face)}</span>
                {best.faceAdjusted ? (
                  <span className="block text-[12px] text-ringing-ink">{best.faceAdjusted}</span>
                ) : null}
              </Fact>
              {facts ? (
                <Fact label="Rate source">
                  <span className={cn(rateWarn ? 'font-medium text-ringing-ink' : 'text-ink')}>
                    {facts.ratesStatus.label}
                  </span>
                  {facts.sourceDate ? (
                    <span className="tabular-nums text-ink-3"> · {facts.sourceDate}</span>
                  ) : null}
                </Fact>
              ) : null}
            </dl>
          ) : (
            <p className="text-[13px] text-ink-2">Not priced for this applicant.</p>
          )}

          <div className="mt-4">
            <DetailHeading>Other classes</DetailHeading>
            {result.others.length ? (
              <table className="w-full text-[12.5px]">
                <thead className="sr-only">
                  <tr>
                    <th>Class</th>
                    <th>Face</th>
                    <th>Premium</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {result.others.map(line => (
                    <tr
                      key={`${line.classCode}-${line.payPeriod ?? ''}`}
                      className="border-b border-rule last:border-0"
                    >
                      <td className="max-w-0 py-1.5 pr-2">
                        <BenefitBadge line={line} className="max-w-full" />
                      </td>
                      <td className="whitespace-nowrap py-1.5 pr-3 text-right tabular-nums text-ink-2">
                        {wholeDollars(line.face)}
                      </td>
                      <td className="whitespace-nowrap py-1.5 pr-2 text-right font-semibold tabular-nums text-ink">
                        {line.premium == null ? '—' : money(line.premium)}
                        <span className="text-[11px] font-normal text-ink-3">
                          /{MODE_SHORT[line.mode]}
                        </span>
                      </td>
                      <td className="w-px py-1.5 text-right">
                        {onUse ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2.5 text-[12px] text-brand-ink shadow-none hover:bg-brand-tint hover:text-brand-ink"
                            disabled={busy}
                            onClick={() => onUse(result, line)}
                          >
                            Use
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-[12.5px] text-ink-2">No other class for this applicant.</p>
            )}
          </div>
        </section>

        <section aria-label="Plan facts" className="min-w-0 cq-md:col-span-2 cq-xl:col-span-1">
          <DetailHeading>Age, face and state limits</DetailHeading>
          {facts ? (
            <dl className="grid gap-y-1.5 text-[12.5px] leading-5">
              <Fact label="Issue ages">{facts.issueAges.join('; ')}</Fact>
              <Fact label="Face limits">
                {facts.faceLimits
                  .map(l => `${l.label} ${wholeDollars(l.min)}–${wholeDollars(l.max)}`)
                  .join('; ')}
              </Fact>
              <Fact label="Policy fee">{feeText(facts.policyFeeAnnual)}</Fact>
              <Fact label="Monthly factor">
                {facts.monthlyFactor != null
                  ? `${facts.monthlyFactor} (${facts.monthlyLabel ?? 'Monthly'})`
                  : 'Not published'}
              </Fact>
              <Fact label="Age basis">{facts.ageBasis}</Fact>
              {facts.stateUnavailable.length ? (
                <Fact label="Not sold in">{facts.stateUnavailable.join(', ')}</Fact>
              ) : null}
            </dl>
          ) : (
            <p className="text-[13px] text-ink-2">Not published.</p>
          )}
          {facts?.alerts.length ? (
            <div className="mt-4">
              <DetailHeading>Carrier notes</DetailHeading>
              <ul className="list-disc space-y-1 pl-4 text-[12.5px] leading-5 text-ink-2">
                {facts.alerts.map(a => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {isStaff && facts?.staff ? (
            <details className="mt-3 rounded-control border border-rule bg-surface p-2">
              <summary className={cn('cursor-pointer text-[12px] font-medium text-ink-2', FOCUS)}>
                Source notes
              </summary>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-ink-2">
                {[...facts.staff.notes, ...facts.staff.stateNotes].map(n => (
                  <li key={n}>{n}</li>
                ))}
                {Object.entries(facts.staff.deathBenefitText).map(([code, text]) =>
                  text ? (
                    <li key={code}>
                      {code}: {text}
                    </li>
                  ) : null
                )}
              </ul>
            </details>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function DetailAction({
  icon: Icon,
  onClick,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-control px-2 text-[12.5px] font-medium text-ink-2 transition-colors duration-150 ne-motion hover:bg-sunken hover:text-ink',
        FOCUS
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {children}
    </button>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="grid grid-cols-[104px_minmax(0,1fr)] gap-3">
      <dt className="text-ink-3">{label}</dt>
      <dd className="min-w-0 break-words text-ink">{children}</dd>
    </div>
  );
}

/**
 * The quote the agent chose, pinned under the results until it is changed:
 * who, what, how much, and the next step.
 */
export function SelectedQuoteBar({
  selection,
  onStart,
  startLabel = 'Start application',
  note,
  onView,
  onClear,
}: {
  selection: FexSelection;
  onStart?: () => void;
  startLabel?: string;
  /** Shown instead of a Start button (the softphone: it prefills at disposition). */
  note?: string;
  /** Bring the selected carrier's row into view, opened. */
  onView?: () => void;
  onClear: () => void;
}): JSX.Element {
  return (
    <div
      role="status"
      aria-label="Selected quote"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-rule bg-surface py-2 pl-4 pr-2 shadow-[inset_3px_0_0_var(--live),var(--shadow-raised)]"
    >
      <CarrierLogo
        names={[selection.carrier, selection.productId]}
        size="sm"
        className="hidden sm:inline-flex"
      />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-[0.08em] text-live-ink">
          <Check className="h-3 w-3" aria-hidden />
          <span>Selected</span>
        </p>
        <p className="text-[13.5px] leading-5 text-ink">
          <span className="font-semibold">{selection.carrier}</span>{' '}
          <span className="text-ink-2">{selection.product}</span>
        </p>
        <p className="text-[12.5px] tabular-nums text-ink-2">
          {selection.classLabel} · {wholeDollars(selection.face)} ·{' '}
          <span className="font-bold text-ink">
            {selection.premium != null ? money(selection.premium) : '—'}/
            {MODE_SHORT[selection.mode]}
          </span>
        </p>
        {note ? <p className="t-meta text-ink-2">{note}</p> : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        {onStart ? (
          <Button size="sm" className="h-9 px-4 font-semibold" onClick={onStart}>
            {startLabel}
          </Button>
        ) : null}
        {onView ? (
          <Button size="sm" variant="outline" className="h-9" onClick={onView}>
            View details
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" className="h-9 text-ink-2" onClick={onClear}>
          Change
        </Button>
      </div>
    </div>
  );
}
