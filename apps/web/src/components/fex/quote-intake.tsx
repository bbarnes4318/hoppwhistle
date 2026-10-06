'use client';

/**
 * The quoter's left column: who, how much, and their health.
 *
 * Three sections, in the order an agent asks: the applicant, the coverage, and
 * the health history with its medications. Every edit re-quotes; nothing here
 * waits for a button.
 *
 * ── Dense on purpose ─────────────────────────────────────────────────────────
 *
 * This column is used DURING a call. The applicant is two rows of three, the
 * face amount is one row of presets, and a condition or medication is one
 * line once its questions are answered -- open only while they are being
 * answered. One search box adds either a condition or a medication, so the
 * agent never has to decide which box the prospect's answer belongs in.
 */

import {
  CONDITION_DETAIL_FIELDS,
  DIAGNOSED_BUCKETS,
  FACE_PRESETS,
  MED_LAST_TAKEN_BUCKETS,
  PAYMENT_MODES,
  QUICK_CONDITIONS,
  STATES,
  TREATED_BUCKETS,
  type DetailField,
} from '@hopwhistle/fex-engine/catalog';
import type { PaymentMode } from '@hopwhistle/fex-engine/types';
import { Check, ChevronDown, Info, RotateCcw, X } from 'lucide-react';
import * as React from 'react';

import { Panel } from '@/components/domain';
import { Tooltip } from '@/components/ui/tooltip';
import { fexApi, type FexDrugHit } from '@/lib/fex/api';
import { searchConditions } from '@/lib/fex/condition-search';
import {
  ageFromDob,
  missingForQuote,
  type DraftAction,
  type DraftCondition,
  type DraftMed,
  type QuoteDraft,
} from '@/lib/fex/draft';
import { US_STATES } from '@/lib/us-states';
import { cn } from '@/lib/utils';

import { Combobox, type ComboOption } from './combobox';
import {
  bucketFrom,
  bucketValue,
  CheckRow,
  ChoiceGroup,
  Field,
  FIELD_LABEL,
  FOCUS,
  FromLeadTag,
  NativeSelect,
  shortLabel,
  TextInput,
} from './parts';

export interface ConditionMeta {
  code: string;
  label: string;
  category: string;
}

export interface QuoteIntakeProps {
  idPrefix: string;
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

/** The id of the one health search box, for the workspace's Alt+H / Alt+M. */
export const healthSearchId = (idPrefix: string): string => `${idPrefix}-health`;

const STATE_NAME = new Map<string, string>([
  ...US_STATES.map(s => [s.value, s.label] as [string, string]),
  ['DC', 'District of Columbia'],
]);

/** The conditions agents hear most, shown as one-tap chips ahead of the rest. */
const FEATURED_CONDITIONS: readonly string[] = [
  'DIABETES',
  'DIABETES_INSULIN',
  'COPD',
  'CHF',
  'HEART_ATTACK',
  'STROKE',
];

const digitsOnly = (v: string) => v.replace(/[^0-9]/g, '');

const applicantDone = (d: QuoteDraft) => {
  const m = missingForQuote(d);
  return m !== 'state' && m !== 'sex' && m !== 'age' && m !== 'dob';
};
const coverageDone = (d: QuoteDraft) => {
  const n = Number((d.coverage.mode === 'face' ? d.coverage.face : d.coverage.budget) || NaN);
  return d.coverage.mode === 'face' ? n >= 1000 && n <= 500000 : n >= 5 && n <= 2000;
};

const MISSING_TEXT: Record<string, string> = {
  state: 'Needs state',
  sex: 'Needs sex',
  age: 'Needs age (18–100)',
  dob: 'Needs date of birth',
  face: 'Needs a face amount',
  budget: 'Needs a monthly budget',
};

/** A bucket's label, said briefly: "1–2 years ago" → "1–2 yrs". */
function briefBucket(label: string): string {
  return label
    .replace(/ ago$/, '')
    .replace(/years?/, 'yrs')
    .replace(/months?/, 'mo')
    .replace('Within 30 days', '<30 days');
}

function labelFor(buckets: ReadonlyArray<readonly [string, unknown]>, months: unknown) {
  return buckets.find(([, m]) => m === months)?.[0];
}

export function QuoteIntake(props: QuoteIntakeProps): JSX.Element {
  const missing = missingForQuote(props.draft);
  return (
    // Not overflow-hidden: the health search's list drops out of the panel.
    <Panel>
      <div className="flex h-11 items-center justify-between gap-2 border-b border-rule px-4">
        <p className="flex min-w-0 items-center gap-2 text-[12px] font-medium" aria-live="polite">
          <span
            aria-hidden
            className={cn('h-1.5 w-1.5 shrink-0 rounded-full', missing ? 'bg-ink-3' : 'bg-live')}
          />
          <span className={cn('truncate', missing ? 'text-ink-2' : 'text-live-ink')}>
            {missing ? (MISSING_TEXT[missing] ?? 'Needs more answers') : 'Quoting live'}
          </span>
        </p>
        {props.onReset ? (
          <button
            type="button"
            onClick={props.onReset}
            className={cn(
              '-mr-2 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-control px-2 text-[12.5px] font-medium text-ink-2 transition-colors duration-150 ne-motion hover:bg-sunken hover:text-ink',
              FOCUS
            )}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            New quote
          </button>
        ) : null}
      </div>
      <div className="divide-y divide-rule">
        <ApplicantSection {...props} />
        <CoverageSection {...props} />
        <HealthSection {...props} />
      </div>
    </Panel>
  );
}

function Section({
  title,
  done,
  hint,
  aside,
  children,
}: {
  title: string;
  done?: boolean;
  /** One line of guidance, behind the title's info mark. */
  hint?: string;
  /** A control or summary that belongs to the whole section, right of its title. */
  aside?: React.ReactNode;
  children: React.ReactNode;
}): JSX.Element {
  const id = React.useId();
  return (
    <section aria-labelledby={id} className="px-4 pb-5 pt-4">
      <div className="mb-3 flex min-h-[28px] items-center gap-1.5">
        <h3 id={id} className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink">
          {title}
        </h3>
        {done ? <Check className="h-3.5 w-3.5 text-live-ink" aria-label="Complete" /> : null}
        {hint ? (
          <Tooltip content={hint} side="top">
            <Info className="h-3.5 w-3.5 text-ink-3" aria-label={hint} />
          </Tooltip>
        ) : null}
        {aside ? <div className="ml-auto flex shrink-0 items-center gap-1.5">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

// ─── Applicant ───────────────────────────────────────────────────────────────

function ApplicantSection({ idPrefix, draft, dispatch }: QuoteIntakeProps): JSX.Element {
  const p = (s: string) => `${idPrefix}-${s}`;
  const lead = (f: Parameters<QuoteDraft['prefilled']['has']>[0]) => draft.prefilled.has(f);
  const dobMode = draft.ageOrDob.mode === 'dob';
  const dobAge = dobMode ? ageFromDob((draft.ageOrDob as { dob: string }).dob) : null;

  const switchAgeMode = () =>
    dispatch({
      type: 'set',
      patch: {
        ageOrDob:
          draft.ageOrDob.mode === 'age'
            ? { mode: 'dob', dob: '' }
            : { mode: 'age', age: dobAge !== null ? String(dobAge) : '' },
      },
      fields: ['age', 'dob'],
    });

  const unit = (text: string) => (
    <span
      aria-hidden
      className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-ink-3"
    >
      {text}
    </span>
  );

  return (
    <Section title="Applicant" done={applicantDone(draft)}>
      {/* Two rows of three, the order an agent asks: where, who, how old;
          then tobacco, height and weight. */}
      <div className="grid grid-cols-3 gap-x-2.5 gap-y-3">
        <Field label="State" htmlFor={p('state')} fromLead={lead('state')}>
          <NativeSelect
            id={p('state')}
            value={draft.state}
            className="px-2 pr-6"
            onChange={e =>
              dispatch({ type: 'set', patch: { state: e.target.value }, fields: ['state'] })
            }
          >
            <option value="">—</option>
            {STATES.map(code => (
              <option key={code} value={code} title={STATE_NAME.get(code)}>
                {code}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field label="Sex" fromLead={lead('sex')}>
          <ChoiceGroup
            label="Sex"
            options={[
              { value: 'F' as const, label: 'Female' },
              { value: 'M' as const, label: 'Male' },
            ]}
            value={draft.sex || null}
            onChange={sex => dispatch({ type: 'set', patch: { sex }, fields: ['sex'] })}
          />
        </Field>

        <div className={cn('min-w-0', dobMode && 'col-span-3 row-start-2')}>
          <label htmlFor={dobMode ? p('dob') : p('age')} className={FIELD_LABEL}>
            {dobMode ? 'Date of birth' : 'Age'}
            {lead(draft.ageOrDob.mode) ? <FromLeadTag /> : null}
          </label>
          <div className="flex min-w-0">
            {dobMode ? (
              <div className="relative min-w-0 flex-1">
                <TextInput
                  id={p('dob')}
                  type="date"
                  value={(draft.ageOrDob as { dob: string }).dob}
                  className="rounded-r-none"
                  onChange={e =>
                    dispatch({
                      type: 'set',
                      patch: { ageOrDob: { mode: 'dob', dob: e.target.value } },
                      fields: ['dob'],
                    })
                  }
                />
                <span
                  className="t-meta pointer-events-none absolute right-9 top-1/2 -translate-y-1/2 tabular-nums text-ink-2"
                  aria-live="polite"
                >
                  {dobAge !== null ? `Age ${dobAge}` : ''}
                </span>
              </div>
            ) : (
              <TextInput
                id={p('age')}
                inputMode="numeric"
                maxLength={3}
                placeholder="65"
                value={(draft.ageOrDob as { age: string }).age}
                className="min-w-0 flex-1 rounded-r-none px-2"
                onChange={e =>
                  dispatch({
                    type: 'set',
                    patch: { ageOrDob: { mode: 'age', age: digitsOnly(e.target.value) } },
                    fields: ['age'],
                  })
                }
              />
            )}
            <button
              type="button"
              onClick={switchAgeMode}
              title={dobMode ? 'Enter an age instead' : 'Enter a date of birth instead'}
              aria-label={dobMode ? 'Enter an age instead' : 'Enter a date of birth instead'}
              className={cn(
                '-ml-px h-[38px] shrink-0 rounded-r-control border border-rule-strong bg-sunken px-2 text-[10.5px] font-semibold uppercase tracking-[0.04em] text-ink-2 transition-colors duration-150 ne-motion hover:bg-surface hover:text-ink',
                FOCUS
              )}
            >
              {dobMode ? 'Age' : 'DOB'}
            </button>
          </div>
        </div>

        <Field label="Tobacco" fromLead={lead('tobacco')}>
          <ChoiceGroup
            label="Tobacco or nicotine in the last 12 months"
            options={[
              { value: false, label: 'No', key: 'no' },
              { value: true, label: 'Yes', key: 'yes' },
            ]}
            value={draft.tobacco}
            onChange={tobacco => dispatch({ type: 'set', patch: { tobacco }, fields: ['tobacco'] })}
          />
        </Field>

        <Field label="Height" htmlFor={p('ft')} fromLead={lead('height')}>
          <div className="grid grid-cols-2 gap-1">
            <div className="relative">
              <TextInput
                id={p('ft')}
                inputMode="numeric"
                maxLength={1}
                placeholder="5"
                aria-label="Height, feet"
                value={draft.heightFt}
                onChange={e =>
                  dispatch({
                    type: 'set',
                    patch: { heightFt: digitsOnly(e.target.value) },
                    fields: ['height'],
                  })
                }
                className="px-2 pr-5"
              />
              {unit('ft')}
            </div>
            <div className="relative">
              <TextInput
                inputMode="numeric"
                maxLength={2}
                placeholder="6"
                aria-label="Height, inches"
                value={draft.heightIn}
                onChange={e =>
                  dispatch({
                    type: 'set',
                    patch: { heightIn: digitsOnly(e.target.value) },
                    fields: ['height'],
                  })
                }
                className="px-2 pr-5"
              />
              {unit('in')}
            </div>
          </div>
        </Field>

        <Field label="Weight" htmlFor={p('weight')} fromLead={lead('weight')}>
          <div className="relative">
            <TextInput
              id={p('weight')}
              inputMode="numeric"
              maxLength={3}
              placeholder="180"
              value={draft.weightLb}
              onChange={e =>
                dispatch({
                  type: 'set',
                  patch: { weightLb: digitsOnly(e.target.value) },
                  fields: ['weight'],
                })
              }
              className="px-2 pr-6"
            />
            {unit('lb')}
          </div>
        </Field>
      </div>
    </Section>
  );
}

// ─── Coverage ────────────────────────────────────────────────────────────────

const PAYMENT_SHORT: Record<string, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  semiannual: 'Semi-annual',
  annual: 'Annual',
};

const faceText = (amount: number) =>
  amount % 1000 === 0 ? `${amount / 1000}k` : `${(amount / 1000).toFixed(1)}k`;

function CoverageSection({
  idPrefix,
  draft,
  dispatch,
  showAetnaMedSupp,
}: QuoteIntakeProps): JSX.Element {
  const p = (s: string) => `${idPrefix}-${s}`;
  const face = draft.coverage.mode === 'face' ? draft.coverage.face : '';
  const offList = Boolean(face) && !FACE_PRESETS.includes(Number(face));
  const [customOpen, setCustomOpen] = React.useState(offList);
  const custom = customOpen || offList;
  const customRef = React.useRef<HTMLInputElement>(null);
  const labelId = p('face-label');

  type FaceChoice = number | 'custom';
  const options = [
    ...FACE_PRESETS.map(amount => ({
      value: amount as FaceChoice,
      label: faceText(amount),
      ariaLabel: `$${amount.toLocaleString('en-US')}`,
    })),
    { value: 'custom' as FaceChoice, label: 'Custom', ariaLabel: 'Custom amount' },
  ];

  const setFace = (value: string) =>
    dispatch({ type: 'set', patch: { coverage: { mode: 'face', face: value } }, fields: ['face'] });

  const paymentLabel =
    PAYMENT_MODES.find(([value]) => value === draft.paymentMode)?.[1] ?? 'Payment mode';

  return (
    <Section
      title="Coverage"
      done={coverageDone(draft)}
      aside={
        <>
          <ChoiceGroup
            label="Quote by"
            className="h-7 w-[132px] p-[2px]"
            itemClassName="text-[12px]"
            options={[
              { value: 'face' as const, label: 'Face' },
              { value: 'budget' as const, label: 'Budget' },
            ]}
            value={draft.coverage.mode}
            onChange={mode => {
              if (mode === draft.coverage.mode) return;
              if (mode === 'face') {
                dispatch({ type: 'set', patch: { coverage: { mode: 'face', face: '10000' } } });
                setCustomOpen(false);
              } else
                dispatch({
                  type: 'set',
                  patch: { coverage: { mode: 'budget', budget: '' } },
                  fields: ['face'],
                });
            }}
          />
          {/* Payment mode matters, but less than the amount: a quiet select
              in the header, not a field in the grid. */}
          <label htmlFor={p('mode')} className="sr-only">
            Payment mode
          </label>
          <select
            id={p('mode')}
            value={draft.paymentMode}
            title={paymentLabel}
            onChange={e =>
              dispatch({ type: 'set', patch: { paymentMode: e.target.value as PaymentMode } })
            }
            className={cn(
              'h-7 cursor-pointer rounded-control border border-transparent bg-transparent pl-1.5 pr-6 text-[12px] font-medium text-ink-2 hover:border-rule-strong hover:bg-surface hover:text-ink',
              FOCUS
            )}
          >
            {PAYMENT_MODES.map(([value, label]) => (
              <option key={value} value={value} title={label}>
                {PAYMENT_SHORT[value] ?? label}
              </option>
            ))}
          </select>
        </>
      }
    >
      <div className="space-y-3.5">
        {draft.coverage.mode === 'face' ? (
          <div>
            <p id={labelId} className={FIELD_LABEL}>
              Face amount
              {draft.prefilled.has('face') ? <FromLeadTag /> : null}
            </p>
            <ChoiceGroup<FaceChoice>
              labelledBy={labelId}
              tone="strong"
              itemClassName="text-[13px]"
              options={options}
              value={null}
              isChecked={o => (o.value === 'custom' ? custom : !custom && Number(face) === o.value)}
              onChange={(value, via) => {
                if (value === 'custom') {
                  setCustomOpen(true);
                  if (via === 'click') requestAnimationFrame(() => customRef.current?.focus());
                  return;
                }
                setCustomOpen(false);
                setFace(String(value));
              }}
            />
            {custom ? (
              <div className="relative mt-2">
                <span
                  aria-hidden
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-ink-3"
                >
                  $
                </span>
                <TextInput
                  ref={customRef}
                  inputMode="numeric"
                  aria-label="Custom face amount"
                  placeholder="Any amount, e.g. 12,500"
                  value={offList ? Number(face).toLocaleString('en-US') : ''}
                  onChange={e => setFace(digitsOnly(e.target.value).slice(0, 6))}
                  className="pl-6"
                />
              </div>
            ) : null}
          </div>
        ) : (
          <Field label="Monthly budget" htmlFor={p('budget')}>
            <div className="relative">
              <span
                aria-hidden
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-ink-3"
              >
                $
              </span>
              <TextInput
                id={p('budget')}
                inputMode="decimal"
                placeholder="50"
                value={draft.coverage.budget}
                onChange={e =>
                  dispatch({
                    type: 'set',
                    patch: {
                      coverage: {
                        mode: 'budget',
                        budget: e.target.value.replace(/[^0-9.]/g, '').slice(0, 7),
                      },
                    },
                  })
                }
                className="pl-6"
              />
            </div>
          </Field>
        )}

        <div className="flex flex-wrap gap-x-5 gap-y-1.5 pt-1">
          <CheckRow
            id={p('activity')}
            checked={draft.activityCredit}
            onChange={checked => dispatch({ type: 'set', patch: { activityCredit: checked } })}
            className="text-[12.5px] text-ink-2"
          >
            <span title="Transamerica activity credit">Exercises 3+ days/wk</span>
          </CheckRow>
          {showAetnaMedSupp ? (
            <CheckRow
              id={p('medsupp')}
              checked={draft.aetnaMedSupp}
              onChange={checked => dispatch({ type: 'set', patch: { aetnaMedSupp: checked } })}
              className="text-[12.5px] text-ink-2"
            >
              <span title="Has a qualifying Aetna/CVS Medicare Supplement">Aetna Med Supp</span>
            </CheckRow>
          ) : null}
        </div>
      </div>
    </Section>
  );
}

// ─── Health: conditions and medications ──────────────────────────────────────

/**
 * The brand or alias a search hit matched on, when it isn't the generic name,
 * so typing "E" shows "Eliquis · apixaban" rather than an unexplained apixaban.
 */
function matchedBrand(hit: FexDrugHit): string | undefined {
  const matched = hit.matched;
  if (!matched || matched === hit.generic.toLowerCase()) return undefined;
  return hit.brands.find(b => b.toLowerCase() === matched) ?? matched;
}

/** Drug search, debounced, as the medication lookup has always done it. */
function useDrugSearch(query: string): { hits: FexDrugHit[]; searching: boolean } {
  const [hits, setHits] = React.useState<FexDrugHit[]>([]);
  const [searching, setSearching] = React.useState(false);
  React.useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits([]);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    const timer = setTimeout(() => {
      void fexApi.searchDrugs(q, 12, controller.signal).then(result => {
        if (controller.signal.aborted) return;
        setHits(result.ok ? result.data : []);
        setSearching(false);
      });
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);
  return { hits, searching };
}

function HealthSection({
  idPrefix,
  draft,
  dispatch,
  conditions,
  needsIndication,
}: QuoteIntakeProps): JSX.Element {
  const [query, setQuery] = React.useState('');
  const byCode = React.useMemo(() => new Map(conditions.map(c => [c.code, c])), [conditions]);
  const added = new Set(draft.conditions.map(c => c.code));
  const conditionMatches = React.useMemo(
    () => searchConditions(conditions, query, 8).filter(c => !added.has(c.code)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conditions, query, draft.conditions]
  );
  const { hits, searching } = useDrugSearch(query);
  const addedDrugs = new Set(draft.meds.map(m => m.drugId));

  // One list, two groups: the conditions dictionary and the drug search, both
  // the same sources the lookups use.
  const options: ComboOption[] = [
    ...conditionMatches.map(c => ({
      id: `c:${c.code}`,
      label: c.label,
      meta: c.category,
      group: 'Conditions',
    })),
    ...hits
      .filter(h => !addedDrugs.has(h.id))
      .slice(0, 8)
      .map(h => ({
        id: `d:${h.id}`,
        group: 'Medications',
        label: matchedBrand(h) ? (
          <>
            <span className="capitalize">{matchedBrand(h)}</span>
            <span className="text-ink-2"> · {h.generic}</span>
          </>
        ) : (
          <>
            <span className="capitalize">{h.generic}</span>
            {h.brands.length ? (
              <span className="text-ink-2"> · {h.brands.slice(0, 2).join(', ')}</span>
            ) : null}
          </>
        ),
        meta: h.drugClass ?? undefined,
      })),
  ];

  const pick = (id: string) => {
    if (id.startsWith('c:')) {
      dispatch({ type: 'addCondition', code: id.slice(2) });
      return;
    }
    const hit = hits.find(h => h.id === id.slice(2));
    if (!hit) return;
    dispatch({
      type: 'addMed',
      med: {
        drugId: hit.id,
        name: hit.brands[0] ? `${hit.generic} (${hit.brands[0]})` : hit.generic,
        indications: hit.indications,
        multiUse: hit.multiUse,
      },
    });
  };

  const [showAllQuick, setShowAllQuick] = React.useState(false);
  const allQuick = QUICK_CONDITIONS.filter(code => byCode.has(code));
  // The ones agents hear most first; the rest of the knockout list one tap away.
  const featured = FEATURED_CONDITIONS.filter(code => allQuick.includes(code));
  const rest = allQuick.filter(code => !featured.includes(code));
  const quick = showAllQuick ? [...featured, ...rest] : featured;
  const hiddenCount = showAllQuick ? 0 : rest.length;
  // A chip's short name, unless two chips would read the same ("Diabetes"
  // twice): then both say it in full.
  const chipLabel = (code: string) => {
    const label = byCode.get(code)!.label;
    const short = shortLabel(label);
    const clash = quick.some(
      other => other !== code && shortLabel(byCode.get(other)!.label) === short
    );
    return clash ? label : short;
  };

  const summary = [
    draft.conditions.length
      ? `${draft.conditions.length} condition${draft.conditions.length === 1 ? '' : 's'}`
      : null,
    draft.meds.length ? `${draft.meds.length} med${draft.meds.length === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Section
      title="Health"
      hint="Last treated means the last surgery, procedure, hospital stay or treatment change. Each carrier's own questions decide the result."
      aside={<span className="t-meta text-ink-3">{summary || 'Optional'}</span>}
    >
      <div className="space-y-3.5">
        <Combobox
          id={healthSearchId(idPrefix)}
          inputClassName="h-10 text-[14px]"
          label="Add a condition or medication"
          hideLabel
          query={query}
          onQueryChange={setQuery}
          placeholder="Search condition or medication…"
          options={options}
          onPick={pick}
          loading={searching}
          shortcut="Alt+H"
          emptyText="No condition or medication by that name"
        />

        <div>
          <p className={FIELD_LABEL} aria-hidden>
            Common
          </p>
          <div
            className="flex flex-wrap gap-1.5"
            role="group"
            aria-label="Common knockout conditions"
          >
            {quick.map(code => {
              const on = added.has(code);
              return (
                <button
                  key={code}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    if (on) {
                      const c = draft.conditions.find(x => x.code === code);
                      if (c) dispatch({ type: 'removeCondition', key: c.key });
                    } else dispatch({ type: 'addCondition', code });
                  }}
                  className={cn(
                    'inline-flex h-7 items-center gap-1 rounded-[6px] px-2.5 text-[12.5px] font-medium leading-none transition-colors duration-150 ne-motion [@media(pointer:coarse)]:min-h-[36px]',
                    on
                      ? 'bg-ink text-surface'
                      : 'bg-sunken text-ink-2 hover:bg-[#e3e7ec] hover:text-ink',
                    FOCUS
                  )}
                >
                  {on ? <Check className="-ml-0.5 h-3 w-3 shrink-0" aria-hidden /> : null}
                  {chipLabel(code)}
                </button>
              );
            })}
            {hiddenCount > 0 || showAllQuick ? (
              <button
                type="button"
                aria-expanded={showAllQuick}
                onClick={() => setShowAllQuick(v => !v)}
                className={cn(
                  'inline-flex h-7 items-center rounded-[6px] px-1.5 text-[12.5px] font-medium text-brand-ink hover:underline',
                  FOCUS
                )}
              >
                {showAllQuick ? 'Fewer' : `${hiddenCount} more knockout questions`}
              </button>
            ) : null}
          </div>
        </div>

        {draft.conditions.length ? (
          <div>
            <h4 className="t-label mb-0.5 text-ink-3">Conditions</h4>
            <ul className="divide-y divide-rule rounded-control border border-rule">
              {draft.conditions.map(c => (
                <ConditionRow
                  key={c.key}
                  idPrefix={idPrefix}
                  condition={c}
                  label={byCode.get(c.code)?.label ?? c.code}
                  dispatch={dispatch}
                />
              ))}
            </ul>
          </div>
        ) : null}

        {draft.meds.length ? (
          <div>
            <h4 className="t-label mb-0.5 text-ink-3">Medications</h4>
            <ul className="divide-y divide-rule rounded-control border border-rule">
              {draft.meds.map(med => (
                <MedicationRow
                  key={med.key}
                  idPrefix={idPrefix}
                  med={med}
                  asked={needsIndication.get(med.drugId)}
                  conditionLabel={code => byCode.get(code)?.label ?? code}
                  dispatch={dispatch}
                />
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Section>
  );
}

/** One answered-or-not line: what it is, what was said, and a remove. */
function CompactRow({
  id,
  open,
  onToggle,
  title,
  capitalize = false,
  facts,
  attention,
  removeLabel,
  onRemove,
  onBlurOut,
  children,
}: {
  id: string;
  open: boolean;
  onToggle: () => void;
  title: React.ReactNode;
  /** Drug names arrive lower-case; condition labels are already set. */
  capitalize?: boolean;
  facts: string[];
  /** Still has a question that changes the quote. */
  attention?: string;
  removeLabel: string;
  onRemove: () => void;
  /** Focus left the row (to collapse it once answered). */
  onBlurOut?: () => void;
  children: React.ReactNode;
}): JSX.Element {
  const ref = React.useRef<HTMLLIElement>(null);
  return (
    <li
      ref={ref}
      className={cn('min-w-0', open && 'bg-sunken/50')}
      onBlur={e => {
        if (onBlurOut && !ref.current?.contains(e.relatedTarget as Node | null)) onBlurOut();
      }}
    >
      <div className="flex min-h-[32px] items-center gap-1 pl-2 pr-1">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={onToggle}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-1.5 rounded-[4px] py-1 text-left',
            FOCUS
          )}
        >
          {attention ? (
            <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-ringing" />
          ) : (
            <Check className="h-3 w-3 shrink-0 text-live-ink" aria-hidden />
          )}
          <span className="min-w-0 truncate text-[13px]">
            <span className={cn('font-medium text-ink', capitalize && 'capitalize')}>{title}</span>
            {facts.length ? <span className="text-ink-3"> · {facts.join(' · ')}</span> : null}
            {attention ? <span className="text-ringing-ink"> · {attention}</span> : null}
          </span>
          <ChevronDown
            aria-hidden
            className={cn(
              'ml-auto h-3.5 w-3.5 shrink-0 text-ink-3 transition-transform duration-150 ne-motion motion-reduce:transition-none',
              open && 'rotate-180'
            )}
          />
        </button>
        <button
          type="button"
          aria-label={removeLabel}
          onClick={onRemove}
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] text-ink-3 hover:bg-surface hover:text-dropped-ink',
            FOCUS
          )}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      {open ? (
        <div id={id} className="px-2 pb-2">
          {children}
        </div>
      ) : null}
    </li>
  );
}

function conditionFacts(condition: DraftCondition, fields: readonly DetailField[]): string[] {
  const facts: string[] = [];
  const dx = labelFor(DIAGNOSED_BUCKETS, condition.diagnosedMonthsAgo);
  if (condition.diagnosedMonthsAgo !== undefined && dx) facts.push(`Dx ${briefBucket(dx)}`);
  if (condition.treatedMonthsAgo === 0) facts.push('Treated now');
  else if (condition.treatedMonthsAgo === null) facts.push('Never treated');
  else if (condition.treatedMonthsAgo !== undefined) {
    const tx = labelFor(TREATED_BUCKETS, condition.treatedMonthsAgo);
    if (tx) facts.push(`Tx ${briefBucket(tx)}`);
  }
  for (const field of fields) {
    const value = condition.detail[field.key];
    if (value === undefined || value === '') continue;
    const name = field.label.replace(/\?$/, '');
    if (field.type === 'yesno') facts.push(`${name}: ${value ? 'yes' : 'no'}`);
    else if (field.type === 'select')
      facts.push(field.options.find(([v]) => v === value)?.[1] ?? String(value));
    else if (field.type === 'number') facts.push(`${name} ${value}`);
    else {
      const b = labelFor(DIAGNOSED_BUCKETS, value);
      if (b) facts.push(`${name} ${briefBucket(b)}`);
    }
  }
  if (condition.onMeds) facts.push('On meds');
  return facts;
}

/** Every question the condition asks has an answer ("Not sure" counts once picked). */
function conditionAnswered(condition: DraftCondition, fields: readonly DetailField[]): boolean {
  return (
    condition.diagnosedMonthsAgo !== undefined &&
    condition.treatedMonthsAgo !== undefined &&
    fields.every(f => condition.detail[f.key] !== undefined)
  );
}

function ConditionRow({
  idPrefix,
  condition,
  label,
  dispatch,
}: {
  idPrefix: string;
  condition: DraftCondition;
  label: string;
  dispatch: React.Dispatch<DraftAction>;
}): JSX.Element {
  const p = (s: string) => `${idPrefix}-${condition.key}-${s}`;
  const update = (patch: Partial<DraftCondition>) =>
    dispatch({ type: 'updateCondition', key: condition.key, patch });
  const fields = CONDITION_DETAIL_FIELDS[condition.code] ?? [];
  const answered = conditionAnswered(condition, fields);
  // Open while its questions are being answered; one line once they are and
  // the agent has moved on.
  const [open, setOpen] = React.useState(!answered);

  return (
    <CompactRow
      id={p('detail')}
      open={open}
      onToggle={() => setOpen(o => !o)}
      title={label}
      facts={conditionFacts(condition, fields)}
      attention={answered ? undefined : 'details'}
      removeLabel={`Remove ${label}`}
      onRemove={() => dispatch({ type: 'removeCondition', key: condition.key })}
      onBlurOut={answered ? () => setOpen(false) : undefined}
    >
      <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
        <Field label="Diagnosed" htmlFor={p('dx')}>
          <NativeSelect
            id={p('dx')}
            value={bucketValue(condition.diagnosedMonthsAgo)}
            className="h-8 px-2 pr-6 text-[13px]"
            onChange={e => update({ diagnosedMonthsAgo: bucketFrom(e.target.value) ?? undefined })}
          >
            {DIAGNOSED_BUCKETS.map(([text, months]) => (
              <option key={text} value={bucketValue(months)}>
                {text}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Last treated" htmlFor={p('tx')}>
          <NativeSelect
            id={p('tx')}
            value={bucketValue(condition.treatedMonthsAgo)}
            className="h-8 px-2 pr-6 text-[13px]"
            onChange={e => update({ treatedMonthsAgo: bucketFrom(e.target.value) })}
          >
            {TREATED_BUCKETS.map(([text, months]) => (
              <option key={text} value={bucketValue(months)}>
                {text}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {fields.map(field => (
          <DetailInput
            key={field.key}
            id={p(field.key)}
            field={field}
            condition={condition}
            update={update}
          />
        ))}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <CheckRow
          id={p('meds')}
          checked={condition.onMeds}
          onChange={onMeds => update({ onMeds })}
          className="text-[12.5px]"
        >
          On maintenance medication
        </CheckRow>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className={cn(
            'h-7 rounded-control px-2 text-[12px] font-medium text-brand-ink hover:bg-surface',
            FOCUS
          )}
        >
          Done
        </button>
      </div>
    </CompactRow>
  );
}

function DetailInput({
  id,
  field,
  condition,
  update,
}: {
  id: string;
  field: DetailField;
  condition: DraftCondition;
  update: (patch: Partial<DraftCondition>) => void;
}): JSX.Element {
  const value = condition.detail[field.key];
  const set = (v: string | number | boolean | undefined) =>
    update({ detail: { ...condition.detail, [field.key]: v } });

  if (field.type === 'select') {
    return (
      <Field label={field.label} htmlFor={id} className="col-span-2">
        <NativeSelect
          id={id}
          value={String(value ?? '')}
          className="h-8 px-2 pr-6 text-[13px]"
          onChange={e => set(e.target.value || undefined)}
        >
          {field.options.map(([v, text]) => (
            <option key={v} value={v}>
              {text}
            </option>
          ))}
        </NativeSelect>
      </Field>
    );
  }
  if (field.type === 'yesno') {
    return (
      <Field label={field.label}>
        <ChoiceGroup
          label={field.label}
          className="h-8"
          itemClassName="text-[12px]"
          options={[
            { value: 'unsure', label: 'Unsure', key: 'unsure' },
            { value: 'no', label: 'No', key: 'no' },
            { value: 'yes', label: 'Yes', key: 'yes' },
          ]}
          value={value === true ? 'yes' : value === false ? 'no' : 'unsure'}
          onChange={v => set(v === 'yes' ? true : v === 'no' ? false : undefined)}
        />
      </Field>
    );
  }
  if (field.type === 'number') {
    return (
      <Field label={field.label} htmlFor={id}>
        <TextInput
          id={id}
          inputMode="numeric"
          maxLength={4}
          className="h-8 px-2"
          value={value === undefined ? '' : String(value)}
          onChange={e => {
            const v = digitsOnly(e.target.value);
            set(v ? Number(v) : undefined);
          }}
        />
      </Field>
    );
  }
  return (
    <Field label={field.label} htmlFor={id}>
      <NativeSelect
        id={id}
        value={bucketValue(typeof value === 'number' ? value : undefined)}
        className="h-8 px-2 pr-6 text-[13px]"
        onChange={e => set(bucketFrom(e.target.value) ?? undefined)}
      >
        {DIAGNOSED_BUCKETS.map(([text, months]) => (
          <option key={text} value={bucketValue(months)}>
            {text}
          </option>
        ))}
      </NativeSelect>
    </Field>
  );
}

function MedicationRow({
  idPrefix,
  med,
  asked,
  conditionLabel,
  dispatch,
}: {
  idPrefix: string;
  med: DraftMed;
  /** The use options the last quote asked about, when it did. */
  asked: string[] | undefined;
  conditionLabel: (code: string) => string;
  dispatch: React.Dispatch<DraftAction>;
}): JSX.Element {
  const p = (s: string) => `${idPrefix}-${med.key}-${s}`;
  const options = med.indications?.length
    ? med.indications
    : (asked ?? []).map(code => ({ code, label: conditionLabel(code) }));
  const askUse = (med.multiUse || Boolean(asked)) && options.length > 0;
  const needsUse = askUse && !med.indication;
  // Open while its use is unanswered; otherwise one line, opened on request.
  const [openOverride, setOpenOverride] = React.useState<boolean | null>(null);
  const open = openOverride ?? needsUse;

  const taken =
    med.lastTakenMonthsAgo && med.lastTakenMonthsAgo > 0
      ? labelFor(MED_LAST_TAKEN_BUCKETS, med.lastTakenMonthsAgo)
      : undefined;
  const use = med.indication
    ? (options.find(o => o.code === med.indication)?.label ?? conditionLabel(med.indication))
    : undefined;
  const facts = [use ? shortLabel(use) : null, taken ?? null].filter((f): f is string =>
    Boolean(f)
  );

  return (
    <CompactRow
      id={p('detail')}
      open={open}
      onToggle={() => setOpenOverride(!open)}
      title={med.name}
      capitalize
      facts={facts}
      attention={needsUse ? 'what is it for?' : undefined}
      removeLabel={`Remove ${med.name}`}
      onRemove={() => dispatch({ type: 'removeMed', key: med.key })}
      onBlurOut={needsUse ? undefined : () => setOpenOverride(null)}
    >
      <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
        <Field label="Still taking?" htmlFor={p('taken')}>
          <NativeSelect
            id={p('taken')}
            value={bucketValue(med.lastTakenMonthsAgo ?? 0)}
            className="h-8 px-2 pr-6 text-[13px]"
            onChange={e =>
              dispatch({
                type: 'updateMed',
                key: med.key,
                patch: { lastTakenMonthsAgo: bucketFrom(e.target.value) ?? 0 },
              })
            }
          >
            {MED_LAST_TAKEN_BUCKETS.map(([text, months]) => (
              <option key={text} value={bucketValue(months)}>
                {text}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {askUse ? (
          <Field label="Prescribed for" htmlFor={p('use')}>
            <NativeSelect
              id={p('use')}
              value={med.indication ?? ''}
              aria-invalid={!med.indication}
              onChange={e =>
                dispatch({
                  type: 'updateMed',
                  key: med.key,
                  patch: { indication: e.target.value || undefined },
                })
              }
              className={cn('h-8 px-2 pr-6 text-[13px]', !med.indication && 'border-ringing')}
            >
              <option value="">Choose a use…</option>
              {options.map(o => (
                <option key={o.code} value={o.code}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}
      </div>
      {needsUse ? (
        <p className="t-meta mt-1 text-ringing-ink">
          Until answered, each carrier applies the strictest listed use.
        </p>
      ) : null}
    </CompactRow>
  );
}
