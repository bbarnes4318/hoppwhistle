import { describe, expect, it, vi } from 'vitest';

import {
  checkDeliveryReadiness,
  PLACEHOLDER_IP,
  PLACEHOLDER_LANDING_PAGE,
} from '../insurance-lead-readiness.js';

vi.mock('../../lib/logger.js', () => ({
  createServiceLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

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
    landingPage: 'vendor-quotes.example.com/final-expense',
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

  it('warns when the landing page falls back to our own domain', () => {
    const lead = completeCommonLead();
    delete lead.landingPage;

    const missing = checkDeliveryReadiness('FE', { ...lead, gender: 'Female' });
    expect(missing.ready).toBe(true);
    expect(missing.warnings.map(w => w.outboundField)).toEqual(['Landing_Page']);

    // The substituted default reads the same as having supplied it by hand.
    const substituted = checkDeliveryReadiness('FE', {
      ...lead,
      gender: 'Female',
      landingPage: PLACEHOLDER_LANDING_PAGE,
    });
    expect(substituted.warnings.map(w => w.outboundField)).toEqual(['Landing_Page']);
  });

  it("accepts the vendor's own landing page without complaint", () => {
    const report = checkDeliveryReadiness('FE', { ...completeCommonLead(), gender: 'Female' });

    expect(report.warnings).toEqual([]);
  });
  it('reports B2B as undeliverable — it has no Ameriquote mapping', () => {
    const report = checkDeliveryReadiness('B2B', completeCommonLead());

    expect(report.ready).toBe(false);
    expect(report.blockers[0].outboundField).toBe('TYPE');
  });
});

describe('placeholder constants', () => {
  it('stay in step with the values the mapper actually substitutes', async () => {
    const { DEFAULTS } = await import('../insurance-lead-config.js');

    expect(PLACEHOLDER_LANDING_PAGE).toBe(DEFAULTS.LANDING_PAGE);
    // The mapper inlines the IP fallback rather than reading it from config.
    expect(PLACEHOLDER_IP).toBe('127.0.0.1');
  });
});
