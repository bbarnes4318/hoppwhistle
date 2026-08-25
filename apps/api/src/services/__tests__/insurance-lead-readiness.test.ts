import { describe, expect, it } from 'vitest';

import { checkDeliveryReadiness, PLACEHOLDER_IP } from '../insurance-lead-readiness.js';

/** A lead carrying every field both verticals require in common. */
function completeCommonLead(): Record<string, unknown> {
  return {
    firstName: 'Jane',
    lastName: 'Doe',
    phone: '3125556085',
    email: 'jane.doe@example.com',
    address: '123 Main St',
    city: 'Chicago',
    state: 'IL',
    zipCode: '60610',
    birthDate: '09/16/1980',
    age: 45,
    ipAddress: '75.2.92.149',
    trustedFormUrl: 'https://cert.trustedform.com/abc',
    datePosted: '7/14/2026 09:12:00',
  };
}

describe('checkDeliveryReadiness', () => {
  it('passes an FE lead that carries every post-required field', () => {
    const report = checkDeliveryReadiness('FE', { ...completeCommonLead(), gender: 'Female' });

    expect(report.blockers).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.ready).toBe(true);
  });

  it('blocks an FE lead with no gender, which the buyer requires at ping and post', () => {
    const report = checkDeliveryReadiness('FE', completeCommonLead());

    expect(report.ready).toBe(false);
    expect(report.blockers.map(b => b.outboundField)).toEqual(['Gender']);
  });

  it('blocks an ACA lead with no height or weight', () => {
    const report = checkDeliveryReadiness('ACA', completeCommonLead());

    expect(report.ready).toBe(false);
    expect(report.blockers.map(b => b.outboundField)).toEqual([
      'Height_Feet',
      'Height_Inches',
      'Weight',
    ]);
  });

  it('does not require gender for ACA', () => {
    const report = checkDeliveryReadiness('ACA', {
      ...completeCommonLead(),
      heightFeet: 5,
      heightInches: 10,
      weight: '175',
    });

    expect(report.ready).toBe(true);
  });

  it('reports every missing common field at once rather than the first one', () => {
    const report = checkDeliveryReadiness('FE', { phone: '3125556085', gender: 'Female' });

    expect(report.blockers.map(b => b.outboundField)).toEqual([
      'FirstName',
      'LastName',
      'Email',
      'Address',
      'City',
      'State',
      'ZipCode',
      'Birth_Date',
      'Age',
      'IP_Address',
      'Trusted_Form_URL',
    ]);
  });

  it('accepts an IPv6 address but not a bare hex word', () => {
    const ready = checkDeliveryReadiness('FE', {
      ...completeCommonLead(),
      gender: 'Female',
      ipAddress: '2001:db8::1',
    });
    expect(ready.blockers).toEqual([]);

    const junk = checkDeliveryReadiness('FE', {
      ...completeCommonLead(),
      gender: 'Female',
      ipAddress: 'beef',
    });
    expect(junk.blockers.map(b => b.outboundField)).toEqual(['IP_Address']);
  });

  it('blocks values that are present but malformed', () => {
    const report = checkDeliveryReadiness('FE', {
      ...completeCommonLead(),
      gender: 'Female',
      phone: '312555',
      email: 'not-an-email',
      zipCode: '606',
      ipAddress: 'nope',
    });

    expect(report.blockers.map(b => b.outboundField)).toEqual([
      'Primary_Phone',
      'Email',
      'ZipCode',
      'IP_Address',
    ]);
  });

  it('blocks the loopback placeholder IP — it proves nothing about the opt-in', () => {
    const report = checkDeliveryReadiness('FE', {
      ...completeCommonLead(),
      gender: 'Female',
      ipAddress: PLACEHOLDER_IP,
    });

    expect(report.ready).toBe(false);
    expect(report.blockers.map(b => b.outboundField)).toEqual(['IP_Address']);
  });

  it('blocks a lead carrying no consent proof at all', () => {
    const lead = completeCommonLead();
    delete lead.trustedFormUrl;

    const report = checkDeliveryReadiness('FE', { ...lead, gender: 'Female' });

    expect(report.ready).toBe(false);
    expect(report.blockers.map(b => b.outboundField)).toEqual(['Trusted_Form_URL']);
  });

  it('accepts a LeadiD token as consent proof in place of TrustedForm', () => {
    const lead = completeCommonLead();
    delete lead.trustedFormUrl;

    const report = checkDeliveryReadiness('FE', {
      ...lead,
      gender: 'Female',
      leadidToken: 'abc-123',
    });

    expect(report.ready).toBe(true);
    expect(report.blockers).toEqual([]);
  });

  it('blocks a TrustedForm value that is not a certificate URL', () => {
    const report = checkDeliveryReadiness('FE', {
      ...completeCommonLead(),
      gender: 'Female',
      trustedFormUrl: 'n/a',
    });

    expect(report.blockers.map(b => b.outboundField)).toEqual(['Trusted_Form_URL']);
  });

  it('still only warns about a missing original lead date', () => {
    const lead = completeCommonLead();
    delete lead.datePosted;

    const report = checkDeliveryReadiness('FE', { ...lead, gender: 'Female' });

    expect(report.ready).toBe(true);
    expect(report.warnings.map(w => w.outboundField)).toEqual(['Origin_Lead_Date']);
  });

  it('reports B2B as undeliverable — it has no Ameriquote mapping', () => {
    const report = checkDeliveryReadiness('B2B', completeCommonLead());

    expect(report.ready).toBe(false);
    expect(report.blockers[0].outboundField).toBe('TYPE');
  });
});
