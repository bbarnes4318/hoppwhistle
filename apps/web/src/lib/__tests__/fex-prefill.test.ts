/**
 * Lead data in every shape it arrives in, turned into a quote -- and never a
 * health answer.
 */
import { describe, expect, it } from 'vitest';

import {
  parseAge,
  parseDob,
  parseFace,
  parseHeight,
  parseSex,
  parseState,
  parseTobacco,
  parseWeight,
  prefillFromProspect,
} from '../fex/prefill';

describe('parsers', () => {
  it('reads a state as a code or a name', () => {
    expect(parseState('FL')).toBe('FL');
    expect(parseState('fl')).toBe('FL');
    expect(parseState('Florida')).toBe('FL');
    expect(parseState('new york')).toBe('NY');
    expect(parseState('District of Columbia')).toBe('DC');
    expect(parseState('Narnia')).toBeNull();
    expect(parseState('')).toBeNull();
  });

  it('reads a date of birth as MM/DD/YYYY or YYYY-MM-DD', () => {
    expect(parseDob('05/14/1958')).toBe('1958-05-14');
    expect(parseDob('5/4/1958')).toBe('1958-05-04');
    expect(parseDob('1958-05-14')).toBe('1958-05-14');
    expect(parseDob('1958-05-14T00:00:00.000Z')).toBe('1958-05-14');
    expect(parseDob('02/30/1958')).toBeNull();
    expect(parseDob('not a date')).toBeNull();
  });

  it('reads an age only when it is 18–100', () => {
    expect(parseAge(67)).toBe(67);
    expect(parseAge('67')).toBe(67);
    expect(parseAge('12')).toBeNull();
    expect(parseAge('sixty')).toBeNull();
  });

  it('reads sex as M, F, male or female in any case', () => {
    for (const v of ['M', 'm', 'male', 'MALE', 'Male']) expect(parseSex(v)).toBe('M');
    for (const v of ['F', 'f', 'female', 'FEMALE']) expect(parseSex(v)).toBe('F');
    expect(parseSex('other')).toBeNull();
  });

  it('reads tobacco yes/no words, and leaves anything else unset', () => {
    for (const v of ['yes', 'Y', 'true', 'smoker', '1', true]) expect(parseTobacco(v)).toBe(true);
    for (const v of ['no', 'N', 'false', 'non-smoker', 'Non Smoker', '0', false]) {
      expect(parseTobacco(v)).toBe(false);
    }
    expect(parseTobacco('sometimes')).toBeNull();
    expect(parseTobacco('')).toBeNull();
  });

  it('reads a face amount as "$10,000", "10k" or 10000, within 1,000–500,000', () => {
    expect(parseFace('$10,000')).toBe(10000);
    expect(parseFace('10k')).toBe(10000);
    expect(parseFace('7.5K')).toBe(7500);
    expect(parseFace(10000)).toBe(10000);
    expect(parseFace('500')).toBeNull();
    expect(parseFace('1,000,000')).toBeNull();
  });

  it('reads a height as feet and inches or plain inches', () => {
    expect(parseHeight(`5'6"`)).toBe(66);
    expect(parseHeight(`5'6`)).toBe(66);
    expect(parseHeight('5-6')).toBe(66);
    expect(parseHeight('5 ft 6 in')).toBe(66);
    expect(parseHeight('66')).toBe(66);
    expect(parseHeight(`6'`)).toBe(72);
    expect(parseHeight('30')).toBeNull();
    expect(parseHeight('tall')).toBeNull();
  });

  it('reads a weight in pounds 70–600', () => {
    expect(parseWeight('182')).toBe(182);
    expect(parseWeight(182)).toBe(182);
    expect(parseWeight('182 lbs')).toBe(182);
    expect(parseWeight('20')).toBeNull();
    expect(parseWeight('900')).toBeNull();
  });
});

describe('prefillFromProspect', () => {
  it('takes the first source that has a usable value', () => {
    const { draft, fields } = prefillFromProspect({
      customer: {
        state: 'Tennessee',
        birthDate: '04/02/1958',
        gender: 'female',
        insurance: { smoker: 'no', faceAmount: '$15,000' },
      },
      prospectData: { state: 'TX', dob: '1960-01-01', height: `5'4"`, weight: '182' },
      matchedProspect: { state: 'GA' },
    });
    expect(draft.state).toBe('TN');
    expect(draft.ageOrDob).toEqual({ mode: 'dob', dob: '1958-04-02' });
    expect(draft.sex).toBe('F');
    expect(draft.tobacco).toBe(false);
    expect(draft.coverage).toEqual({ mode: 'face', face: '15000' });
    expect(draft.heightFt).toBe('5');
    expect(draft.heightIn).toBe('4');
    expect(draft.weightLb).toBe('182');
    expect([...fields].sort()).toEqual(
      ['dob', 'face', 'height', 'sex', 'state', 'tobacco', 'weight'].sort()
    );
  });

  it('falls through a source whose value does not parse', () => {
    const { draft } = prefillFromProspect({
      customer: { state: 'Atlantis' },
      prospectData: { state: 'florida' },
    });
    expect(draft.state).toBe('FL');
  });

  it('uses age only when there is no date of birth', () => {
    expect(prefillFromProspect({ customer: { age: '71' } }).draft.ageOrDob).toEqual({
      mode: 'age',
      age: '71',
    });
    expect(
      prefillFromProspect({ customer: { age: '71' }, prospectData: { dob: '01/02/1950' } }).draft
        .ageOrDob
    ).toEqual({ mode: 'dob', dob: '1950-01-02' });
  });

  it('reads custom fields from the lead vendor', () => {
    const { draft } = prefillFromProspect({
      prospectData: {
        customFields: {
          date_of_birth: '1955-07-04',
          smoker: 'Y',
          height: '70',
          weight: '200',
          sex: 'M',
        },
      },
    });
    expect(draft.ageOrDob).toEqual({ mode: 'dob', dob: '1955-07-04' });
    expect(draft.tobacco).toBe(true);
    expect(draft.heightFt).toBe('5');
    expect(draft.heightIn).toBe('10');
    expect(draft.weightLb).toBe('200');
    expect(draft.sex).toBe('M');
  });

  it('ignores a face outside what a quote can ask for', () => {
    expect(
      prefillFromProspect({ prospectData: { faceAmount: '250' } }).draft.coverage
    ).toBeUndefined();
  });

  it('names the prospect from fullName, or first and last', () => {
    expect(prefillFromProspect({ customer: { fullName: 'Ada Lovelace' } }).prospectName).toBe(
      'Ada Lovelace'
    );
    expect(
      prefillFromProspect({ prospectData: { firstName: 'Ada', lastName: 'Byron' } }).prospectName
    ).toBe('Ada Byron');
    expect(
      prefillFromProspect({ prospectData: { first_name: 'Ada', last_name: 'King' } }).prospectName
    ).toBe('Ada King');
    expect(prefillFromProspect({}).prospectName).toBeNull();
  });

  it('never prefills a health condition or a medication', () => {
    const { draft } = prefillFromProspect({
      prospectData: { conditions: ['DIABETES'], meds: ['metformin'], health: 'COPD' },
      customer: { customFields: { conditions: 'CHF' } },
    });
    expect(draft.conditions).toBeUndefined();
    expect(draft.meds).toBeUndefined();
  });
});
