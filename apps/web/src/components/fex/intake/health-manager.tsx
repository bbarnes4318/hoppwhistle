'use client';

/**
 * Health: the conditions the prospect has, and each one's questions.
 *
 * ── Picking a condition IS answering its questions ──────────────────────────
 *
 * Search (or tap a common condition), and that condition's row opens with
 * its questions directly under it -- in the same place the agent was
 * looking, cursor in the first one, opened into view. Done (or Escape) folds
 * it back to one line ("Dx 1–2 yrs · Treated now") with the cursor in the
 * search for the next answer. A condition with unanswered questions says so
 * on its own row ("2 answers needed · Answer"), and only that condition's
 * questions open when it is clicked. One open at a time, so nothing grows
 * downward as conditions pile up.
 */

import {
  DIAGNOSED_BUCKETS,
  QUICK_CONDITIONS,
  TREATED_BUCKETS,
  type DetailField,
} from '@hopwhistle/fex-engine/catalog';
import { Check, Pill, Plus } from 'lucide-react';
import * as React from 'react';

import { searchConditions } from '@/lib/fex/condition-search';
import { newKey, type DraftAction, type DraftCondition, type QuoteDraft } from '@/lib/fex/draft';
import {
  conditionComplete,
  conditionFacts,
  detailFields,
  detailsNeededText,
  medConditionCodes,
  medShortName,
  unansweredQuestions,
} from '@/lib/fex/intake-status';
import { cn } from '@/lib/utils';

import { Combobox, type ComboOption } from '../combobox';
import {
  bucketFrom,
  bucketValue,
  CheckRow,
  ChoiceGroup,
  Field,
  FOCUS,
  NativeSelect,
  shortLabel,
  TextInput,
} from '../parts';

import { digitsOnly } from './applicant-editor';
import { ItemRow } from './items';

export interface ConditionMeta {
  code: string;
  label: string;
  category: string;
}

/** The id of the condition search box, for the workspace's Alt+H. */
export const healthSearchId = (idPrefix: string): string => `${idPrefix}-health`;

/** The conditions agents hear most, shown as one-tap chips ahead of the rest. */
const FEATURED_CONDITIONS: readonly string[] = ['DIABETES', 'DIABETES_INSULIN', 'COPD', 'CHF'];

/** How agents say the longest common conditions, on their chips. */
const CHIP_NAME: Record<string, string> = { CHF: 'CHF', HEART_ATTACK: 'Heart attack' };

/** How long a just-added or just-answered row stays marked. */
const FLASH_MS = 1600;

export function HealthManager({
  idPrefix,
  draft,
  dispatch,
  conditions,
  item,
  onItem,
}: {
  idPrefix: string;
  draft: QuoteDraft;
  dispatch: React.Dispatch<DraftAction>;
  conditions: ConditionMeta[];
  /** The condition whose questions are open, by key; null shows the list. */
  item: string | null;
  onItem: (key: string | null) => void;
}): JSX.Element {
  const byCode = React.useMemo(() => new Map(conditions.map(c => [c.code, c])), [conditions]);
  const labelOf = (code: string) => byCode.get(code)?.label ?? code;
  const open = item ? draft.conditions.find(c => c.key === item) : undefined;

  // Back from a condition: the cursor returns to the search, ready for the
  // next thing the prospect says, and the row just answered is marked.
  const [flash, setFlash] = React.useState<string | null>(null);
  const previous = React.useRef(item);
  React.useEffect(() => {
    const was = previous.current;
    previous.current = item;
    if (was && !item) {
      setFlash(was);
      requestAnimationFrame(() => document.getElementById(healthSearchId(idPrefix))?.focus());
    }
  }, [item, idPrefix]);
  React.useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(t);
  }, [flash]);

  // A condition removed while open (from elsewhere) closes its editor.
  React.useEffect(() => {
    if (item && !open) onItem(null);
  }, [item, open, onItem]);

  const add = (code: string) => {
    const existing = draft.conditions.find(c => c.code === code);
    if (existing) {
      onItem(existing.key);
      return;
    }
    const key = newKey('c');
    dispatch({ type: 'addCondition', code, key });
    onItem(key);
  };

  return (
    <ConditionList
      idPrefix={idPrefix}
      draft={draft}
      dispatch={dispatch}
      conditions={conditions}
      byCode={byCode}
      flash={flash}
      onAdd={add}
      openKey={open?.key ?? null}
      onEdit={key => onItem(item === key ? null : key)}
      renderEditor={c => (
        <ConditionEditor
          key={c.key}
          idPrefix={idPrefix}
          condition={c}
          label={labelOf(c.code)}
          meds={draft.meds.filter(m => medConditionCodes(m).includes(c.code)).map(m => m.name)}
          dispatch={dispatch}
          onBack={() => onItem(null)}
        />
      )}
    />
  );
}

// ─── The list: search, common conditions, what was added ─────────────────────

function ConditionList({
  idPrefix,
  draft,
  dispatch,
  conditions,
  byCode,
  flash,
  onAdd,
  openKey,
  onEdit,
  renderEditor,
}: {
  idPrefix: string;
  draft: QuoteDraft;
  dispatch: React.Dispatch<DraftAction>;
  conditions: ConditionMeta[];
  byCode: Map<string, ConditionMeta>;
  flash: string | null;
  onAdd: (code: string) => void;
  /** The condition whose questions are open under its row. */
  openKey: string | null;
  onEdit: (key: string) => void;
  renderEditor: (condition: DraftCondition) => React.ReactNode;
}): JSX.Element {
  const [query, setQuery] = React.useState('');
  const added = React.useMemo(() => new Set(draft.conditions.map(c => c.code)), [draft.conditions]);
  const matches = React.useMemo(
    () => searchConditions(conditions, query, 10).filter(c => !added.has(c.code)),
    [conditions, query, added]
  );
  const options: ComboOption[] = matches.map(c => ({
    id: c.code,
    label: c.label,
    meta: c.category,
  }));

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
    if (CHIP_NAME[code]) return CHIP_NAME[code];
    const label = byCode.get(code)!.label;
    const short = shortLabel(label);
    const clash = quick.some(
      other => other !== code && shortLabel(byCode.get(other)!.label) === short
    );
    return clash ? label : short;
  };

  const medsFor = (code: string) =>
    draft.meds.filter(m => medConditionCodes(m).includes(code)).map(m => medShortName(m.name));

  return (
    <div className="space-y-2.5">
      <Combobox
        id={healthSearchId(idPrefix)}
        inputClassName="h-10 text-[14px]"
        label="Add a condition"
        hideLabel
        query={query}
        onQueryChange={setQuery}
        placeholder="Search conditions…"
        options={options}
        onPick={onAdd}
        shortcut="Alt+H"
        emptyText="No condition by that name"
      />

      <div className="flex flex-wrap gap-1" role="group" aria-label="Common knockout conditions">
        {quick.map(code => {
          const on = added.has(code);
          const name = byCode.get(code)!.label;
          return (
            <button
              key={code}
              type="button"
              // Added: the chip opens its questions (removing is the row's ×,
              // never a stray tap on a chip).
              aria-label={on ? `${name}, added — open its questions` : `Add ${name}`}
              onClick={() => onAdd(code)}
              className={cn(
                'inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[12.5px] font-medium leading-none transition-colors duration-150 ne-motion [@media(pointer:coarse)]:min-h-[36px]',
                on
                  ? 'border-brand-ink/40 bg-brand-tint text-brand-ink'
                  : 'border-rule-strong bg-surface text-ink-2 hover:border-ink-3 hover:text-ink',
                FOCUS
              )}
            >
              {on ? (
                <Check className="-ml-0.5 h-3 w-3 shrink-0" aria-hidden />
              ) : (
                <Plus className="-ml-1 h-3 w-3 shrink-0 text-ink-3" aria-hidden />
              )}
              {chipLabel(code)}
            </button>
          );
        })}
        {hiddenCount > 0 || showAllQuick ? (
          <button
            type="button"
            aria-expanded={showAllQuick}
            aria-label={
              showAllQuick ? 'Fewer knockout questions' : `${hiddenCount} more knockout questions`
            }
            onClick={() => setShowAllQuick(v => !v)}
            className={cn(
              'inline-flex h-7 items-center rounded-full px-1.5 text-[12.5px] font-semibold text-brand-ink hover:underline',
              FOCUS
            )}
          >
            {showAllQuick ? 'Fewer' : `+${hiddenCount}`}
          </button>
        ) : null}
      </div>

      {draft.conditions.length ? (
        <ul
          aria-label="Selected conditions"
          className="divide-y divide-rule overflow-hidden rounded-[10px] border border-rule"
        >
          {draft.conditions.map(c => {
            const complete = conditionComplete(c);
            const facts = [...conditionFacts(c), ...medsFor(c.code)];
            const label = byCode.get(c.code)?.label ?? c.code;
            return (
              <ItemRow
                key={c.key}
                flash={flash === c.key}
                status={complete ? 'complete' : 'attention'}
                title={label}
                line={
                  complete
                    ? facts.join(' · ') || 'Answered'
                    : `${detailsNeededText(c)}${facts.length ? ` · ${facts.join(' · ')}` : ''}`
                }
                action={complete ? 'Edit' : 'Answer'}
                open={openKey === c.key}
                editor={openKey === c.key ? renderEditor(c) : null}
                onOpen={() => onEdit(c.key)}
                removeLabel={`Remove ${label}`}
                onRemove={() => dispatch({ type: 'removeCondition', key: c.key })}
              />
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

// ─── One condition: its questions ────────────────────────────────────────────

function ConditionEditor({
  idPrefix,
  condition,
  label,
  meds,
  dispatch,
  onBack,
}: {
  idPrefix: string;
  condition: DraftCondition;
  label: string;
  /** Medications on the draft that are for this condition. */
  meds: string[];
  dispatch: React.Dispatch<DraftAction>;
  onBack: () => void;
}): JSX.Element {
  const p = (s: string) => `${idPrefix}-${condition.key}-${s}`;
  const update = (patch: Partial<DraftCondition>) =>
    dispatch({ type: 'updateCondition', key: condition.key, patch });
  const fields = detailFields(condition.code);
  const open = unansweredQuestions(condition);
  const firstRef = React.useRef<HTMLSelectElement>(null);

  // The questions come to the agent: opened into view, the cursor in the first one.
  const rootRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    rootRef.current?.scrollIntoView?.({ block: 'nearest' });
    firstRef.current?.focus();
  }, []);

  const done = () => {
    update({ reviewed: true });
    onBack();
  };

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label={`${label} questions`}
      className="scroll-mb-24"
      onKeyDown={e => {
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.preventDefault();
          onBack();
        }
      }}
    >
      <p
        aria-live="polite"
        className={cn(
          'mb-2.5 flex items-center gap-1.5 text-[12px]',
          open.length && !condition.reviewed ? 'font-medium text-ringing-ink' : 'text-live-ink'
        )}
      >
        {open.length && !condition.reviewed ? (
          <>
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ringing" />
            {open.length} detail{open.length === 1 ? '' : 's'} to ask · results update as you answer
          </>
        ) : (
          <>
            <Check className="h-3.5 w-3.5" aria-hidden />
            Complete · results update as you answer
          </>
        )}
      </p>

      <div className="grid grid-cols-2 gap-x-2.5 gap-y-2.5">
        <Field label="Diagnosed" htmlFor={p('dx')}>
          <NativeSelect
            ref={firstRef}
            id={p('dx')}
            value={bucketValue(condition.diagnosedMonthsAgo)}
            className="h-9 px-2 pr-6 text-[13px]"
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
            className="h-9 px-2 pr-6 text-[13px]"
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

      <div className="mt-2.5">
        <CheckRow
          id={p('meds')}
          checked={condition.onMeds}
          onChange={onMeds => update({ onMeds })}
          className="text-[13px]"
        >
          On maintenance medication
        </CheckRow>
      </div>

      {meds.length ? (
        <p className="mt-2 flex min-w-0 items-center gap-1.5 text-[12px] text-ink-2">
          <Pill className="h-3.5 w-3.5 shrink-0 text-ink-3" aria-hidden />
          <span className="truncate">
            Medications for it:{' '}
            <span className="font-medium capitalize text-ink">{meds.join(', ')}</span>
          </span>
        </p>
      ) : null}

      <p className="mt-2 text-[11.5px] leading-4 text-ink-3">
        Last treated: the last surgery, procedure, hospital stay or treatment change. “Not sure”
        lets each carrier assume.
      </p>

      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => {
            dispatch({ type: 'removeCondition', key: condition.key });
            onBack();
          }}
          className={cn(
            'inline-flex h-8 items-center gap-1 rounded-control px-2 text-[12.5px] font-medium text-ink-2 hover:bg-dropped-tint hover:text-dropped-ink',
            FOCUS
          )}
        >
          Remove
        </button>
        <button
          type="button"
          onClick={done}
          className={cn(
            'inline-flex h-9 items-center gap-1.5 rounded-control bg-brand-strong px-4 text-[13px] font-semibold text-white hover:bg-brand-strong-hover',
            FOCUS
          )}
        >
          <Check className="h-4 w-4" aria-hidden />
          Done
        </button>
      </div>
    </div>
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
          className="h-9 px-2 pr-6 text-[13px]"
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
          className="h-9"
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
          className="h-9 px-2"
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
        className="h-9 px-2 pr-6 text-[13px]"
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
