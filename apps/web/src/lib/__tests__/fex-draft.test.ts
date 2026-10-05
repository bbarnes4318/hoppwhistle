/**
 * The quoter's form state becoming the API body, the softphone's Q key, and
 * the rule for opening the quoter by itself when a call connects.
 */
import { describe, expect, it, vi } from 'vitest';

import { resolveShortcut, SHORTCUTS } from '@/components/phone/softphone/shortcuts';

import {
  draftReducer,
  emptyDraft,
  missingForQuote,
  toApplicant,
  type QuoteDraft,
} from '../fex/draft';

// The session module imports the phone provider and the router; the pure rule
// under test needs neither.
vi.mock('@/components/phone/phone-provider', () => ({ usePhone: () => ({}) }));
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

const base = (patch: Partial<QuoteDraft> = {}): QuoteDraft => ({
  ...emptyDraft({ defaultFace: 10000, defaultMode: 'monthly' }),
  state: 'TN',
  sex: 'F',
  ageOrDob: { mode: 'age', age: '68' },
  ...patch,
});

describe('toApplicant', () => {
  it('is null until state, sex, age and coverage are all there', () => {
    expect(toApplicant(emptyDraft())).toBeNull();
    expect(missingForQuote(base({ state: '' }))).toBe('state');
    expect(missingForQuote(base({ sex: '' }))).toBe('sex');
    expect(missingForQuote(base({ ageOrDob: { mode: 'age', age: '' } }))).toBe('age');
    expect(missingForQuote(base({ coverage: { mode: 'budget', budget: '' } }))).toBe('budget');
    expect(toApplicant(base())).not.toBeNull();
  });

  it('starts from the agency defaults', () => {
    const draft = emptyDraft({ defaultFace: 15000, defaultMode: 'quarterly' });
    expect(draft.coverage).toEqual({ mode: 'face', face: '15000' });
    expect(draft.paymentMode).toBe('quarterly');
  });

  it('sends a face OR a budget, never both', () => {
    const face = toApplicant(base())!;
    expect(face.face).toBe(10000);
    expect(face.budget).toBeUndefined();

    const budget = toApplicant(base({ coverage: { mode: 'budget', budget: '45.50' } }))!;
    expect(budget.budget).toBe(45.5);
    expect(budget.face).toBeUndefined();
  });

  it('sends height only together with a weight', () => {
    const noWeight = toApplicant(base({ heightFt: '5', heightIn: '4' }))!;
    expect(noWeight.heightIn).toBeUndefined();
    expect(noWeight.weightLb).toBeUndefined();

    const both = toApplicant(base({ heightFt: '5', heightIn: '4', weightLb: '182' }))!;
    expect(both.heightIn).toBe(64);
    expect(both.weightLb).toBe(182);
  });

  it('sends a date of birth or an age, never both', () => {
    const age = toApplicant(base())!;
    expect(age.age).toBe(68);
    expect(age.dob).toBeUndefined();

    const dob = toApplicant(base({ ageOrDob: { mode: 'dob', dob: '1958-04-02' } }))!;
    expect(dob.dob).toBe('1958-04-02');
    expect(dob.age).toBeUndefined();
  });

  it('carries conditions and medications with only the answers given', () => {
    let draft = draftReducer(base(), { type: 'addCondition', code: 'DIABETES' });
    const key = draft.conditions[0].key;
    draft = draftReducer(draft, {
      type: 'updateCondition',
      key,
      patch: { diagnosedMonthsAgo: 90, treatedMonthsAgo: 0 },
    });
    draft = draftReducer(draft, {
      type: 'addMed',
      med: { drugId: 'metformin', name: 'metformin' },
    });
    draft = draftReducer(draft, {
      type: 'setIndication',
      drugId: 'metformin',
      indication: 'DIABETES',
    });
    const applicant = toApplicant(draft)!;
    expect(applicant.conditions).toEqual([
      { code: 'DIABETES', diagnosedMonthsAgo: 90, treatedMonthsAgo: 0 },
    ]);
    expect(applicant.meds).toEqual([
      { drugId: 'metformin', name: 'metformin', indication: 'DIABETES', lastTakenMonthsAgo: 0 },
    ]);
  });

  it('drops the "From lead" mark on a field the agent edits', () => {
    const draft = { ...base(), prefilled: new Set(['state', 'sex'] as const) } as QuoteDraft;
    const edited = draftReducer(draft, { type: 'set', patch: { state: 'GA' }, fields: ['state'] });
    expect(edited.prefilled.has('state')).toBe(false);
    expect(edited.prefilled.has('sex')).toBe(true);
  });
});

describe('the Q shortcut', () => {
  const key = (k: string, target?: unknown) => ({ key: k, target: target as EventTarget });

  it('opens the quoter on a call, and only on a call', () => {
    expect(resolveShortcut(key('q'), 'connected')).toBe('quote');
    expect(resolveShortcut(key('Q'), 'hold')).toBe('quote');
    expect(resolveShortcut(key('q'), 'ready')).toBeNull();
    expect(resolveShortcut(key('q'), 'incoming')).toBeNull();
  });

  it('does nothing while the agent is typing', () => {
    expect(resolveShortcut(key('q', { tagName: 'INPUT', type: 'text' }), 'connected')).toBeNull();
    expect(resolveShortcut(key('q', { tagName: 'TEXTAREA' }), 'connected')).toBeNull();
    expect(
      resolveShortcut(key('q', { tagName: 'DIV', getAttribute: () => 'combobox' }), 'connected')
    ).toBeNull();
  });

  it('is on the shortcuts sheet', () => {
    expect(SHORTCUTS.find(s => s.keys.includes('Q'))).toEqual({
      keys: ['Q'],
      label: 'Open the quoter',
      when: 'On a call',
    });
  });
});

describe('opening the quoter when a call connects', () => {
  it('follows the agent, then the agency, and stays off the console and the Quote page', async () => {
    const { shouldAutoOpen } = await import('@/contexts/quote-session-context');
    const on = { agencySetting: true, mySetting: null, pathname: '/dashboard', vertical: null };
    expect(shouldAutoOpen(on)).toBe(true);
    expect(shouldAutoOpen({ ...on, mySetting: false })).toBe(false);
    expect(shouldAutoOpen({ ...on, agencySetting: false })).toBe(false);
    expect(shouldAutoOpen({ ...on, agencySetting: false, mySetting: true })).toBe(true);
    expect(shouldAutoOpen({ ...on, pathname: '/call-center' })).toBe(false);
    expect(shouldAutoOpen({ ...on, pathname: '/quote' })).toBe(false);
    expect(shouldAutoOpen({ ...on, vertical: 'ACA' })).toBe(false);
    expect(shouldAutoOpen({ ...on, vertical: 'B2B' })).toBe(false);
    expect(shouldAutoOpen({ ...on, vertical: 'FE' })).toBe(true);
  });
});
