import { describe, it, expect } from 'vitest';

import {
  normalizePlanType,
  normalizeBoolean,
  normalizeAccountType,
  normalizeDraftDay,
  normalizeStateName,
  normalizeStateAbbr,
  parseHeight,
  normalizeDob,
  validateAndNormalizePayload,
} from '../services/carrier-rpa/normalization.js';

describe('Carrier RPA normalization', () => {
  it('normalizes plan types to Level, Graded, or ROP', () => {
    expect(normalizePlanType('I')).toBe('Level');
    expect(normalizePlanType('Immediate')).toBe('Level');
    expect(normalizePlanType('level')).toBe('Level');
    expect(normalizePlanType('L')).toBe('Level');
    expect(normalizePlanType('G')).toBe('Graded');
    expect(normalizePlanType('Graded')).toBe('Graded');
    expect(normalizePlanType('R')).toBe('ROP');
    expect(normalizePlanType('Return of Premium')).toBe('ROP');
    expect(normalizePlanType(undefined)).toBe('Level');
  });

  it('normalizes booleans from various formats', () => {
    expect(normalizeBoolean(true)).toBe(true);
    expect(normalizeBoolean('true')).toBe(true);
    expect(normalizeBoolean('Yes')).toBe(true);
    expect(normalizeBoolean('Y')).toBe(true);
    expect(normalizeBoolean('1')).toBe(true);
    expect(normalizeBoolean(false)).toBe(false);
    expect(normalizeBoolean('No')).toBe(false);
    expect(normalizeBoolean(null)).toBe(false);
  });

  it('normalizes account types to Checking or Saving', () => {
    expect(normalizeAccountType('Savings')).toBe('Saving');
    expect(normalizeAccountType('saving')).toBe('Saving');
    expect(normalizeAccountType('checking')).toBe('Checking');
    expect(normalizeAccountType(null)).toBe('Checking');
  });

  it('normalizes draft days for SS schedule and day-of-month', () => {
    expect(normalizeDraftDay('1S', true)).toBe('1S');
    expect(normalizeDraftDay('3S', true)).toBe('3S');
    expect(normalizeDraftDay('15', true)).toBe('1S'); // fallback for SS schedule
    expect(normalizeDraftDay('15', false)).toBe('15');
    expect(normalizeDraftDay('5', false)).toBe('5');
    expect(normalizeDraftDay('32', false)).toBe('15'); // out-of-bounds fallback
  });

  it('parses height strings into feet and inches', () => {
    expect(parseHeight('5\'9"')).toEqual({ feet: 5, inches: 9 });
    expect(parseHeight("5'9")).toEqual({ feet: 5, inches: 9 });
    expect(parseHeight('5-9')).toEqual({ feet: 5, inches: 9 });
    expect(parseHeight('6')).toEqual({ feet: 6, inches: 0 });
    expect(parseHeight(undefined)).toEqual({ feet: 5, inches: 6 });
  });

  it('normalizes DOB to MM/DD/YYYY', () => {
    expect(normalizeDob('1970-05-15')).toBe('05/15/1970');
    expect(normalizeDob('05/15/1970')).toBe('05/15/1970');
    expect(normalizeDob('5/1/1970')).toBe('05/01/1970');
    expect(normalizeDob('1970-05-15T00:00:00.000Z')).toBe('05/15/1970');
  });

  it('normalizes state names and abbreviations', () => {
    expect(normalizeStateName('IL')).toBe('Illinois');
    expect(normalizeStateName('illinois')).toBe('Illinois');
    expect(normalizeStateName('Texas')).toBe('Texas');
    expect(normalizeStateAbbr('Illinois')).toBe('IL');
    expect(normalizeStateAbbr('tx')).toBe('TX');
  });

  const validFeRickiePayload = {
    firstName: 'John',
    lastName: 'Doe',
    dob: '1960-01-15',
    gender: 'M',
    tobacco: 'no',
    state: 'Illinois',
    address: '123 Main St',
    city: 'Chicago',
    zip: '60601',
    phone: '(312) 555-0100',
    weight: '180',
    height: '5\'9"',
    selectedCoverage: '15000',
    selectedPlanType: 'Level',
    beneficiaryName: 'Jane Doe',
    beneficiaryRelation: 'Spouse',
    bankName: 'Chase',
    bankCityState: 'Chicago, IL',
    routingNumber: '071000013',
    accountNumber: '123456789',
    draftDay: '15',
  };

  it('accepts fe-rickie style payloads', () => {
    const result = validateAndNormalizePayload(validFeRickiePayload);
    expect(result.errors).toEqual([]);
    expect(result.isValid).toBe(true);
    expect(result.normalized.gender).toBe('Male');
    expect(result.normalized.dob).toBe('01/15/1960');
    expect(result.normalized.phone).toBe('3125550100');
    expect(result.normalized.heightFeet).toBe(5);
    expect(result.normalized.heightInches).toBe(9);
    expect(result.normalized.selectedCoverage).toBe(15000);
  });

  it('maps Hopwhistle/call-center field aliases onto the RPA payload', () => {
    const result = validateAndNormalizePayload({
      first_name: 'Mary',
      middle_name: 'A',
      last_name: 'Smith',
      birthDate: '1958-03-02',
      gender: 'female',
      tobacco: false,
      state: 'TX', // 2-letter code must resolve to a full state name
      street: '55 Oak Ave', // Hopwhistle intake uses "street"
      city: 'Dallas',
      zip: '75001',
      phone: '1 (214) 555-0111',
      weight: 150,
      heightFeet: 5,
      heightInches: 2,
      plan: 'graded',
      faceAmount: '20000',
      primaryBenName: 'Tom Smith',
      primaryBenRel: 'Spouse',
      accountName: 'Mary Smith',
      bankName: 'Wells Fargo',
      bankAddress: 'Dallas/TX',
      routing: '111000025',
      accountNum: '987654321',
      draftDate: '3',
      draftSchedule: 'SS',
      hasExisting: 'yes',
      willReplace: 'no',
      physicianName: 'Dr. Jones',
      stateOfBirth: 'Oklahoma',
      q1: 'no',
      q2: 'yes',
      q7a: true,
      ssn: '123-45-6789',
    });

    expect(result.errors).toEqual([]);
    expect(result.isValid).toBe(true);
    const n = result.normalized;
    expect(n.firstName).toBe('Mary');
    expect(n.lastName).toBe('Smith');
    expect(n.dob).toBe('03/02/1958');
    expect(n.gender).toBe('Female');
    expect(n.state).toBe('Texas');
    expect(n.address).toBe('55 Oak Ave');
    expect(n.selectedPlanType).toBe('Graded');
    expect(n.selectedCoverage).toBe(20000);
    expect(n.beneficiaryName).toBe('Tom Smith');
    expect(n.beneficiaryRelation).toBe('Spouse');
    expect(n.accountHolder).toBe('Mary Smith');
    expect(n.bankCityState).toBe('Dallas/TX');
    expect(n.routingNumber).toBe('111000025');
    expect(n.accountNumber).toBe('987654321');
    expect(n.ssPaymentSchedule).toBe(true);
    expect(n.draftDay).toBe('1S'); // '3' is not a valid SS-schedule value -> falls back to 1S
    expect(n.hasExistingInsurance).toBe(true);
    expect(n.willReplaceExisting).toBe(false);
    expect(n.doctorName).toBe('Dr. Jones');
    expect(n.birthState).toBe('OK');
    expect(n.healthQ1).toBe(false);
    expect(n.healthQ2).toBe(true);
    expect(n.healthQ7a).toBe(true);
    expect(n.ssn).toBe('123456789');
  });

  it('rejects payloads with missing required fields and lists each error', () => {
    const result = validateAndNormalizePayload({ firstName: 'OnlyFirst' });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Last Name is required');
    expect(result.errors).toContain('State is required');
    expect(result.errors).toContain('Routing Number is required');
  });

  it('rejects invalid routing numbers and SSNs', () => {
    const result = validateAndNormalizePayload({
      ...validFeRickiePayload,
      routingNumber: '1234',
      ssn: '12345',
    });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Routing Number must be exactly 9 digits');
    expect(result.errors).toContain('SSN must be exactly 9 digits when provided');
  });
});
