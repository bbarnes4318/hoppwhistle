import { describe, expect, it } from 'vitest';

import { emptyDraft, type DraftCondition, type QuoteDraft } from '../fex/draft';
import {
  applicantSummary,
  attentionItems,
  conditionComplete,
  conditionFacts,
  coverageSummary,
  medConditionCodes,
  medShortName,
  unansweredQuestions,
} from '../fex/intake-status';

const label = (code: string) => ({ DIABETES: 'Diabetes (any type)' })[code] ?? code;
const condition = (patch: Partial<DraftCondition> = {}): DraftCondition => ({
  key: 'c1',
  code: 'DIABETES',
  onMeds: false,
  detail: {},
  ...patch,
});

describe('intake status', () => {
  it('summarises the applicant and coverage as one line each', () => {
    const d: QuoteDraft = {
      ...emptyDraft(),
      state: 'AL',
      sex: 'M',
      ageOrDob: { mode: 'age', age: '65' },
      heightFt: '6',
      heightIn: '0',
      weightLb: '200',
      activityCredit: true,
    };
    expect(applicantSummary(d).join(' · ')).toBe(
      'AL · Male · Age 65 · Non-tobacco · 6′0″ · 200 lb'
    );
    expect(coverageSummary(d).join(' · ')).toBe('$10,000 face · Monthly · Exercises 3+/wk');
  });

  it('counts a condition’s unanswered questions until the agent presses Done', () => {
    const c = condition();
    expect(unansweredQuestions(c)).toEqual(['Diagnosed', 'Last treated']);
    expect(conditionComplete(c)).toBe(false);
    expect(conditionComplete({ ...c, diagnosedMonthsAgo: 18, treatedMonthsAgo: 0 })).toBe(true);
    // "Not sure" on purpose: complete, and said so.
    expect(conditionComplete({ ...c, reviewed: true })).toBe(true);
    expect(conditionFacts({ ...c, reviewed: true })).toEqual(['Details not sure']);
    // A condition's own questions count too.
    expect(unansweredQuestions(condition({ code: 'STROKE' }))).toContain('Lasting complications');
  });

  it('ties a medication to a condition only when the data says so', () => {
    const one = {
      key: 'm',
      drugId: 'metformin',
      name: 'metformin (Glucophage)',
      indications: [{ code: 'DIABETES', label: 'Diabetes' }],
    };
    expect(medConditionCodes(one)).toEqual(['DIABETES']);
    const many = {
      ...one,
      multiUse: true,
      indications: [
        { code: 'A', label: 'A' },
        { code: 'B', label: 'B' },
      ],
    };
    expect(medConditionCodes(many)).toEqual([]);
    expect(medConditionCodes({ ...many, indication: 'B' })).toEqual(['B']);
    expect(medShortName(one.name)).toBe('Metformin');
  });

  it('lists what the quote is assuming, in the order it is asked', () => {
    const d: QuoteDraft = {
      ...emptyDraft(),
      tobacco: null,
      conditions: [condition()],
      meds: [{ key: 'm1', drugId: 'gabapentin', name: 'gabapentin', lastTakenMonthsAgo: 0 }],
    };
    const items = attentionItems(d, new Map([['gabapentin', ['NEUROPATHY']]]), label);
    expect(items.map(i => [i.section, i.subject, i.need])).toEqual([
      ['applicant', 'Tobacco', 'not asked'],
      ['health', 'Diabetes (any type)', '2 details needed'],
      ['meds', 'gabapentin', 'what is it for?'],
    ]);
  });
});
