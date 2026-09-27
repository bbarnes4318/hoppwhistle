import { describe, expect, it } from 'vitest';

import {
  isTenantUpgrade,
  TENANT_UPGRADES,
  tenantUpgrades,
  UPGRADE_NAMES,
} from '../lib/tenant-upgrades.js';

/**
 * `Tenant.metadata.upgrades`, read defensively: known keys only, and [] for
 * anything that is not an array of strings.
 */
describe('tenantUpgrades', () => {
  it('knows exactly the six upgrade keys', () => {
    expect([...TENANT_UPGRADES]).toEqual([
      'POWER_DIALER',
      'PREDICTIVE_DIALER',
      'CARRIER_ROUTING',
      'VOICE_AGENTS',
      'VOICE_STUDIO',
      'PAYROLL_ADMIN',
    ]);
  });

  it('keeps the known keys, in stored order, once each', () => {
    expect(
      tenantUpgrades({
        upgrades: ['VOICE_STUDIO', 'NOT_A_THING', 'POWER_DIALER', 'VOICE_STUDIO', 42, null],
        brand: 'x',
      })
    ).toEqual(['VOICE_STUDIO', 'POWER_DIALER']);
  });

  it('answers [] for anything else', () => {
    for (const metadata of [
      null,
      undefined,
      'POWER_DIALER',
      ['POWER_DIALER'],
      {},
      { upgrades: 'POWER_DIALER' },
      { upgrades: { POWER_DIALER: true } },
      { upgrades: ['power_dialer'] },
    ]) {
      expect(tenantUpgrades(metadata), JSON.stringify(metadata)).toEqual([]);
    }
  });

  it('names every key, and knows no other', () => {
    expect(Object.keys(UPGRADE_NAMES).sort()).toEqual([...TENANT_UPGRADES].sort());
    expect(UPGRADE_NAMES.PREDICTIVE_DIALER).toBe('Predictive Dialer');
    expect(isTenantUpgrade('PREDICTIVE_DIALER')).toBe(true);
    expect(isTenantUpgrade('predictive_dialer')).toBe(false);
    expect(isTenantUpgrade(42)).toBe(false);
  });
});
