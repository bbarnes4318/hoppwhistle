/**
 * Every spelling a carrier's name arrives in finds the same logo -- and a
 * carrier without one gets a monogram, never a wrong logo.
 */
import { describe, expect, it } from 'vitest';

import { carrierBrand, monogramFor } from '../carrier-brand';

describe('carrierBrand', () => {
  it('matches the quoter family, the application name and the product id', () => {
    for (const name of [
      'American Amicable / Occidental',
      'American Amicable',
      'amam_golden_solution',
    ]) {
      expect(carrierBrand(name)?.logo).toBe('/carriers/american-amicable.webp');
    }
    for (const name of [
      'Mutual of Omaha',
      'United of Omaha Life Insurance Company',
      'moo_living_promise',
    ]) {
      expect(carrierBrand(name)?.logo).toBe('/carriers/mutual-of-omaha.webp');
    }
    expect(carrierBrand('Americo')?.logo).toBe('/carriers/americo.webp');
    expect(carrierBrand('AHL')?.logo).toBe('/carriers/ahl.webp');
    expect(carrierBrand('American Home Life')?.shape).toBe('square');
    expect(carrierBrand('Royal Neighbors of America')?.logo).toBe('/carriers/royal-neighbors.webp');
  });

  it('never gives American Amicable the Americo logo', () => {
    expect(carrierBrand('American Amicable')?.name).toBe('American Amicable');
    expect(carrierBrand('americo_eagle_premier')?.name).toBe('Americo');
  });

  it('takes the first name that matches and skips blanks', () => {
    expect(carrierBrand(null, undefined, '', 'moo_living_promise')?.name).toBe('Mutual of Omaha');
    expect(carrierBrand('Liberty Bankers', 'Americo')?.name).toBe('Americo');
  });

  it('returns null for a carrier with no logo', () => {
    expect(carrierBrand('Liberty Bankers')).toBeNull();
    expect(carrierBrand('Aetna / Continental Life')).toBeNull();
    expect(carrierBrand()).toBeNull();
  });
});

describe('monogramFor', () => {
  it('uses the first two words of the name before any slash or bracket', () => {
    expect(monogramFor('Liberty Bankers')).toBe('LB');
    expect(monogramFor('Aetna / Continental Life')).toBe('AE');
    expect(monogramFor('GCU')).toBe('GC');
    expect(monogramFor('Sentinel Security (SSL)')).toBe('SS');
  });
});
