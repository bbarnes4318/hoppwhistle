import type { AgencyBillingProfile } from '@prisma/client';
import { AchMandateStatus, AgencyPaymentMethod, PaymentProvider } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { hasValidPaymentInstrument } from '../services/billing/terms.js';

/**
 * The agency delivery page warned "No valid ACH mandate" from the raw ACH
 * column, so an agency billed outside the platform (MELIO, OFFLINE) or paying
 * by card saw the warning while the delivery gate was delivering to it. These
 * pin the one rule both now read.
 */
function profile(overrides: Partial<AgencyBillingProfile>): AgencyBillingProfile {
  return {
    paymentProvider: PaymentProvider.STRIPE,
    paymentMethod: AgencyPaymentMethod.ACH,
    achMandateStatus: AchMandateStatus.NONE,
    achPaymentMethodId: null,
    cardMandateStatus: AchMandateStatus.NONE,
    cardPaymentMethodId: null,
    ...overrides,
  } as AgencyBillingProfile;
}

describe('hasValidPaymentInstrument', () => {
  it('is false for a tenant with no billing profile', () => {
    expect(hasValidPaymentInstrument(null)).toBe(false);
  });

  it.each([PaymentProvider.MELIO, PaymentProvider.OFFLINE])(
    'is true for an agency billed outside the platform (%s) with no mandate',
    paymentProvider => {
      expect(hasValidPaymentInstrument(profile({ paymentProvider }))).toBe(true);
    }
  );

  it('needs an ACTIVE ACH mandate and a payment method for an in-platform ACH agency', () => {
    expect(hasValidPaymentInstrument(profile({}))).toBe(false);
    expect(hasValidPaymentInstrument(profile({ achMandateStatus: AchMandateStatus.ACTIVE }))).toBe(
      false
    );
    expect(
      hasValidPaymentInstrument(
        profile({ achMandateStatus: AchMandateStatus.ACTIVE, achPaymentMethodId: 'pm_ach' })
      )
    ).toBe(true);
  });

  it('reads the card columns, not the ACH ones, for a card-paying agency', () => {
    expect(
      hasValidPaymentInstrument(
        profile({
          paymentMethod: AgencyPaymentMethod.CARD,
          cardMandateStatus: AchMandateStatus.ACTIVE,
          cardPaymentMethodId: 'pm_card',
        })
      )
    ).toBe(true);
    expect(
      hasValidPaymentInstrument(
        profile({
          paymentMethod: AgencyPaymentMethod.CARD,
          achMandateStatus: AchMandateStatus.ACTIVE,
          achPaymentMethodId: 'pm_ach',
        })
      )
    ).toBe(false);
  });
});
