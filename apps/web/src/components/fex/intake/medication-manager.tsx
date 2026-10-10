'use client';

/**
 * Medications: the same shape as Health -- a search over a list, one line
 * per medication, and a medication's questions opening under its own row.
 *
 * "What is it prescribed for?" is asked AT the medication, never in a banner
 * detached from it: a drug with several uses asks the moment it is added,
 * and one a carrier asks about later (the quote says so) asks in its row as
 * one-tap answers, with what the carriers do until it is answered. Each row
 * says what the drug is for when the data says it, and whether that
 * condition is on the Health list.
 */

import { MED_LAST_TAKEN_BUCKETS } from '@hopwhistle/fex-engine/catalog';
import { Check, HeartPulse, Plus } from 'lucide-react';
import * as React from 'react';

import { fexApi, type FexDrugHit } from '@/lib/fex/api';
import { newKey, type DraftAction, type DraftMed, type QuoteDraft } from '@/lib/fex/draft';
import {
  medAsksUse,
  medConditionCodes,
  medNeedsUse,
  medTakenText,
  medUseOptions,
} from '@/lib/fex/intake-status';
import { cn } from '@/lib/utils';

import { Combobox, type ComboOption } from '../combobox';
import { bucketFrom, bucketValue, Field, FOCUS, NativeSelect, shortLabel } from '../parts';

import { ItemRow } from './items';

/** The id of the medication search box, for the workspace's Alt+M. */
export const medsSearchId = (idPrefix: string): string => `${idPrefix}-meds`;

const FLASH_MS = 1600;

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

interface MedContext {
  idPrefix: string;
  dispatch: React.Dispatch<DraftAction>;
  /** Drug ids the last quote said need their use confirmed, with the uses asked. */
  needsIndication: ReadonlyMap<string, readonly string[]>;
  conditionLabel: (code: string) => string;
  /** Condition codes on the Health list. */
  onHealth: ReadonlySet<string>;
}

export function MedicationManager({
  idPrefix,
  draft,
  dispatch,
  needsIndication,
  conditionLabel,
  item,
  onItem,
}: {
  idPrefix: string;
  draft: QuoteDraft;
  dispatch: React.Dispatch<DraftAction>;
  needsIndication: ReadonlyMap<string, readonly string[]>;
  conditionLabel: (code: string) => string;
  /** The medication whose questions are open, by key; null shows the list. */
  item: string | null;
  onItem: (key: string | null) => void;
}): JSX.Element {
  const onHealth = React.useMemo(
    () => new Set(draft.conditions.map(c => c.code)),
    [draft.conditions]
  );
  const ctx: MedContext = { idPrefix, dispatch, needsIndication, conditionLabel, onHealth };
  const open = item ? draft.meds.find(m => m.key === item) : undefined;

  const [flash, setFlash] = React.useState<string | null>(null);
  const previous = React.useRef(item);
  React.useEffect(() => {
    const was = previous.current;
    previous.current = item;
    if (was && !item) {
      setFlash(was);
      requestAnimationFrame(() => document.getElementById(medsSearchId(idPrefix))?.focus());
    }
  }, [item, idPrefix]);
  React.useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(t);
  }, [flash]);
  React.useEffect(() => {
    if (item && !open) onItem(null);
  }, [item, open, onItem]);

  const add = (hit: FexDrugHit) => {
    const existing = draft.meds.find(m => m.drugId === hit.id);
    if (existing) {
      setFlash(existing.key);
      return;
    }
    const key = newKey('m');
    const med: Omit<DraftMed, 'key'> = {
      drugId: hit.id,
      name: hit.brands[0] ? `${hit.generic} (${hit.brands[0]})` : hit.generic,
      indications: hit.indications,
      multiUse: hit.multiUse,
      drugClass: hit.drugClass,
    };
    dispatch({ type: 'addMed', med, key });
    // Several uses: what it is for is asked now, in place of the list.
    if (hit.multiUse && hit.indications.length > 0) onItem(key);
    else setFlash(key);
  };

  return (
    <MedicationList
      ctx={ctx}
      draft={draft}
      flash={flash}
      onAdd={add}
      openKey={open?.key ?? null}
      onEdit={key => onItem(item === key ? null : key)}
      renderEditor={med => (
        <MedicationEditor key={med.key} ctx={ctx} med={med} onBack={() => onItem(null)} />
      )}
    />
  );
}

function MedicationList({
  ctx,
  draft,
  flash,
  onAdd,
  openKey,
  onEdit,
  renderEditor,
}: {
  ctx: MedContext;
  draft: QuoteDraft;
  flash: string | null;
  onAdd: (hit: FexDrugHit) => void;
  openKey: string | null;
  onEdit: (key: string) => void;
  renderEditor: (med: DraftMed) => React.ReactNode;
}): JSX.Element {
  const { idPrefix, dispatch, needsIndication, conditionLabel } = ctx;
  const [query, setQuery] = React.useState('');
  const { hits, searching } = useDrugSearch(query);
  const addedDrugs = new Set(draft.meds.map(m => m.drugId));
  const options: ComboOption[] = hits
    .filter(h => !addedDrugs.has(h.id))
    .slice(0, 10)
    .map(h => ({
      id: h.id,
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
      meta:
        [h.drugClass, h.indications.length === 1 ? shortLabel(h.indications[0].label) : null]
          .filter(Boolean)
          .join(' · ') || undefined,
    }));

  return (
    <div className="space-y-2.5">
      <Combobox
        id={medsSearchId(idPrefix)}
        inputClassName="h-10 text-[14px]"
        label="Add a medication"
        hideLabel
        query={query}
        onQueryChange={setQuery}
        placeholder="Search medications, brand or generic…"
        options={options}
        onPick={id => {
          const hit = hits.find(h => h.id === id);
          if (hit) onAdd(hit);
        }}
        loading={searching}
        shortcut="Alt+M"
        emptyText="No medication by that name"
      />
      {draft.meds.length ? (
        <ul
          aria-label="Selected medications"
          className="divide-y divide-rule overflow-hidden rounded-[10px] border border-rule"
        >
          {draft.meds.map(med => {
            const asked = needsIndication.get(med.drugId);
            const needsUse = medNeedsUse(med, asked, conditionLabel);
            const isOpen = openKey === med.key;
            return (
              <ItemRow
                key={med.key}
                flash={flash === med.key}
                status={needsUse ? 'attention' : 'complete'}
                title={med.name}
                capitalize
                line={
                  needsUse ? (
                    <>
                      {med.drugClass ? (
                        <span className="text-ink-2">{med.drugClass} · </span>
                      ) : null}
                      What is it prescribed for?
                    </>
                  ) : (
                    <MedFacts ctx={ctx} med={med} />
                  )
                }
                action={needsUse ? 'Answer' : 'Edit'}
                open={isOpen}
                editor={isOpen ? renderEditor(med) : null}
                onOpen={() => onEdit(med.key)}
                removeLabel={`Remove ${med.name}`}
                onRemove={() => dispatch({ type: 'removeMed', key: med.key })}
              >
                {needsUse && !isOpen ? (
                  // Asked by the quote (or the drug has several uses): answered right here.
                  <div className="pb-2.5 pl-9 pr-3">
                    <UseChoices ctx={ctx} med={med} />
                  </div>
                ) : null}
              </ItemRow>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

/** "Biguanide · For Diabetes ✓ on Health · Stopped 1–6 months ago". */
function MedFacts({ ctx, med }: { ctx: MedContext; med: DraftMed }): JSX.Element {
  const codes = medConditionCodes(med);
  const taken = medTakenText(med);
  const parts: React.ReactNode[] = [];
  if (med.drugClass) parts.push(med.drugClass);
  for (const code of codes) {
    parts.push(
      <span key={code}>
        For {shortLabel(ctx.conditionLabel(code))}
        {ctx.onHealth.has(code) ? <span className="text-live-ink"> (on Health)</span> : null}
      </span>
    );
  }
  if (taken) parts.push(taken);
  if (!parts.length) parts.push('Currently taking');
  return (
    <>
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          {i ? ' · ' : null}
          {part}
        </React.Fragment>
      ))}
    </>
  );
}

/**
 * "What is it prescribed for?" as one-tap answers in the medication's row,
 * with what the carriers do until it is answered.
 */
function UseChoices({ ctx, med }: { ctx: MedContext; med: DraftMed }): JSX.Element {
  const options = medUseOptions(med, ctx.needsIndication.get(med.drugId), ctx.conditionLabel);
  return (
    <div>
      <div
        role="radiogroup"
        aria-label={`What ${med.name} is prescribed for`}
        className="flex flex-wrap gap-1.5"
      >
        {options.map(o => {
          const on = med.indication === o.code;
          return (
            <button
              key={o.code}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() =>
                ctx.dispatch({ type: 'setIndication', drugId: med.drugId, indication: o.code })
              }
              className={cn(
                'inline-flex h-7 items-center rounded-control border px-2.5 text-[12.5px] font-medium transition-colors duration-150 ne-motion [@media(pointer:coarse)]:min-h-[36px]',
                on
                  ? 'border-brand-strong bg-brand-strong text-white'
                  : 'border-rule-strong bg-surface text-ink hover:border-ink-3',
                FOCUS
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-[11.5px] leading-4 text-ink-2">
        Until answered, each carrier applies the strictest use it lists.
      </p>
    </div>
  );
}

function UseSelect({
  ctx,
  med,
  id,
  selectRef,
}: {
  ctx: MedContext;
  med: DraftMed;
  id: string;
  selectRef?: React.Ref<HTMLSelectElement>;
}): JSX.Element {
  const options = medUseOptions(med, ctx.needsIndication.get(med.drugId), ctx.conditionLabel);
  return (
    <NativeSelect
      ref={selectRef}
      id={id}
      aria-label={`What ${med.name} is prescribed for`}
      value={med.indication ?? ''}
      aria-invalid={!med.indication}
      onChange={e =>
        ctx.dispatch({
          type: 'updateMed',
          key: med.key,
          patch: { indication: e.target.value || undefined },
        })
      }
      className={cn('h-9 px-2 pr-6 text-[13px]', !med.indication && 'border-ringing')}
    >
      <option value="">Choose a use…</option>
      {options.map(o => (
        <option key={o.code} value={o.code}>
          {o.label}
        </option>
      ))}
    </NativeSelect>
  );
}

function MedicationEditor({
  ctx,
  med,
  onBack,
}: {
  ctx: MedContext;
  med: DraftMed;
  onBack: () => void;
}): JSX.Element {
  const { idPrefix, dispatch, needsIndication, conditionLabel, onHealth } = ctx;
  const p = (s: string) => `${idPrefix}-${med.key}-${s}`;
  const asked = needsIndication.get(med.drugId);
  const askUse = medAsksUse(med, asked, conditionLabel);
  const needsUse = medNeedsUse(med, asked, conditionLabel);
  const useRef = React.useRef<HTMLSelectElement>(null);
  const takenRef = React.useRef<HTMLSelectElement>(null);
  const forCodes = medConditionCodes(med);
  const missingOnHealth = forCodes.filter(code => !onHealth.has(code));

  const rootRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    rootRef.current?.scrollIntoView?.({ block: 'nearest' });
    (useRef.current ?? takenRef.current)?.focus();
  }, []);

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label={`${med.name} questions`}
      onKeyDown={e => {
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.preventDefault();
          onBack();
        }
      }}
    >
      {med.drugClass ? <p className="mb-2 text-[12px] text-ink-2">{med.drugClass}</p> : null}

      <div className="grid grid-cols-2 gap-x-2.5 gap-y-2.5">
        {askUse ? (
          <Field label="Prescribed for" htmlFor={p('use')}>
            <UseSelect ctx={ctx} med={med} id={p('use')} selectRef={useRef} />
          </Field>
        ) : null}
        <Field label="Still taking?" htmlFor={p('taken')}>
          <NativeSelect
            ref={takenRef}
            id={p('taken')}
            value={bucketValue(med.lastTakenMonthsAgo ?? 0)}
            className="h-9 px-2 pr-6 text-[13px]"
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
      </div>

      {needsUse ? (
        <p className="mt-2 text-[12px] font-medium text-ringing-ink">
          Until answered, each carrier applies the strictest listed use.
        </p>
      ) : null}

      {forCodes.length ? (
        <div className="mt-2.5 space-y-1">
          {forCodes.map(code => (
            <p key={code} className="flex min-w-0 items-center gap-1.5 text-[12px] text-ink-2">
              <HeartPulse className="h-3.5 w-3.5 shrink-0 text-ink-3" aria-hidden />
              <span className="min-w-0 truncate">
                For <span className="font-medium text-ink">{conditionLabel(code)}</span>
              </span>
              {missingOnHealth.includes(code) ? (
                <button
                  type="button"
                  onClick={() => dispatch({ type: 'addCondition', code })}
                  className={cn(
                    'ml-auto inline-flex h-7 shrink-0 items-center gap-1 rounded-[6px] px-1.5 text-[12px] font-semibold text-brand-ink hover:bg-brand-tint',
                    FOCUS
                  )}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  Add to Health
                </button>
              ) : (
                <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-[12px] text-live-ink">
                  <Check className="h-3.5 w-3.5" aria-hidden />
                  On Health
                </span>
              )}
            </p>
          ))}
        </div>
      ) : null}

      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => {
            dispatch({ type: 'removeMed', key: med.key });
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
          onClick={onBack}
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
