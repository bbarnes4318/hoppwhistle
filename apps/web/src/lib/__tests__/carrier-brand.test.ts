/**
 * Every spelling a carrier's name arrives in finds the same logo -- and a
 * carrier without one gets none, never a wrong logo.
 */
import { describe, expect, it } from 'vitest';

import { carrierBrand } from '../carrier-brand';

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

  it('matches the quoter families for the newer logos', () => {
    expect(carrierBrand('Liberty Bankers')?.logo).toBe('/carriers/liberty-bankers.webp');
    expect(carrierBrand('Aetna / Continental Life')?.logo).toBe(
      '/carriers/continental-life-aetna.webp'
    );
    expect(carrierBrand('Sons of Norway')?.logo).toBe('/carriers/sons-of-norway.webp');
    expect(carrierBrand('Security National')?.logo).toBe('/carriers/security-national.webp');
    expect(carrierBrand('Sentinel Security Life')?.logo).toBe('/carriers/sentinel-security.webp');
    // Accendo is Aetna too, but not Continental Life.
    expect(carrierBrand('Accendo / Aetna')).toBeNull();
  });

  it('never gives American Amicable the Americo logo', () => {
    expect(carrierBrand('American Amicable')?.name).toBe('American Amicable');
    expect(carrierBrand('americo_eagle_premier')?.name).toBe('Americo');
  });

  it('takes the first name that matches and skips blanks', () => {
    expect(carrierBrand(null, undefined, '', 'moo_living_promise')?.name).toBe('Mutual of Omaha');
    expect(carrierBrand('Prosperity', 'Americo')?.name).toBe('Americo');
  });

  it('returns null for a carrier with no logo', () => {
    expect(carrierBrand('Prosperity')).toBeNull();
    expect(carrierBrand('GCU')).toBeNull();
    expect(carrierBrand()).toBeNull();
  });
});
