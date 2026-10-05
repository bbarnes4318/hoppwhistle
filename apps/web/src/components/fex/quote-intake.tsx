'use client';

/**
 * The quoter's left column: who, how much, and their health.
 *
 * Four panels, in the order an agent asks: the applicant, the coverage, the
 * health history (knockout questions first), and medications. Every edit
 * re-quotes; nothing here waits for a button.
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
import { Check, Plus, RotateCcw, X } from 'lucide-react';
import * as React from 'react';

import { Panel, Segmented, SegmentedItem } from '@/components/domain';
import { fexApi, type FexDrugHit } from '@/lib/fex/api';
import { searchConditions } from '@/lib/fex/condition-search';
import {
  ageFromDob,
  missingForQuote,
  type DraftAction,
  type DraftCondition,
  type QuoteDraft,
} from '@/lib/fex/draft';
import { US_STATES } from '@/lib/us-states';
import { cn } from '@/lib/utils';

import { Combobox } from './combobox';
import {
  bucketFrom,
  bucketValue,
  CheckRow,
  Field,
  FOCUS,
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

const STATE_NAME = new Map<string, string>([
  ...US_STATES.map(s => [s.value, s.label] as [string, string]),
  ['DC', 'District of Columbia'],
]);

const digitsOnly = (v: string) => v.replace(/[^0-9]/g, '');

const applicantDone = (d: QuoteDraft) => {
  const m = missingForQuote(d);
  return m !== 'state' && m !== 'sex' && m !== 'age' && m !== 'dob';
};
const coverageDone = (d: QuoteDraft) => {
  const n = Number((d.coverage.mode === 'face' ? d.coverage.face : d.coverage.budget) || NaN);
  return d.coverage.mode === 'face' ? n >= 1000 && n <= 500000 : n >= 5 && n <= 2000;
};
const healthSummary = (d: QuoteDraft) =>
  d.conditions.length
    ? `${d.conditions.length} condition${d.conditions.length === 1 ? '' : 's'}`
    : 'None entered';
const medsSummary = (d: QuoteDraft) =>
  d.meds.length ? `${d.meds.length} medication${d.meds.length === 1 ? '' : 's'}` : 'None entered';

/**
 * One card, four numbered steps. The two that must be answered before a quote
 * runs show a check when done; health and medications are optional and say
 * what has been entered.
 */
export function QuoteIntake(props: QuoteIntakeProps): JSX.Element {
  const required = [applicantDone(props.draft), coverageDone(props.draft)];
  const done = required.filter(Boolean).length;
  return (
    <Panel className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-rule px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink">Quote details</h2>
          <div className="mt-1.5 flex items-center gap-2">
            <span
              className="h-1.5 w-24 overflow-hidden rounded-full bg-sunken"
              role="progressbar"
              aria-label="Required answers"
              aria-valuemin={0}
              aria-valuemax={2}
              aria-valuenow={done}
            >
              <span
                className="block h-full rounded-full bg-brand transition-[width] duration-300 ne-motion"
                style={{ width: `${(done / 2) * 100}%` }}
              />
            </span>
            <span className="t-meta text-ink-3">
              {done === 2 ? 'Ready — quoting live' : `${done} of 2 required steps`}
            </span>
          </div>
        </div>
        {props.onReset ? (
          <button
            type="button"
            onClick={props.onReset}
            className={cn(
              't-meta inline-flex shrink-0 items-center gap-1 rounded-control px-2 py-1 text-ink-2 hover:bg-sunken hover:text-ink',
              FOCUS
            )}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            New quote
          </button>
        ) : null}
      </div>
      <div className="divide-y divide-rule">
        <ApplicantPanel {...props} />
        <CoveragePanel {...props} />
        <HealthPanel {...props} />
        <MedicationsPanel {...props} />
      </div>
    </Panel>
  );
}

function Step({
  n,
  title,
  done,
  optional,
  summary,
  hint,
  children,
}: {
  n: number;
  title: string;
  done?: boolean;
  optional?: boolean;
  summary?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}): JSX.Element {
  const id = React.useId();
  return (
    <section aria-labelledby={id} className="px-4 py-4">
      <div className="mb-3 flex items-start gap-2.5">
        <span
          aria-hidden
          className={cn(
            'mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors duration-200 ne-motion',
            done ? 'bg-brand text-surface' : 'bg-sunken text-ink-2'
          )}
        >
          {done ? <Check className="h-3.5 w-3.5" /> : n}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <h3 id={id} className="text-sm font-semibold text-ink">
              {title}
            </h3>
            {optional ? (
              <span className="t-meta shrink-0 text-ink-3">{summary ?? 'Optional'}</span>
            ) : null}
          </div>
          {hint ? <p className="t-meta mt-0.5 text-ink-3">{hint}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

// ─── Applicant ───────────────────────────────────────────────────────────────

function ApplicantPanel({ idPrefix, draft, dispatch }: QuoteIntakeProps): JSX.Element {
  const p = (s: string) => `${idPrefix}-${s}`;
  const lead = (f: Parameters<QuoteDraft['prefilled']['has']>[0]) => draft.prefilled.has(f);
  const dobAge = draft.ageOrDob.mode === 'dob' ? ageFromDob(draft.ageOrDob.dob) : null;

  return (
    <Step n={1} title="Applicant" done={applicantDone(draft)}>
      <div className="grid grid-cols-2 gap-x-3 gap-y-4">
        <Field label="State" htmlFor={p('state')} fromLead={lead('state')}>
          <NativeSelect
            id={p('state')}
            value={draft.state}
            onChange={e =>
              dispatch({ type: 'set', patch: { state: e.target.value }, fields: ['state'] })
            }
          >
            <option value="">Select…</option>
            {STATES.map(code => (
              <option key={code} value={code}>
                {code} · {STATE_NAME.get(code) ?? code}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field label="Sex" fromLead={lead('sex')}>
          <Segmented role="radiogroup" aria-label="Sex" className="w-full">
            {(
              [
                ['F', 'Female'],
                ['M', 'Male'],
              ] as const
            ).map(([value, label]) => (
              <SegmentedItem
                key={value}
                role="radio"
                aria-checked={draft.sex === value}
                active={draft.sex === value}
                className="flex-1"
                onClick={() => dispatch({ type: 'set', patch: { sex: value }, fields: ['sex'] })}
              >
                {label}
              </SegmentedItem>
            ))}
          </Segmented>
        </Field>

        <div className="col-span-2">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <label
              htmlFor={draft.ageOrDob.mode === 'age' ? p('age') : p('dob')}
              className="t-label flex items-baseline text-ink-2"
            >
              {draft.ageOrDob.mode === 'age' ? 'Age' : 'Date of birth'}
              {lead(draft.ageOrDob.mode) ? (
                <span className="t-meta ml-1.5 font-normal text-ink-3">From lead</span>
              ) : null}
            </label>
            <button
              type="button"
              className={cn('t-meta rounded-control px-1 text-brand-ink hover:underline', FOCUS)}
              onClick={() =>
                dispatch({
                  type: 'set',
                  patch: {
                    ageOrDob:
                      draft.ageOrDob.mode === 'age'
                        ? { mode: 'dob', dob: '' }
                        : {
                            mode: 'age',
                            age: dobAge !== null ? String(dobAge) : '',
                          },
                  },
                  fields: ['age', 'dob'],
                })
              }
            >
              {draft.ageOrDob.mode === 'age' ? 'Use date of birth' : 'Use age'}
            </button>
          </div>
          {draft.ageOrDob.mode === 'age' ? (
            <TextInput
              id={p('age')}
              inputMode="numeric"
              maxLength={3}
              placeholder="65"
              value={draft.ageOrDob.age}
              onChange={e =>
                dispatch({
                  type: 'set',
                  patch: { ageOrDob: { mode: 'age', age: digitsOnly(e.target.value) } },
                  fields: ['age'],
                })
              }
            />
          ) : (
            <div className="flex items-center gap-3">
              <TextInput
                id={p('dob')}
                type="date"
                value={draft.ageOrDob.dob}
                onChange={e =>
                  dispatch({
                    type: 'set',
                    patch: { ageOrDob: { mode: 'dob', dob: e.target.value } },
                    fields: ['dob'],
                  })
                }
              />
              <span className="t-meta shrink-0 tabular-nums text-ink-2" aria-live="polite">
                {dobAge !== null ? `Age ${dobAge}` : ''}
              </span>
            </div>
          )}
        </div>

        <Field
          label="Tobacco or nicotine in the last 12 months"
          className="col-span-2"
          fromLead={lead('tobacco')}
        >
          <Segmented
            role="radiogroup"
            aria-label="Tobacco or nicotine in the last 12 months"
            className="w-full"
          >
            {(
              [
                [false, 'No'],
                [true, 'Yes'],
              ] as const
            ).map(([value, label]) => (
              <SegmentedItem
                key={label}
                role="radio"
                aria-checked={draft.tobacco === value}
                active={draft.tobacco === value}
                className="flex-1"
                onClick={() =>
                  dispatch({ type: 'set', patch: { tobacco: value }, fields: ['tobacco'] })
                }
              >
                {label}
              </SegmentedItem>
            ))}
          </Segmented>
        </Field>

        <Field label="Height" htmlFor={p('ft')} fromLead={lead('height')}>
          <div className="grid grid-cols-2 gap-2">
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
                className="pr-7"
              />
              <span
                aria-hidden
                className="t-meta pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3"
              >
                ft
              </span>
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
                className="pr-7"
              />
              <span
                aria-hidden
                className="t-meta pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3"
              >
                in
              </span>
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
              className="pr-8"
            />
            <span
              aria-hidden
              className="t-meta pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3"
            >
              lb
            </span>
          </div>
        </Field>
      </div>
    </Step>
  );
}

// ─── Coverage ────────────────────────────────────────────────────────────────

function CoveragePanel({
  idPrefix,
  draft,
  dispatch,
  showAetnaMedSupp,
}: QuoteIntakeProps): JSX.Element {
  const p = (s: string) => `${idPrefix}-${s}`;
  const face = draft.coverage.mode === 'face' ? draft.coverage.face : '';
  const customFace = face && !FACE_PRESETS.includes(Number(face)) ? face : '';

  return (
    <Step n={2} title="Coverage" done={coverageDone(draft)}>
      <div className="space-y-4">
        <Segmented role="radiogroup" aria-label="Quote by" className="w-full">
          <SegmentedItem
            role="radio"
            aria-checked={draft.coverage.mode === 'face'}
            active={draft.coverage.mode === 'face'}
            className="flex-1"
            onClick={() =>
              draft.coverage.mode !== 'face' &&
              dispatch({ type: 'set', patch: { coverage: { mode: 'face', face: '10000' } } })
            }
          >
            Face amount
          </SegmentedItem>
          <SegmentedItem
            role="radio"
            aria-checked={draft.coverage.mode === 'budget'}
            active={draft.coverage.mode === 'budget'}
            className="flex-1"
            onClick={() =>
              draft.coverage.mode !== 'budget' &&
              dispatch({
                type: 'set',
                patch: { coverage: { mode: 'budget', budget: '' } },
                fields: ['face'],
              })
            }
          >
            Monthly budget
          </SegmentedItem>
        </Segmented>

        {draft.coverage.mode === 'face' ? (
          <div>
            <p className="t-label mb-1.5 flex items-baseline text-ink-2" id={p('face-label')}>
              Face amount
              {draft.prefilled.has('face') ? (
                <span className="t-meta ml-1.5 font-normal text-ink-3">From lead</span>
              ) : null}
            </p>
            <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby={p('face-label')}>
              {FACE_PRESETS.map(amount => {
                const on = Number(face) === amount;
                return (
                  <button
                    key={amount}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      dispatch({
                        type: 'set',
                        patch: { coverage: { mode: 'face', face: String(amount) } },
                        fields: ['face'],
                      })
                    }
                    className={cn(
                      'h-8 rounded-control border px-2.5 text-sm font-medium tabular-nums transition-colors duration-150 ne-motion',
                      on
                        ? 'border-brand-ink bg-brand-tint text-brand-ink'
                        : 'border-rule-strong bg-surface text-ink-2 hover:bg-sunken hover:text-ink',
                      FOCUS
                    )}
                  >
                    ${amount / 1000}k
                  </button>
                );
              })}
            </div>
            <div className="relative mt-2">
              <span
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-3"
              >
                $
              </span>
              <TextInput
                inputMode="numeric"
                aria-label="Custom face amount"
                placeholder="Other amount"
                value={customFace ? Number(customFace).toLocaleString('en-US') : ''}
                onChange={e => {
                  const v = digitsOnly(e.target.value).slice(0, 6);
                  dispatch({
                    type: 'set',
                    patch: { coverage: { mode: 'face', face: v || '' } },
                    fields: ['face'],
                  });
                }}
                className="pl-6"
              />
            </div>
          </div>
        ) : (
          <Field
            label="Monthly budget"
            htmlFor={p('budget')}
            hint="Each carrier shows the largest face that fits the budget."
          >
            <div className="relative">
              <span
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-3"
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

        <Field label="Payment" htmlFor={p('mode')}>
          <NativeSelect
            id={p('mode')}
            value={draft.paymentMode}
            onChange={e =>
              dispatch({ type: 'set', patch: { paymentMode: e.target.value as PaymentMode } })
            }
          >
            {PAYMENT_MODES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <div className="space-y-2.5">
          <CheckRow
            id={p('activity')}
            checked={draft.activityCredit}
            onChange={checked => dispatch({ type: 'set', patch: { activityCredit: checked } })}
          >
            Exercises 3+ days a week
            <span className="t-meta block text-ink-3">Transamerica activity credit</span>
          </CheckRow>
          {showAetnaMedSupp ? (
            <CheckRow
              id={p('medsupp')}
              checked={draft.aetnaMedSupp}
              onChange={checked => dispatch({ type: 'set', patch: { aetnaMedSupp: checked } })}
            >
              Has a qualifying Aetna/CVS Medicare Supplement
            </CheckRow>
          ) : null}
        </div>
      </div>
    </Step>
  );
}

// ─── Health history ──────────────────────────────────────────────────────────

function HealthPanel({ idPrefix, draft, dispatch, conditions }: QuoteIntakeProps): JSX.Element {
  const [query, setQuery] = React.useState('');
  const byCode = React.useMemo(() => new Map(conditions.map(c => [c.code, c])), [conditions]);
  const added = new Set(draft.conditions.map(c => c.code));
  const matches = React.useMemo(
    () => searchConditions(conditions, query, 12).filter(c => !added.has(c.code)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conditions, query, draft.conditions]
  );
  const quick = QUICK_CONDITIONS.filter(code => byCode.has(code));

  return (
    <Step
      n={3}
      title="Health history"
      optional
      summary={healthSummary(draft)}
      hint={
        <>
          Last treated means the last surgery, procedure, hospital stay or treatment change. Each
          carrier&apos;s own questions decide the result.
        </>
      }
    >
      <div className="space-y-4">
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
                  'inline-flex min-h-[28px] items-center gap-1 rounded-[14px] border px-2.5 py-1 text-left text-xs leading-snug font-medium transition-colors duration-150 ne-motion',
                  on
                    ? 'border-dropped bg-dropped-tint text-dropped-ink'
                    : 'border-rule-strong bg-surface text-ink-2 hover:bg-sunken hover:text-ink',
                  FOCUS
                )}
              >
                {on ? (
                  <X className="h-3 w-3 shrink-0" aria-hidden />
                ) : (
                  <Plus className="h-3 w-3 shrink-0" aria-hidden />
                )}
                {shortLabel(byCode.get(code)!.label)}
              </button>
            );
          })}
        </div>

        <Combobox
          id={`${idPrefix}-condition`}
          label="Add a condition"
          query={query}
          onQueryChange={setQuery}
          placeholder="Search conditions: diabetes, stent, COPD…"
          options={matches.map(c => ({ id: c.code, label: c.label, meta: c.category }))}
          onPick={code => dispatch({ type: 'addCondition', code })}
          emptyText="No condition by that name"
        />

        {draft.conditions.length ? (
          <ul className="space-y-2.5">
            {draft.conditions.map(c => (
              <ConditionCard
                key={c.key}
                idPrefix={idPrefix}
                condition={c}
                label={byCode.get(c.code)?.label ?? c.code}
                dispatch={dispatch}
              />
            ))}
          </ul>
        ) : (
          <p className="t-meta text-ink-3">
            No conditions added. A clean history quotes best class.
          </p>
        )}
      </div>
    </Step>
  );
}

function ConditionCard({
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

  return (
    <li className="rounded-card border border-rule bg-sunken/60 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-ink">{label}</p>
        <button
          type="button"
          aria-label={`Remove ${label}`}
          onClick={() => dispatch({ type: 'removeCondition', key: condition.key })}
          className={cn(
            '-mr-1 -mt-0.5 rounded-control p-1 text-ink-3 hover:bg-surface hover:text-ink',
            FOCUS
          )}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <div className="mt-2 grid grid-cols-1 gap-2.5 min-[420px]:grid-cols-2">
        <Field label="Diagnosed / happened" htmlFor={p('dx')}>
          <NativeSelect
            id={p('dx')}
            value={bucketValue(condition.diagnosedMonthsAgo)}
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
      <CheckRow
        id={p('meds')}
        checked={condition.onMeds}
        onChange={onMeds => update({ onMeds })}
        className="mt-2.5"
      >
        On maintenance medication
      </CheckRow>
    </li>
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
      <Field label={field.label} htmlFor={id}>
        <NativeSelect
          id={id}
          value={String(value ?? '')}
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
        <Segmented role="radiogroup" aria-label={field.label} className="w-full">
          {(
            [
              [undefined, 'Not sure'],
              [false, 'No'],
              [true, 'Yes'],
            ] as const
          ).map(([v, text]) => (
            <SegmentedItem
              key={text}
              role="radio"
              aria-checked={value === v}
              active={value === v}
              className="flex-1 px-2"
              onClick={() => set(v)}
            >
              {text}
            </SegmentedItem>
          ))}
        </Segmented>
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

// ─── Medications ─────────────────────────────────────────────────────────────

function MedicationsPanel({
  idPrefix,
  draft,
  dispatch,
  conditions,
  needsIndication,
}: QuoteIntakeProps): JSX.Element {
  const [query, setQuery] = React.useState('');
  const [hits, setHits] = React.useState<FexDrugHit[]>([]);
  const [searching, setSearching] = React.useState(false);
  const labelOf = React.useMemo(
    () => new Map(conditions.map(c => [c.code, c.label])),
    [conditions]
  );

  React.useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    const timer = setTimeout(() => {
      void fexApi.searchDrugs(q, 10, controller.signal).then(result => {
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

  const added = new Set(draft.meds.map(m => m.drugId));
  const options = hits
    .filter(h => !added.has(h.id))
    .map(h => ({
      id: h.id,
      label: (
        <>
          <span className="capitalize">{h.generic}</span>
          {h.brands.length ? <span className="text-ink-2"> · {h.brands.join(', ')}</span> : null}
        </>
      ),
      meta: h.drugClass ?? undefined,
    }));

  return (
    <Step n={4} title="Medications" optional summary={medsSummary(draft)}>
      <div className="space-y-4">
        <Combobox
          id={`${idPrefix}-drug`}
          label="Add a medication"
          query={query}
          onQueryChange={setQuery}
          placeholder="Brand or generic: Eliquis, metformin…"
          options={options}
          minChars={2}
          loading={searching}
          emptyText="No medication by that name"
          onPick={id => {
            const hit = hits.find(h => h.id === id);
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
          }}
        />
        {draft.meds.length ? (
          <ul className="space-y-2.5">
            {draft.meds.map(med => {
              const p = (s: string) => `${idPrefix}-${med.key}-${s}`;
              const asked = needsIndication.get(med.drugId);
              const options = med.indications?.length
                ? med.indications
                : (asked ?? []).map(code => ({ code, label: labelOf.get(code) ?? code }));
              const askUse = (med.multiUse || Boolean(asked)) && options.length > 0;
              return (
                <li key={med.key} className="rounded-card border border-rule bg-sunken/60 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium capitalize text-ink">{med.name}</p>
                    <button
                      type="button"
                      aria-label={`Remove ${med.name}`}
                      onClick={() => dispatch({ type: 'removeMed', key: med.key })}
                      className={cn(
                        '-mr-1 -mt-0.5 rounded-control p-1 text-ink-3 hover:bg-surface hover:text-ink',
                        FOCUS
                      )}
                    >
                      <X className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                  <div className="mt-2 grid grid-cols-1 gap-2.5 min-[420px]:grid-cols-2">
                    <Field label="Still taking?" htmlFor={p('taken')}>
                      <NativeSelect
                        id={p('taken')}
                        value={bucketValue(med.lastTakenMonthsAgo ?? 0)}
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
                      <Field label="What is it prescribed for?" htmlFor={p('use')}>
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
                          className={cn(!med.indication && 'border-ringing')}
                        >
                          <option value="">Choose a use…</option>
                          {options.map(o => (
                            <option key={o.code} value={o.code}>
                              {o.label}
                            </option>
                          ))}
                        </NativeSelect>
                        {!med.indication ? (
                          <p className="t-meta mt-1 text-ringing-ink">
                            Until answered, each carrier applies the strictest listed use.
                          </p>
                        ) : null}
                      </Field>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="t-meta text-ink-3">No medications added.</p>
        )}
      </div>
    </Step>
  );
}
