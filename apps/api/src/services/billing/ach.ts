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
import type {
  AchChargeResult,
  AchMandateFacts,
  CardMandateFacts,
} from '@hopwhistle/worker/stripe-service';

export type { AchChargeResult, AchMandateFacts, CardMandateFacts };

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
  /** The daily settlement debit for an ACH agency, against a saved mandate. */
  chargeAchOffSession(request: ChargeRequest): Promise<AchChargeResult>;
  /**
   * The daily settlement debit for a card-paying agency, against a card the
   * agency already authorised for off-session use.
   *
   * The amount is the same amount an ACH agency would be charged for the same
   * day's applications at the same rate. Nothing is added here: a card-paying
   * agency is priced differently through its rate offset, which is part of the
   * rate, and not through a fee applied at the point of payment.
   */
  chargeCardOffSession(request: ChargeRequest): Promise<AchChargeResult>;
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
  /** Begin saving a card for off-session use. The card equivalent of the above. */
  createCardSetupIntent(customerId: string): Promise<{ id: string; clientSecret: string } | null>;
  /** What a completed card SetupIntent produced, read back from Stripe. */
  describeCardMandate(setupIntentId: string): Promise<CardMandateFacts | null>;
  /**
   * Verify a Stripe webhook against `STRIPE_WEBHOOK_SECRET` and parse it.
   *
   * Takes the RAW body, because a re-serialised object is not the bytes Stripe
   * signed. Null when the secret is not configured or the signature does not
   * verify -- one answer for both, so an unauthenticated caller learns nothing
   * about which.
   *
   * Typed as `unknown` here rather than as Stripe's own `Event`: this package
   * declares the shape it needs and does not take a type dependency on the
   * Stripe SDK, which is pinned external in the API bundle for a load-bearing
   * reason (see docs/BILLING.md §5). The webhook route narrows it.
   */
  constructWebhookEvent(rawBody: Buffer | string, signature: string): StripeWebhookEvent | null;
  isEnabled(): boolean;
}

/**
 * The part of a Stripe event this platform reads.
 *
 * Deliberately minimal. Only `type` and `data.object` are used, and everything
 * inside `data.object` is checked field by field rather than cast -- a payload
 * shaped differently from expectation must produce a refusal, not a row of
 * nulls, because the row in question stops an agency's delivery.
 */
export interface StripeWebhookEvent {
  type: string;
  data: { object: unknown };
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
