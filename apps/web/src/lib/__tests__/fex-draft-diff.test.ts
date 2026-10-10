import { describe, expect, it } from 'vitest';

import { emptyDraft, missingFieldsForQuote, missingForQuote, type QuoteDraft } from '../fex/draft';
import { describeDraftChange } from '../fex/draft-diff';

const label = (code: string) => ({ DIABETES: 'Diabetes', COPD: 'COPD' })[code] ?? code;

const BASE: QuoteDraft = {
  ...emptyDraft(),
  state: 'AR',
  sex: 'M',
  ageOrDob: { mode: 'age', age: '70' },
  coverage: { mode: 'face', face: '20000' },
};

describe('describeDraftChange', () => {
  it('says nothing when nothing changed', () => {
    expect(describeDraftChange(BASE, { ...BASE }, label)).toEqual([]);
  });

  it('names added and removed conditions and medications, health first', () => {
    const next: QuoteDraft = {
      ...BASE,
      ageOrDob: { mode: 'age', age: '71' },
      conditions: [{ key: 'c', code: 'DIABETES', onMeds: false, detail: {} }],
      meds: [{ key: 'm', drugId: 'metformin', name: 'metformin (Glucophage)' }],
    };
    expect(describeDraftChange(BASE, next, label)).toEqual([
      'Added Diabetes',
      'Added Metformin',
      'Age 70 → 71',
    ]);
    expect(describeDraftChange(next, BASE, label)).toEqual([
      'Removed Diabetes',
      'Removed Metformin',
      'Age 71 → 70',
    ]);
  });

  it("names a condition's answers and a medication's use", () => {
    const before: QuoteDraft = {
      ...BASE,
      conditions: [{ key: 'c', code: 'DIABETES', onMeds: false, detail: {} }],
      meds: [{ key: 'm', drugId: 'metformin', name: 'metformin' }],
    };
    const after: QuoteDraft = {
      ...before,
      conditions: [{ ...before.conditions[0], diagnosedMonthsAgo: 18 }],
      meds: [{ ...before.meds[0], indication: 'DIABETES' }],
    };
    expect(describeDraftChange(before, after, label)).toEqual([
      'Diabetes answers changed',
      'Metformin: for Diabetes',
    ]);
  });

  it('names coverage and tobacco changes', () => {
    const next: QuoteDraft = { ...BASE, tobacco: true, coverage: { mode: 'face', face: '25000' } };
    expect(describeDraftChange(BASE, next, label)).toEqual([
      'Tobacco: yes',
      '$20,000 face → $25,000 face',
    ]);
  });
});

describe('missingFieldsForQuote', () => {
  it('lists every required field still missing, in the order asked', () => {
    expect(missingFieldsForQuote(emptyDraft())).toEqual(['state', 'sex', 'age']);
    expect(
      missingFieldsForQuote({ ...emptyDraft(), coverage: { mode: 'budget', budget: '' } })
    ).toEqual(['state', 'sex', 'age', 'budget']);
    expect(missingFieldsForQuote(BASE)).toEqual([]);
  });

  it('agrees with missingForQuote on the first', () => {
    expect(missingForQuote(emptyDraft())).toBe('state');
    expect(missingForQuote({ ...BASE, ageOrDob: { mode: 'dob', dob: '' } })).toBe('dob');
    expect(missingForQuote(BASE)).toBeNull();
  });
});
