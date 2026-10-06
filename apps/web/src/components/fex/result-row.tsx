'use client';

/**
 * One carrier's answer -- as a row in the list, and as the selected-quote bar.
 *
 * ── What a row carries ───────────────────────────────────────────────────────
 *
 * Read left to right the way an agent decides, in fixed columns so a list of
 * twenty lines up: who (logo), what (plan, carrier, the benefit as one badge,
 * and any warning), what it costs -- the premium is the largest thing on the
 * line, with the face and the annual figure under it -- and "Use Quote".
 * Everything else is behind the row's toggle or the overflow menu.
 *
 * The columns come from the row's own width (a container query), not the
 * window's: the same row is a full page, a drawer over a call, a console tab
 * and History's drawer.
 *
 * Opened, a row explains itself: the carrier's reasons in the order they
 * apply, each with the page it is printed on; the sources those pages come
 * from; the other classes on offer; and the plan's published limits.
 */

import type { QuoteLine } from '@hopwhistle/fex-engine/types';
import {
  AlertTriangle,
  BookOpen,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Info,
  Layers,
  MoreHorizontal,
  Save,
  ShieldCheck,
  X,
} from 'lucide-react';
import * as React from 'react';

import { CarrierLogo, StatusChip } from '@/components/domain';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip } from '@/components/ui/tooltip';
import { MODE_SHORT, money, wholeDollars, type FexResult, type FexSelection } from '@/lib/fex/api';
import type { OutcomeChange } from '@/lib/fex/outcome-diff';
import { cn } from '@/lib/utils';

import { benefitTone, benefitWord, dataTone, FOCUS, outcomeTone } from './parts';

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
  /**
   * Marks the top of the list ("Best price", "Most coverage"): a label and the
   * green edge. Only what the sort actually established.
   */
  badge?: string;
  /** A second, quieter label the data supports ("Best level"). */
  tag?: string;
  /** In the comparison; absent where there is no comparing (history). */
  compared?: boolean;
  onCompareToggle?: () => void;
  /** The comparison is full and this row is not in it. */
  compareFull?: boolean;
  /** This carrier's answer moved with the last edit. */
  change?: OutcomeChange;
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

const BADGE_TONE = {
  live: 'bg-live-tint text-live-ink',
  ringing: 'bg-ringing-tint text-ringing-ink',
  dropped: 'bg-dropped-tint text-dropped-ink',
  blocked: 'bg-blocked-tint text-blocked-ink',
  money: 'bg-money-tint text-money-ink',
  neutral: 'bg-sunken text-ink-2',
} as const;

/**
 * The benefit as one badge -- LEVEL, GRADED, MODIFIED, GUARANTEED ISSUE --
 * with the carrier's class name after it when that says something more
 * ("LEVEL Preferred"). Green is Level and nothing else.
 */
export function BenefitBadge({ line }: { line: QuoteLine }): JSX.Element {
  const word = benefitWord(line.benefit);
  const extra = line.classLabel.toLowerCase().includes(word.toLowerCase()) ? null : line.classLabel;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span
        className={cn(
          'inline-flex h-5 shrink-0 items-center rounded-[4px] px-1.5 text-[10.5px] font-semibold uppercase leading-none tracking-[0.05em]',
          BADGE_TONE[benefitTone(line.benefit)]
        )}
      >
        {word}
      </span>
      {extra ? (
        <span className="min-w-0 truncate text-[12px] text-ink-2" title={line.classLabel}>
          {extra}
        </span>
      ) : null}
    </span>
  );
}

/** "RATE VERIFY": the carrier's rate book is older than current, said plainly. */
function RateFlag({ result }: { result: FexResult }): JSX.Element | null {
  const facts = result.facts;
  const tone = facts?.ratesStatus.tone;
  if (!facts || (tone !== 'warn' && tone !== 'mod')) return null;
  const detail = facts.sourceDate
    ? `${facts.ratesStatus.label}. Carrier rate source dated ${facts.sourceDate}. Verify before submitting.`
    : `${facts.ratesStatus.label}. Verify the rate before submitting.`;
  return (
    <Tooltip content={detail} side="top">
      <span className="inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-[4px] border border-ringing px-1 text-[10.5px] font-semibold uppercase leading-none tracking-[0.05em] text-ringing-ink">
        <AlertTriangle className="h-3 w-3" aria-hidden />
        Rate verify
        <span className="sr-only">: {detail}</span>
      </span>
    </Tooltip>
  );
}

function Flags({
  result,
  priceOnly,
  change,
}: {
  result: FexResult;
  priceOnly: boolean;
  change?: OutcomeChange;
}): JSX.Element {
  return (
    <>
      {result.refer ? <StatusChip value="REFER" tone="ringing" size="sm" label="Refer" /> : null}
      {priceOnly ? (
        <StatusChip value="PRICE_ONLY" tone="neutral" size="sm" dot={false} label="Price only" />
      ) : null}
      <RateFlag result={result} />
      {change ? (
        <span
          className={cn(
            'whitespace-nowrap text-[11px] font-medium',
            change.direction === 'worse'
              ? 'text-dropped-ink'
              : change.direction === 'better'
                ? 'text-live-ink'
                : 'text-ink-2'
          )}
        >
          was {change.from}
        </span>
      ) : null}
    </>
  );
}

/**
 * The carrier's own first reasons, in a line or two, for a row wide enough to
 * carry them -- so "why" is read in the same glance as the price. Shown only
 * from the widest layout; every word is the engine's.
 */
function WhyGlance({ result }: { result: FexResult }): JSX.Element {
  let text: string | null = null;
  if (!result.eligible)
    text = null; // the decline reason is already on the row
  else if (result.reasons.length)
    text = result.reasons
      .slice(0, 2)
      .map(r => r.text)
      .join(' · ');
  else if (!result.uwLoaded) text = 'Health questions not loaded — priced only.';
  else text = 'No health question, guide rule, medication or build limit triggered.';
  return (
    <span className="hidden min-w-0 cq-xl:block">
      {text ? (
        <span className="line-clamp-2 text-[12px] leading-4 text-ink-2" title={text}>
          {text}
        </span>
      ) : null}
    </span>
  );
}

/** The premium, large, with its mode, and the face and annual figure under it. */
function Price({ line, face }: { line: QuoteLine; face: number }): JSX.Element {
  if (line.premium == null) {
    return (
      <div className="text-right">
        <p className="t-num text-base font-semibold text-ink">—</p>
        <p className="t-meta text-ink-3">{line.premiumNote ?? 'Single premium'}</p>
      </div>
    );
  }
  const annual = line.annual;
  return (
    <div className="text-right">
      <p className="whitespace-nowrap tabular-nums leading-none text-ink">
        <span className="text-[20px] font-semibold tracking-[-0.01em] cq-md:text-[21px]">
          {money(line.premium)}
        </span>
        <span className="ml-0.5 text-[11px] text-ink-3">/{MODE_SHORT[line.mode]}</span>
      </p>
      <p className="mt-1 inline-flex items-center gap-1 whitespace-nowrap text-[11.5px] tabular-nums text-ink-3">
        {line.faceAdjusted ? (
          <Tooltip content={line.faceAdjusted} side="top" align="end">
            <Info className="h-3 w-3 text-ringing-ink" aria-label={line.faceAdjusted} />
          </Tooltip>
        ) : null}
        <span className="font-medium text-ink-2">{wholeDollars(face)}</span>
        {annual != null && line.mode !== 'annual' ? (
          <span className="hidden cq-sm:inline"> · {money(annual).replace(/\.\d\d$/, '')}/yr</span>
        ) : null}
      </p>
    </div>
  );
}

function MoreMenu({
  result,
  line,
  onUse,
  onCopy,
  onSave,
}: {
  result: FexResult;
  line: QuoteLine;
  onUse?: ResultRowProps['onUse'];
  onCopy?: ResultRowProps['onCopy'];
  onSave?: ResultRowProps['onSave'];
}): JSX.Element | null {
  if (!onCopy && !onSave && !onUse) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          aria-label={`More for ${result.family} ${result.product}`}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {onUse ? (
          <DropdownMenuItem onSelect={() => onUse(result, line)}>
            <Check className="mr-2 h-4 w-4" aria-hidden /> Use Quote
          </DropdownMenuItem>
        ) : null}
        {onCopy ? (
          <DropdownMenuItem onSelect={() => onCopy(result)}>
            <Copy className="mr-2 h-4 w-4" aria-hidden /> Copy quote summary
          </DropdownMenuItem>
        ) : null}
        {onSave ? (
          <DropdownMenuItem onSelect={() => onSave(result)}>
            <Save className="mr-2 h-4 w-4" aria-hidden /> Save quote
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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
  badge,
  tag,
  compared = false,
  onCompareToggle,
  compareFull = false,
  change,
}: ResultRowProps): JSX.Element {
  const best = result.best;
  const declined = !result.eligible;
  const detailId = `fex-detail-${result.productId}`;
  const hasActions = !declined && best && (onUse || onCopy || onSave || onCompareToggle);

  return (
    <li
      className={cn(
        'cq group/row relative border-b border-rule transition-colors duration-150 ne-motion last:border-0',
        expanded ? 'bg-sunken' : 'hover:bg-paper',
        selected && !expanded && 'bg-live-tint hover:bg-live-tint',
        // The top of the list: a 3px green edge, nothing louder.
        badge && 'shadow-[inset_3px_0_0_var(--live)]'
      )}
      data-product={result.productId}
      data-selected={selected ? '' : undefined}
    >
      <div className="flex items-center">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={detailId}
          onClick={onToggle}
          data-row-toggle=""
          className={cn(
            'grid min-w-0 flex-1 items-center gap-x-3 py-2 pl-3 pr-2 text-left',
            'grid-cols-[minmax(0,1fr)_auto] cq-md:grid-cols-[120px_minmax(0,1fr)_128px]',
            // A very wide row spends its room on the reason, not on a gap.
            'cq-xl:grid-cols-[120px_minmax(240px,1fr)_minmax(0,1.1fr)_128px]',
            declined ? 'min-h-[52px]' : 'min-h-[64px]',
            FOCUS,
            'focus-visible:ring-inset focus-visible:ring-offset-0'
          )}
        >
          <CarrierLogo
            names={[result.family, result.productId]}
            size="md"
            className={cn(
              'hidden h-11 w-[120px] cq-md:inline-flex',
              declined && 'opacity-50 grayscale'
            )}
          />
          <span className="min-w-0">
            <span className="flex min-w-0 items-center gap-2">
              {badge ? (
                <span className="inline-flex shrink-0 items-center gap-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-live-ink">
                  <ShieldCheck className="h-3 w-3" aria-hidden />
                  {badge}
                </span>
              ) : null}
              {tag ? (
                <span className="shrink-0 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-2">
                  {tag}
                </span>
              ) : null}
            </span>
            <span
              className={cn(
                'block truncate text-[14.5px] font-semibold leading-5',
                declined ? 'text-ink-2' : 'text-ink'
              )}
              title={result.product}
            >
              {result.product}
            </span>
            <span className="block truncate text-[12px] leading-4 text-ink-2">{result.family}</span>
            <span className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
              {declined ? (
                <>
                  <span className="inline-flex h-5 shrink-0 items-center rounded-[4px] bg-dropped-tint px-1.5 text-[10.5px] font-semibold uppercase leading-none tracking-[0.05em] text-dropped-ink">
                    {result.outcome === 'DECLINE' ? 'Decline' : 'Not available'}
                  </span>
                  {result.ineligibleReason ? (
                    <span className="min-w-0 text-[12px] leading-4 text-ink-2">
                      {result.ineligibleReason}
                    </span>
                  ) : null}
                </>
              ) : best ? (
                <BenefitBadge line={best} />
              ) : null}
              <Flags result={result} priceOnly={priceOnly} change={change} />
            </span>
          </span>

          <WhyGlance result={result} />
          {!declined && best ? (
            <span className="block min-w-[104px]">
              <Price line={best} face={best.face} />
            </span>
          ) : (
            <span aria-hidden />
          )}
          <span className="sr-only">{expanded ? 'Hide details' : 'Show details'}</span>
        </button>

        {hasActions && best ? (
          <div className="flex shrink-0 items-center gap-1 pr-2">
            {onCompareToggle ? (
              <label
                className={cn(
                  'hidden h-8 w-8 cursor-pointer items-center justify-center rounded-control hover:bg-sunken cq-sm:flex',
                  compareFull && !compared && 'cursor-not-allowed opacity-40'
                )}
                title={compareFull && !compared ? 'Compare up to 4' : 'Compare (C)'}
              >
                <input
                  type="checkbox"
                  checked={compared}
                  disabled={compareFull && !compared}
                  onChange={onCompareToggle}
                  aria-label={`Compare ${result.family} ${result.product}`}
                  className={cn('h-4 w-4 cursor-pointer accent-[var(--brand-strong)]', FOCUS)}
                />
              </label>
            ) : null}
            {onUse ? (
              <Button
                size="sm"
                disabled={busy}
                variant={selected ? 'outline' : 'default'}
                onClick={() => onUse(result, best)}
                className={cn(
                  'hidden h-8 w-[100px] px-2 text-[13px] cq-sm:inline-flex',
                  selected && 'border-live text-live-ink hover:bg-live-tint hover:text-live-ink'
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
            <MoreMenu result={result} line={best} onUse={onUse} onCopy={onCopy} onSave={onSave} />
          </div>
        ) : null}
        <ChevronDown
          aria-hidden
          className={cn(
            'mr-2 hidden h-4 w-4 shrink-0 text-ink-3 transition-transform duration-150 ne-motion motion-reduce:transition-none cq-sm:block',
            expanded && 'rotate-180'
          )}
        />
      </div>

      {expanded ? (
        <ResultDetail id={detailId} result={result} onUse={onUse} busy={busy} isStaff={isStaff} />
      ) : null}
    </li>
  );
}

function DetailHeading({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <h4 className="t-label mb-1.5 flex items-center gap-1.5 text-ink-2">
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {children}
    </h4>
  );
}

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

function ResultDetail({
  id,
  result,
  onUse,
  busy,
  isStaff,
}: {
  id: string;
  result: FexResult;
  onUse?: ResultRowProps['onUse'];
  busy: boolean;
  isStaff: boolean;
}): JSX.Element {
  const facts = result.facts;
  const sources = sourcesOf(result);
  return (
    <div
      id={id}
      className="grid gap-x-6 gap-y-4 border-t border-rule px-3 pb-4 pt-3 animate-in fade-in-0 duration-150 motion-reduce:animate-none cq-md:grid-cols-2 cq-md:pl-[144px]"
    >
      <section aria-label="Why this result" className="min-w-0">
        <DetailHeading icon={ShieldCheck}>Why this result</DetailHeading>
        {!result.uwLoaded ? (
          <p className="mb-2 rounded-control bg-surface px-2.5 py-1.5 text-[13px] text-ink-2">
            This carrier&apos;s health questions are not loaded yet; the best class is shown for
            price only.
          </p>
        ) : null}
        {result.reasons.length ? (
          <ol className="space-y-1.5">
            {result.reasons.map((reason, i) => {
              const tone = outcomeTone(reason.outcome);
              return (
                <li key={i} className="flex items-start gap-2 text-[13px] leading-5 text-ink">
                  <span
                    aria-hidden
                    className={cn(
                      'mt-[3px] flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full',
                      reason.outcome === 'DECLINE'
                        ? 'bg-dropped text-surface'
                        : tone === 'ringing'
                          ? 'bg-ringing text-surface'
                          : 'bg-live text-surface'
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
                    <span className="ml-1.5 inline-flex flex-wrap items-center gap-1.5 align-middle">
                      <StatusChip
                        value={reason.outcome}
                        tone={tone}
                        size="sm"
                        dot={false}
                        label={
                          reason.outcome === 'DECLINE'
                            ? 'Decline'
                            : reason.outcome === 'REFER'
                              ? 'Refer'
                              : undefined
                        }
                      />
                      {reason.page != null ? (
                        reason.url ? (
                          <a
                            href={reason.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={cn(
                              't-meta inline-flex items-center gap-0.5 text-brand-ink hover:underline',
                              FOCUS
                            )}
                          >
                            p. {reason.page}
                            <ExternalLink className="h-3 w-3" aria-hidden />
                            <span className="sr-only"> (opens the carrier document)</span>
                          </a>
                        ) : (
                          <span className="t-meta text-ink-3">p. {reason.page}</span>
                        )
                      ) : null}
                    </span>
                    {isStaff && reason.note ? (
                      <span className="t-meta mt-0.5 block text-ink-3">
                        Source note: {reason.note}
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ol>
        ) : result.eligible && result.uwLoaded ? (
          <p className="flex items-start gap-2 text-[13px] text-ink">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-live-ink" aria-hidden />
            No health question, guide rule, medication or build limit triggered — best class.
          </p>
        ) : null}
        {result.assumptions.length ? (
          <div className="mt-2.5">
            <h5 className="t-label mb-1 text-ink-3">Assumed</h5>
            <ul className="list-disc space-y-0.5 pl-4 text-[13px] text-ink-2">
              {result.assumptions.map(a => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {sources.length ? (
          <div className="mt-3">
            <DetailHeading icon={BookOpen}>Underwriting sources</DetailHeading>
            <ul className="space-y-0.5 text-[12.5px]">
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

      <div className="min-w-0 space-y-4">
        <section aria-label="Other options">
          <DetailHeading icon={Layers}>Other available options</DetailHeading>
          {result.others.length ? (
            <table className="w-full text-[13px]">
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
                    <td className="py-1.5 pr-2">
                      <BenefitBadge line={line} />
                    </td>
                    <td className="whitespace-nowrap py-1.5 pr-2 text-right tabular-nums text-ink-2">
                      {wholeDollars(line.face)}
                    </td>
                    <td className="whitespace-nowrap py-1.5 pr-2 text-right font-semibold tabular-nums text-ink">
                      {line.premium == null ? '—' : money(line.premium)}
                      <span className="text-[11px] font-normal text-ink-3">
                        /{MODE_SHORT[line.mode]}
                      </span>
                    </td>
                    <td className="py-1.5 text-right">
                      {onUse ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2.5 text-[12px]"
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
            <p className="text-[13px] text-ink-2">No other class for this applicant.</p>
          )}
        </section>

        <section aria-label="Plan facts">
          <DetailHeading icon={BookOpen}>Plan facts</DetailHeading>
          {facts ? (
            <dl className="grid gap-y-1 text-[12.5px]">
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
              <Fact label="Rates">
                <StatusChip
                  value="RATES"
                  tone={dataTone(facts.ratesStatus.tone)}
                  size="sm"
                  label={facts.ratesStatus.label}
                />
                {facts.sourceDate ? (
                  <span className="t-meta ml-1.5 text-ink-3">{facts.sourceDate}</span>
                ) : null}
              </Fact>
              {facts.stateUnavailable.length ? (
                <Fact label="Not sold in">{facts.stateUnavailable.join(', ')}</Fact>
              ) : null}
            </dl>
          ) : (
            <p className="text-[13px] text-ink-2">Not published.</p>
          )}
          {facts?.alerts.length ? (
            <div className="mt-2">
              <h5 className="t-label mb-1 text-ink-3">Carrier notes</h5>
              <ul className="list-disc space-y-0.5 pl-4 text-[12.5px] text-ink-2">
                {facts.alerts.map(a => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {isStaff && facts?.staff ? (
            <details className="mt-2 rounded-control border border-rule p-2">
              <summary className={cn('t-label cursor-pointer text-ink-2', FOCUS)}>
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

function Fact({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="grid grid-cols-[100px_1fr] gap-2">
      <dt className="text-ink-3">{label}</dt>
      <dd className="min-w-0 break-words text-ink">{children}</dd>
    </div>
  );
}

/** The quote the agent chose, pinned under the results until it is cleared. */
export function SelectedQuoteBar({
  selection,
  onStart,
  startLabel = 'Start application',
  note,
  onClear,
}: {
  selection: FexSelection;
  onStart?: () => void;
  startLabel?: string;
  /** Shown instead of a Start button (the softphone: it prefills at disposition). */
  note?: string;
  onClear: () => void;
}): JSX.Element {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-live bg-surface px-3 py-2 shadow-raised"
    >
      <CarrierLogo names={[selection.carrier, selection.productId]} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-live-ink">
          <Check className="h-3 w-3" aria-hidden />
          Selected
        </p>
        <p className="truncate text-[13px] text-ink">
          <span className="font-semibold">{selection.carrier}</span> · {selection.product} ·{' '}
          {selection.classLabel}
          <span className="tabular-nums text-ink-2">
            {' '}
            · {wholeDollars(selection.face)} ·{' '}
            <span className="font-semibold text-ink">
              {money(selection.premium)}/{MODE_SHORT[selection.mode]}
            </span>
          </span>
        </p>
        {note ? <p className="t-meta text-ink-2">{note}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {onStart ? (
          <Button size="sm" className="h-8" onClick={onStart}>
            {startLabel}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" className="h-8" onClick={onClear}>
          Clear
        </Button>
      </div>
    </div>
  );
}
