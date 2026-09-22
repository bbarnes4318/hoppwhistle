import { PaymentProvider } from '@prisma/client';
import { describe, it, expect, beforeEach } from 'vitest';

import type { ChargeRequest, PaymentGateway } from '../services/billing/ach.js';
import { OfflineGateway } from '../services/billing/offline-gateway.js';
import {
  gatewayForProvider,
  resetGatewayCache,
} from '../services/billing/payment-gateways.js';
import { providerChargesInPlatform } from '../services/billing/payment-provider.js';

/**
 * The payment provider seam.
 *
 * ── What this suite is for ───────────────────────────────────────────────────
 *
 * `paymentGateway()` used to be a singleton returning Stripe, so "who charges
 * this agency" had one compiled-in answer and an agency that had already paid
 * outside the platform could not be recorded without being debited twice. These
 * are the properties the replacement has to hold:
 *
 *   1. AN OFFLINE PROVIDER NEVER REPORTS A CHARGE AS SUCCEEDED. Every charge
 *      method refuses, so a path that forgets to check the provider produces a
 *      loud failure rather than a settlement claiming money arrived.
 *   2. THE REGISTRY ANSWERS PER PROVIDER, and caches, because the settlement
 *      run walks every tenant in one process.
 *   3. AN UNKNOWN PROVIDER FALLS BACK RATHER THAN THROWING. One unimplemented
 *      enum member must not take the nightly run down for every agency.
 *   4. `providerChargesInPlatform` IS THE ONE DEFINITION. Every branch in the
 *      settlement and the opening purchase reads it rather than comparing enum
 *      members itself.
 *
 * Deliberately not database-backed: none of these are properties of a row.
 * The settlement's EXTERNAL branch and the offline opening purchase are
 * properties of rows and indexes, and are asserted in `settlement.test.ts`
 * against a real database.
 */

const CHARGE: ChargeRequest = {
  customerId: 'cus_irrelevant',
  paymentMethodId: 'pm_irrelevant',
  amountCents: 897_800,
  description: 'a settlement that must not go through',
  idempotencyKey: 'offline-must-not-charge',
};

describe('providerChargesInPlatform', () => {
  it('is true for STRIPE', () => {
    expect(providerChargesInPlatform(PaymentProvider.STRIPE)).toBe(true);
  });

  it('is false for OFFLINE', () => {
    expect(providerChargesInPlatform(PaymentProvider.OFFLINE)).toBe(false);
  });

  /**
   * The direction the default has to fail in.
   *
   * A provider added later and not wired into this predicate is charged
   * through, which surfaces as a refused charge somebody investigates. The
   * other default -- treating anything unrecognised as offline -- surfaces as
   * an agency that is silently never billed, which nobody notices until a
   * quarter closes.
   */
  it('treats an unrecognised provider as charging in-platform', () => {
    expect(providerChargesInPlatform('MELIO' as PaymentProvider)).toBe(true);
  });
});

describe('OfflineGateway', () => {
  const gateway = new OfflineGateway();

  it('refuses an ACH settlement debit rather than reporting success', async () => {
    const result = await gateway.chargeAchOffSession(CHARGE);
    expect(result.ok).toBe(false);
    expect(result.paymentIntentId).toBeNull();
    expect(result.failureCode).toBe('offline_provider');
  });

  it('refuses a card settlement debit', async () => {
    const result = await gateway.chargeCardOffSession(CHARGE);
    expect(result.ok).toBe(false);
    expect(result.failureCode).toBe('offline_provider');
  });

  it('refuses an on-session card charge, which is the opening purchase', async () => {
    const result = await gateway.chargeCardOnSession(CHARGE);
    expect(result.ok).toBe(false);
    expect(result.failureCode).toBe('offline_provider');
  });

  /**
   * The property that matters most here.
   *
   * `chargeAndFinalise` writes SUCCEEDED on `ok: true`, and a SUCCEEDED
   * settlement enters `consecutiveCleanSettlements()`, which is what raises an
   * agency's Overrun ceiling from 50% to 100%. An offline gateway that answered
   * ok would buy an agency unsecured credit on the strength of a payment
   * nobody made.
   */
  it('never answers ok from any charge method', async () => {
    const results = await Promise.all([
      gateway.chargeAchOffSession(CHARGE),
      gateway.chargeCardOffSession(CHARGE),
      gateway.chargeCardOnSession(CHARGE),
    ]);
    expect(results.map(r => r.ok)).toEqual([false, false, false]);
  });

  it('creates no customer, rather than a fabricated id', async () => {
    // A non-null value here is written to `stripeCustomerId`, where every later
    // reader would take it for a real Stripe customer.
    await expect(gateway.ensureCustomer()).resolves.toBeNull();
  });

  it('offers no mandate to set up', async () => {
    await expect(gateway.createAchSetupIntent()).resolves.toBeNull();
    await expect(gateway.createCardSetupIntent()).resolves.toBeNull();
    await expect(gateway.describeAchMandate()).resolves.toBeNull();
    await expect(gateway.describeCardMandate()).resolves.toBeNull();
  });

  it('verifies no webhook, because it signs none', () => {
    expect(gateway.constructWebhookEvent()).toBeNull();
  });

  /**
   * Enabled, not disabled. `isEnabled()` asks whether payments can be processed
   * at all, and for an offline agency they can -- elsewhere. False would read
   * to callers as a misconfiguration and is the kind of thing somebody alerts
   * on at 2am for a system working as configured.
   */
  it('reports itself enabled', () => {
    expect(gateway.isEnabled()).toBe(true);
  });
});

describe('gatewayForProvider', () => {
  beforeEach(() => {
    resetGatewayCache();
  });

  it('answers an OfflineGateway for OFFLINE', () => {
    expect(gatewayForProvider(PaymentProvider.OFFLINE)).toBeInstanceOf(OfflineGateway);
  });

  /**
   * Built once. A settlement run walks every enrolled tenant in one process and
   * constructing the Stripe adapter reads `STRIPE_SECRET_KEY`; two hundred
   * tenants must not mean two hundred clients.
   */
  it('caches the adapter per provider', () => {
    const first = gatewayForProvider(PaymentProvider.OFFLINE);
    const second = gatewayForProvider(PaymentProvider.OFFLINE);
    expect(second).toBe(first);
  });

  it('gives a fresh adapter after the cache is reset', () => {
    const before = gatewayForProvider(PaymentProvider.OFFLINE);
    resetGatewayCache();
    expect(gatewayForProvider(PaymentProvider.OFFLINE)).not.toBe(before);
  });

  /**
   * An enum member with no adapter falls back rather than throwing.
   *
   * `settleAllAgencies` walks tenants in one process, so a throw here would
   * take the nightly settlement down for every agency on the platform, not
   * just the one assigned to the new provider.
   */
  it('falls back to Stripe for a provider with no adapter, rather than throwing', () => {
    let resolved: PaymentGateway | null = null;
    expect(() => {
      resolved = gatewayForProvider('MELIO' as PaymentProvider);
    }).not.toThrow();
    expect(resolved).not.toBeNull();
    expect(resolved).not.toBeInstanceOf(OfflineGateway);
  });
});
