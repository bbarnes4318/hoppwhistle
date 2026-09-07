/**
 * The payment gateway, as this package sees it.
 *
 * ── There is one Stripe integration and it is not here ───────────────────────
 *
 * `apps/worker/src/services/stripe-service.ts` holds the platform's only
 * `new Stripe(...)`, its only API key read, and now its only ACH code. This
 * file contains no Stripe calls at all: it declares the shape the settlement
 * needs, and hands back the worker's `StripeService` bound to that shape.
 *
 * The import crosses from `apps/api` into `apps/worker` through the
 * `@hopwhistle/worker/stripe-service` export rather than by copying a hundred
 * lines of payment code into a second file. A second integration is two places
 * to get an idempotency key wrong, and only one of them would be the one
 * somebody fixes.
 *
 * ── Why an interface at all ──────────────────────────────────────────────────
 *
 * So the settlement tests can drive a gateway that counts its calls. The
 * property that matters most in this phase -- "run the job twice concurrently
 * and exactly one charge happens" -- is not observable against a real Stripe
 * account, and a test that cannot observe it is a test that does not check it.
 */

import { StripeService } from '@hopwhistle/worker/stripe-service';
import type { AchChargeResult, AchMandateFacts } from '@hopwhistle/worker/stripe-service';

export type { AchChargeResult, AchMandateFacts };

export interface ChargeRequest {
  customerId: string;
  paymentMethodId: string;
  /**
   * Whole cents, computed server-side from the ledger and the rating engine.
   * There is no route on this platform that accepts an amount, and this is the
   * only value that reaches Stripe.
   */
  amountCents: number;
  description: string;
  /** Stable across retries of the same attempt. */
  idempotencyKey: string;
  metadata?: Record<string, string>;
}

/** What the settlement needs a payment gateway to be able to do. */
export interface PaymentGateway {
  /** The daily settlement debit. ACH, off-session, against a saved mandate. */
  chargeAchOffSession(request: ChargeRequest): Promise<AchChargeResult>;
  /** An agency's opening purchase, and only that. Never a daily settlement. */
  chargeCardOnSession(request: ChargeRequest): Promise<AchChargeResult>;
  ensureCustomer(params: {
    existingCustomerId: string | null;
    name: string;
    email?: string | null;
    metadata?: Record<string, string>;
  }): Promise<string | null>;
  createAchSetupIntent(customerId: string): Promise<{ id: string; clientSecret: string } | null>;
  describeAchMandate(setupIntentId: string): Promise<AchMandateFacts | null>;
  isEnabled(): boolean;
}

let singleton: PaymentGateway | null = null;

/**
 * The production gateway: the worker's `StripeService`, built once.
 *
 * Lazy, because constructing it reads `STRIPE_SECRET_KEY` and every process
 * that imports the settlement module does not necessarily intend to charge
 * anybody.
 */
export function paymentGateway(): PaymentGateway {
  if (!singleton) singleton = new StripeService();
  return singleton;
}
