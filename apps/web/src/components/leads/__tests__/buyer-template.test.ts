/**
 * The CSV template is what a lead vendor fills in, so its columns have to be
 * the buyer's field names — not ours. These tests hold that line against the
 * buyer's own spec files (repo root), which are the authoritative list.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { describe, expect, it } from 'vitest';

import { BUYER_FIELD, BUYER_TEMPLATE_KEYS } from '../buyer-fields';

const REPO_ROOT = join(__dirname, '../../../../../..');

function loadSpec(file: string): string {
  return readFileSync(join(REPO_ROOT, file), 'utf8');
}

const SPECS = {
  FE: loadSpec('api-fe-fields.txt'),
  ACA: loadSpec('api-aca-fields.txt'),
};

/**
 * Spec files are tab-separated: `Field_Name<TAB>Ping Required<TAB>Post Required`.
 * A field "exists" if it starts a line in either spec.
 */
function declaredIn(spec: string, field: string): boolean {
  return new RegExp(`^${field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\t`, 'm').test(spec);
}

function isPostRequired(spec: string, field: string): boolean {
  const line = spec.split('\n').find(l => l.startsWith(`${field}\t`));
  return line?.split('\t')[2]?.trim() === 'YES';
}

/** Every field the buyer marks Post Required, per vertical. */
function postRequiredFields(spec: string): string[] {
  return spec
    .split('\n')
    .filter(line => line.split('\t')[2]?.trim() === 'YES')
    .map(line => line.split('\t')[0].trim());
}

describe('BUYER_FIELD', () => {
  it('maps only to field names the buyer actually declares', () => {
    const bogus = Object.entries(BUYER_FIELD).filter(
      ([, buyerField]) => !declaredIn(SPECS.FE, buyerField) && !declaredIn(SPECS.ACA, buyerField)
    );

    expect(bogus).toEqual([]);
  });

  it('never maps two of our fields onto the same buyer field', () => {
    const seen = new Map<string, string>();
    const collisions: string[] = [];

    for (const [key, buyerField] of Object.entries(BUYER_FIELD)) {
      const previous = seen.get(buyerField);
      if (previous) collisions.push(`${buyerField}: ${previous} and ${key}`);
      else seen.set(buyerField, key);
    }

    expect(collisions).toEqual([]);
  });
});

describe.each(['FE', 'ACA'] as const)('%s buyer template', vertical => {
  const spec = SPECS[vertical];
  const keys = BUYER_TEMPLATE_KEYS[vertical];
  const headers = keys.map(key => BUYER_FIELD[key]);

  it('gives every column a buyer field name', () => {
    expect(keys.filter(key => !BUYER_FIELD[key])).toEqual([]);
  });

  it('has no duplicate columns', () => {
    expect(new Set(headers).size).toBe(headers.length);
  });

  it('covers every field the buyer marks Post Required', () => {
    // Age is derived from Birth_Date on ingest, and the API control fields
    // (Key, TYPE, SRC, Mode, API_Action, Lead_ID) come from config, not the
    // vendor's file — none of those belong in a column a human fills in.
    const supplied = new Set([
      ...headers,
      'Age',
      'Key',
      'TYPE',
      'SRC',
      'Mode',
      'API_Action',
      'Lead_ID',
      'Landing_Page',
    ]);

    const missing = postRequiredFields(spec).filter(field => !supplied.has(field));

    expect(missing).toEqual([]);
  });

  it('leads with the required columns before the optional ones', () => {
    const requiredCount = headers.filter(h => isPostRequired(spec, h)).length;
    const leading = headers.slice(0, requiredCount);

    expect(leading.every(h => isPostRequired(spec, h))).toBe(true);
  });

  it('carries no internal-CRM field the buyer never receives', () => {
    // These are stored on the lead but are not in the outbound mapping. A
    // template asking a lead vendor for a routing number is a mistake worth
    // failing a build over.
    const internalOnly = [
      'ssn',
      'bankName',
      'accountType',
      'routingNumber',
      'accountNumber',
      'agentName',
      'primaryBeneficiaryName',
      'primaryBeneficiaryRelationship',
      'medications',
      'doctorName',
      'health',
      'driversLicense',
      'notes',
      'priority',
      'leadStage',
      'nextFollowUpAt',
    ];

    expect(keys.filter(key => internalOnly.includes(key))).toEqual([]);
  });
});

describe('the twelve columns of a typical aged-lead file', () => {
  // The header spellings a vendor actually ships, and where each has to land.
  const VENDOR_FILE: Array<[string, string]> = [
    ['Date_Posted', 'Origin_Lead_Date'],
    ['First_Name', 'FirstName'],
    ['Last_Name', 'LastName'],
    ['Address', 'Address'],
    ['City', 'City'],
    ['State', 'State'],
    ['Zip', 'ZipCode'],
    ['Phone', 'Primary_Phone'],
    ['Email', 'Email'],
    ['DOB', 'Birth_Date'],
    ['IP_Address', 'IP_Address'],
    ['Trusted_Form_URL', 'Trusted_Form_URL'],
  ];

  it.each(VENDOR_FILE)('%s reaches the buyer as %s', (_vendorHeader, buyerField) => {
    expect(Object.values(BUYER_FIELD)).toContain(buyerField);
  });

  it('has a home in the FE template for all twelve', () => {
    const feHeaders = BUYER_TEMPLATE_KEYS.FE.map(key => BUYER_FIELD[key]);
    const homeless = VENDOR_FILE.filter(([, buyerField]) => !feHeaders.includes(buyerField));

    expect(homeless).toEqual([]);
  });
});
