'use client';

/**
 * The applicant's controls: two rows of three, in the order an agent asks --
 * where, who, how old; then tobacco, height and weight.
 */

import { STATES } from '@hopwhistle/fex-engine/catalog';
import * as React from 'react';

import { ageFromDob, type DraftAction, type QuoteDraft } from '@/lib/fex/draft';
import { US_STATES } from '@/lib/us-states';
import { cn } from '@/lib/utils';

import {
  ChoiceGroup,
  Field,
  FIELD_LABEL,
  FOCUS,
  FromLeadTag,
  NativeSelect,
  TextInput,
} from '../parts';

const STATE_NAME = new Map<string, string>([
  ...US_STATES.map(s => [s.value, s.label] as [string, string]),
  ['DC', 'District of Columbia'],
]);

export const digitsOnly = (v: string): string => v.replace(/[^0-9]/g, '');

function Unit({ children }: { children: string }): JSX.Element {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-ink-3"
    >
      {children}
    </span>
  );
}

/** Said under a required field the agent tried to quote without. */
const REQUIRED = 'Required to quote';

export function ApplicantEditor({
  idPrefix,
  draft,
  dispatch,
  invalid,
}: {
  idPrefix: string;
  draft: QuoteDraft;
  dispatch: React.Dispatch<DraftAction>;
  /** Required fields to mark (after Get quotes was pressed without them). */
  invalid?: ReadonlySet<string>;
}): JSX.Element {
  const bad = (field: string) => Boolean(invalid?.has(field));
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

  return (
    <div className="grid grid-cols-3 gap-x-3 gap-y-3">
      <Field
        label="State"
        htmlFor={p('state')}
        fromLead={lead('state')}
        error={bad('state') ? REQUIRED : null}
      >
        <NativeSelect
          id={p('state')}
          value={draft.state}
          aria-invalid={bad('state') || undefined}
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

      <Field label="Sex" fromLead={lead('sex')} error={bad('sex') ? REQUIRED : null}>
        <ChoiceGroup
          className={bad('sex') ? 'ring-1 ring-dropped' : undefined}
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
                aria-invalid={bad('dob') || undefined}
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
              aria-invalid={bad('age') || undefined}
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
        {bad('age') || bad('dob') ? (
          <p className="mt-1 text-[11.5px] font-medium leading-4 text-dropped-ink">
            {dobMode ? 'A date of birth, age 18–100' : 'Age 18–100'}
          </p>
        ) : null}
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
            <Unit>ft</Unit>
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
            <Unit>in</Unit>
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
          <Unit>lb</Unit>
        </div>
      </Field>
    </div>
  );
}
