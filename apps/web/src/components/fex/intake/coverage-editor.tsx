'use client';

/**
 * How much, and how it is paid: face presets (or a monthly budget), the
 * payment mode, and the two optional credits that change a carrier's price.
 */

import { FACE_PRESETS, PAYMENT_MODES } from '@hopwhistle/fex-engine/catalog';
import type { PaymentMode } from '@hopwhistle/fex-engine/types';
import { ChevronDown } from 'lucide-react';
import * as React from 'react';

import type { DraftAction, QuoteDraft } from '@/lib/fex/draft';
import { paymentShort } from '@/lib/fex/intake-status';
import { cn } from '@/lib/utils';

import { CheckRow, ChoiceGroup, FIELD_LABEL, FOCUS, FromLeadTag, TextInput } from '../parts';

import { digitsOnly } from './applicant-editor';

const faceText = (amount: number) =>
  amount % 1000 === 0 ? `${amount / 1000}k` : `${(amount / 1000).toFixed(1)}k`;

/**
 * Face amount or monthly budget: the section's own switch, in its title row,
 * so what is being quoted is said before the amount is.
 */
export function CoverageModeSwitch({
  draft,
  dispatch,
}: {
  draft: QuoteDraft;
  dispatch: React.Dispatch<DraftAction>;
}): JSX.Element {
  return (
    <ChoiceGroup
      label="Quote by"
      className="h-8 w-[204px] p-[2px]"
      itemClassName="px-2 text-[12px]"
      options={[
        { value: 'face' as const, label: 'Face amount' },
        { value: 'budget' as const, label: 'Monthly budget' },
      ]}
      value={draft.coverage.mode}
      onChange={mode => {
        if (mode === draft.coverage.mode) return;
        if (mode === 'face')
          dispatch({ type: 'set', patch: { coverage: { mode: 'face', face: '10000' } } });
        else
          dispatch({
            type: 'set',
            patch: { coverage: { mode: 'budget', budget: '' } },
            fields: ['face'],
          });
      }}
    />
  );
}

export function CoverageEditor({
  idPrefix,
  draft,
  dispatch,
  showAetnaMedSupp,
  invalid,
}: {
  idPrefix: string;
  draft: QuoteDraft;
  dispatch: React.Dispatch<DraftAction>;
  showAetnaMedSupp: boolean;
  /** Required fields to mark (after Get quotes was pressed without them). */
  invalid?: ReadonlySet<string>;
}): JSX.Element {
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
    <div className="space-y-3">
      {draft.coverage.mode === 'face' ? (
        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <p id={labelId} className={cn(FIELD_LABEL, 'mb-0')}>
              Face amount
              {draft.prefilled.has('face') ? <FromLeadTag /> : null}
            </p>
            {Number(face) ? (
              <span className="text-[17px] font-bold tabular-nums tracking-[-0.01em] text-ink">
                ${Number(face).toLocaleString('en-US')}
              </span>
            ) : null}
          </div>
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
          {invalid?.has('face') ? (
            <p className="mt-1 text-[11.5px] font-medium text-dropped-ink">
              A face amount from $1,000 to $500,000
            </p>
          ) : null}
        </div>
      ) : (
        <div>
          <label htmlFor={p('budget')} className={FIELD_LABEL}>
            Monthly budget
          </label>
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
              aria-invalid={invalid?.has('budget') || undefined}
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
              className="h-11 pl-6 text-[17px] font-bold"
            />
          </div>
          {invalid?.has('budget') ? (
            <p className="mt-1 text-[11.5px] font-medium text-dropped-ink">$5–$2,000 a month</p>
          ) : null}
        </div>
      )}

      {/* Payment mode and the optional credits share one row: they matter
          less than the amount, and a row of their own each would be height
          the health questions need. */}
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
        <span className="inline-flex items-center gap-2">
          <label htmlFor={p('mode')} className="text-[12px] font-medium text-ink-2">
            Payment
          </label>
          <span className="relative inline-flex items-center">
            <select
              id={p('mode')}
              value={draft.paymentMode}
              title={paymentLabel}
              onChange={e =>
                dispatch({ type: 'set', patch: { paymentMode: e.target.value as PaymentMode } })
              }
              className={cn(
                'h-8 cursor-pointer appearance-none rounded-control border border-rule-strong bg-surface pl-2.5 pr-7 text-[13px] font-medium text-ink hover:border-ink-3',
                FOCUS
              )}
            >
              {PAYMENT_MODES.map(([value, label]) => (
                <option key={value} value={value} title={label}>
                  {paymentShort(value)}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-2 h-3.5 w-3.5 text-ink-3"
              aria-hidden
            />
          </span>
        </span>
        <CheckRow
          id={p('activity')}
          checked={draft.activityCredit}
          onChange={checked => dispatch({ type: 'set', patch: { activityCredit: checked } })}
          className="text-[12.5px] text-ink-2"
        >
          <span title="Transamerica activity credit">Exercises 3+/wk</span>
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
  );
}
