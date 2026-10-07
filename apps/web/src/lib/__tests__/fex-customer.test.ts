/**
 * A CRM customer turned into a quote, a saved quote turned back into one, and
 * a quote's answers offered back to the record -- never over what it holds.
 */
import { describe, expect, it } from 'vitest';

import type { InsuranceLeadDetail } from '../api/leads';
import type { FexApplicant } from '../fex/api';
import {
  annualPremium,
  customerFactLine,
  customerName,
  customerUpdatesFromDraft,
  fexApplicantToDraft,
  insuranceLeadToFexDraft,
  snapshotDifferences,
} from '../fex/customer';
import { ageFromDob, emptyDraft, toApplicant } from '../fex/draft';

const lead = (patch: Partial<InsuranceLeadDetail> = {}): InsuranceLeadDetail =>
  ({
    id: 'lead-1',
    tenantId: 't',
    vertical: 'FE',
    firstName: 'Jane',
    lastName: 'Smith',
    fullName: null,
    email: null,
    phone: '6155550142',
    address: null,
    address2: null,
    city: null,
    county: null,
    state: null,
    zipCode: null,
    birthDate: null,
    age: null,
    gender: null,
    source: null,
    status: 'NEW',
    notes: null,
    customFields: null,
    tags: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    submissions: [],
    assignedToId: null,
    assignedAt: null,
    lastContactedAt: null,
    nextFollowUpAt: null,
    priority: null,
    leadStage: null,
    doNotCall: false,
    duplicateOfId: null,
    company: null,
    repName: null,
    industry: null,
    revenue: null,
    yearEstablished: null,
    smoker: null,
    faceAmount: null,
    lifeType: null,
    riskType: null,
    carrier: null,
    product: null,
    monthlyPremium: null,
    coverageAmount: null,
    trustedFormUrl: null,
    leadidToken: null,
    consentLanguage: null,
    recordingUrl: null,
    activities: [],
    tasks: [],
    ...patch,
  }) as InsuranceLeadDetail;

describe('insuranceLeadToFexDraft', () => {
  it('fills what the record knows and marks it as from the record', () => {
    const { draft, fields, missing } = insuranceLeadToFexDraft(
      lead({
        state: 'Tennessee',
        birthDate: '05/14/1958',
        gender: 'Female',
        smoker: 'NO',
        faceAmount: '$10,000',
      })
    );
    expect(draft.state).toBe('TN');
    expect(draft.ageOrDob).toEqual({ mode: 'dob', dob: '1958-05-14' });
    expect(draft.sex).toBe('F');
    expect(draft.tobacco).toBe(false);
    expect(draft.coverage).toEqual({ mode: 'face', face: '10000' });
    expect([...fields].sort()).toEqual(['dob', 'face', 'sex', 'state', 'tobacco']);
    expect([...draft.prefilled].sort()).toEqual([...fields].sort());
    expect(missing).toEqual([]);
    // Ready to quote with nothing typed.
    expect(toApplicant(draft)).toMatchObject({ state: 'TN', sex: 'F', dob: '1958-05-14' });
  });

  it('uses the age when there is no date of birth', () => {
    const { draft, fields } = insuranceLeadToFexDraft(lead({ age: 67 }));
    expect(draft.ageOrDob).toEqual({ mode: 'age', age: '67' });
    expect(fields.has('age')).toBe(true);
    expect(fields.has('dob')).toBe(false);
  });

  it('prefers a date of birth over a stored age, which goes stale', () => {
    const { draft } = insuranceLeadToFexDraft(lead({ birthDate: '1958-05-14', age: 60 }));
    expect(draft.ageOrDob.mode).toBe('dob');
  });

  it('leaves what the record lacks unset, and names it to ask', () => {
    const { draft, fields, missing } = insuranceLeadToFexDraft(lead(), {
      defaultFace: 15000,
      defaultMode: 'monthly',
    });
    expect(draft.state).toBe('');
    expect(draft.sex).toBe('');
    expect(draft.ageOrDob).toEqual({ mode: 'age', age: '' });
    // Unknown tobacco is unanswered, not "no".
    expect(draft.tobacco).toBeNull();
    // The agency's default coverage, but not marked as the customer's.
    expect(draft.coverage).toEqual({ mode: 'face', face: '15000' });
    expect(fields.size).toBe(0);
    expect(missing).toEqual(['state', 'sex', 'dob', 'tobacco', 'face']);
    expect(toApplicant(draft)).toBeNull();
  });

  it('skips values it cannot read rather than guessing', () => {
    const { draft, fields } = insuranceLeadToFexDraft(
      lead({
        state: 'Narnia',
        birthDate: '02/30/1958',
        age: 7,
        gender: 'unknown',
        smoker: 'sometimes',
        faceAmount: 'lots',
      })
    );
    expect(fields.size).toBe(0);
    expect(draft.state).toBe('');
    expect(draft.ageOrDob).toEqual({ mode: 'age', age: '' });
  });

  it('never prefills a health answer, whatever the record holds', () => {
    const { draft } = insuranceLeadToFexDraft(
      lead({ customFields: { health: 'diabetes', conditions: ['COPD'], meds: 'metformin' } })
    );
    expect(draft.conditions).toEqual([]);
    expect(draft.meds).toEqual([]);
  });

  it('takes height and weight from captured script data, only as a pair', () => {
    const both = insuranceLeadToFexDraft(lead({ customFields: { height: `5'6"`, weight: '180' } }));
    expect(both.draft.heightFt).toBe('5');
    expect(both.draft.heightIn).toBe('6');
    expect(both.draft.weightLb).toBe('180');
    const one = insuranceLeadToFexDraft(lead({ customFields: { height: `5'6"` } }));
    expect(one.draft.heightFt).toBe('');
  });
});

describe('fexApplicantToDraft (Requote)', () => {
  const saved: FexApplicant & { quoteDate: string } = {
    state: 'TN',
    sex: 'F',
    tobacco: true,
    dob: '1958-05-14',
    face: 15000,
    mode: 'quarterly',
    heightIn: 66,
    weightLb: 180,
    conditions: [{ code: 'DIABETES', diagnosedMonthsAgo: 90, treatedMonthsAgo: 0, onMeds: true }],
    meds: [{ drugId: 'metformin', name: 'Metformin', indication: 'DIABETES' }],
    quoteDate: '2026-09-01',
  };

  it('asks the engine the same question again', () => {
    const draft = fexApplicantToDraft(saved);
    const applicant = toApplicant(draft)!;
    const { quoteDate: _quoteDate, ...asked } = saved;
    void _quoteDate;
    expect(applicant).toEqual(asked);
  });

  it('keeps a budget quote a budget quote, and an age an age', () => {
    const draft = fexApplicantToDraft({
      state: 'TX',
      sex: 'M',
      tobacco: false,
      age: 70,
      budget: 50,
      mode: 'monthly',
      conditions: [],
      meds: [],
    });
    expect(draft.coverage).toEqual({ mode: 'budget', budget: '50' });
    expect(draft.ageOrDob).toEqual({ mode: 'age', age: '70' });
  });

  it('marks nothing as from the record: these are the quote’s answers', () => {
    expect(fexApplicantToDraft(saved).prefilled.size).toBe(0);
  });
});

describe('customerUpdatesFromDraft', () => {
  it('offers what the agent learned into blank fields, in the CRM’s formats', () => {
    const draft = {
      ...emptyDraft(),
      state: 'TN',
      sex: 'F' as const,
      tobacco: true,
      ageOrDob: { mode: 'dob' as const, dob: '1958-05-14' },
    };
    const update = customerUpdatesFromDraft(lead(), draft);
    expect(update.patch).toEqual({
      state: 'TN',
      birthDate: '05/14/1958',
      age: ageFromDob('1958-05-14'),
      gender: 'Female',
      smoker: 'YES',
    });
    expect(update.labels).toEqual(['State', 'Date of birth', 'Sex', 'Tobacco']);
  });

  it('never overwrites a value the record already holds', () => {
    const draft = {
      ...emptyDraft(),
      state: 'FL',
      sex: 'M' as const,
      tobacco: true,
      ageOrDob: { mode: 'dob' as const, dob: '1960-01-01' },
    };
    const update = customerUpdatesFromDraft(
      lead({ state: 'TN', gender: 'Female', smoker: 'NO', birthDate: '05/14/1958' }),
      draft
    );
    expect(update.patch).toEqual({});
    expect(update.labels).toEqual([]);
  });

  it('does not write an unanswered tobacco, or any coverage or health answer', () => {
    const draft = {
      ...emptyDraft(),
      tobacco: null,
      coverage: { mode: 'face' as const, face: '25000' },
    };
    draft.conditions = [{ key: 'c', code: 'COPD', onMeds: false, detail: {} }];
    const update = customerUpdatesFromDraft(lead(), draft);
    expect(update.patch).toEqual({});
  });
});

describe('snapshotDifferences', () => {
  it('names what changed on the record since the quote', () => {
    const now = lead({ state: 'FL', age: 68, gender: 'F', smoker: 'YES' });
    expect(snapshotDifferences({ state: 'TN', age: 67, sex: 'F', tobacco: false }, now)).toEqual([
      { field: 'State', quoted: 'TN', now: 'FL' },
      { field: 'Age', quoted: '67', now: '68' },
      { field: 'Tobacco', quoted: 'Non-tobacco', now: 'Tobacco' },
    ]);
  });

  it('says nothing when the record is silent or unchanged', () => {
    expect(snapshotDifferences({ state: 'TN', age: 67, sex: 'F', tobacco: false }, lead())).toEqual(
      []
    );
  });
});

describe('small helpers', () => {
  it('names the customer the way the CRM does', () => {
    expect(customerName(lead())).toBe('Jane Smith');
    expect(customerName(lead({ fullName: 'Jane Q. Smith' }))).toBe('Jane Q. Smith');
    expect(customerName(lead({ firstName: null, lastName: null }))).toBe('Unnamed customer');
  });

  it('writes the fact line from what is on record only', () => {
    expect(customerFactLine(lead({ state: 'TN', age: 67, gender: 'F', smoker: 'NO' }))).toBe(
      'TN · Age 67 · Female · Non-tobacco'
    );
    expect(customerFactLine(lead())).toBe('');
  });

  it('annualises a modal premium', () => {
    expect(annualPremium(54.27, 'monthly')).toBe(651.24);
    expect(annualPremium(150, 'quarterly')).toBe(600);
    expect(annualPremium(null, 'monthly')).toBeNull();
  });
});
