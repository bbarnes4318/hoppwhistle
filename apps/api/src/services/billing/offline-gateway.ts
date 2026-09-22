/**
 * The OFFLINE payment gateway: an agency billed outside this platform.
 *
 * ── What it is for ───────────────────────────────────────────────────────────
 *
 * Money that arrives by check, by wire, or through an accounts-payable system
 * this platform does not talk to. The agency's applications, credits, rate,
 * Overrun ceiling and delivery gating all work exactly as they do for a Stripe
 * agency -- the only difference is that no debit is placed and the settlement
 * records what is owed rather than what was taken.
 *
 * ── Every method refuses, and that is the design ─────────────────────────────
 *
 * A gateway that quietly answered `ok: true` would be worse than no gateway at
 * all: the settlement would write `SUCCEEDED`, the agency would enter
 * `consecutiveCleanSettlements()`, and its Overrun ceiling would rise to 100%
 * on the strength of a payment nobody made. So every charge method here returns
 * a refusal carrying `offline_provider` -- and the callers do not call them.
 *
 * `settleAgencyForDeliveryDay` checks the provider before it charges and takes
 * the EXTERNAL branch; `opening-purchase` checks it and skips the gateway. This
 * object is the backstop for a path that forgets, and a refusal is the only
 * safe thing for a backstop to be. `failureCode` names the reason so a refusal
 * that does surface says why rather than looking like a declined card.
 *
 * ── Mandates ─────────────────────────────────────────────────────────────────
 *
 * There is no mandate to set up, so the setup-intent methods answer null rather
 * than inventing one. `loadAgencyTerms` reports `hasValidMandate: true` for an
 * OFFLINE agency on the strength of the provider, not of a stored instrument --
 * see `terms.ts`. Without that, `NO_VALID_MANDATE` would refuse enrolment for
 * an agency that was never going to have one.
 */

import type {
  AchChargeResult,
  AchMandateFacts,
  CardMandateFacts,
  ChargeRequest,
  PaymentGateway,
  StripeWebhookEvent,
} from './ach.js';

/**
 * The one refusal every charge method answers with.
 *
 * `ok: false` with no payment reference: nothing was attempted, so there is
 * nothing to reference. A caller that records this gets a settlement that
 * plainly did not charge, rather than one that claims to have.
 */
function refusal(method: string): AchChargeResult {
  return {
    ok: false,
    paymentIntentId: null,
    status: null,
    failureCode: 'offline_provider',
    failureMessage:
      `This agency's payment provider is OFFLINE: ${method} placed no debit. ` +
      'An offline agency is billed outside this platform and its settlement is ' +
      'recorded as EXTERNAL.',
  };
}

export class OfflineGateway implements PaymentGateway {
  chargeAchOffSession(_request: ChargeRequest): Promise<AchChargeResult> {
    return Promise.resolve(refusal('chargeAchOffSession'));
  }

  chargeCardOffSession(_request: ChargeRequest): Promise<AchChargeResult> {
    return Promise.resolve(refusal('chargeCardOffSession'));
  }

  chargeCardOnSession(_request: ChargeRequest): Promise<AchChargeResult> {
    return Promise.resolve(refusal('chargeCardOnSession'));
  }

  /**
   * No customer record is created anywhere: there is no provider holding one.
   *
   * Null rather than a fabricated id, because a non-null value here is written
   * to `stripeCustomerId` and every later reader would take it for a real
   * Stripe customer.
   */
  ensureCustomer(): Promise<string | null> {
    return Promise.resolve(null);
  }

  createAchSetupIntent(): Promise<{ id: string; clientSecret: string } | null> {
    return Promise.resolve(null);
  }

  describeAchMandate(): Promise<AchMandateFacts | null> {
    return Promise.resolve(null);
  }

  createCardSetupIntent(): Promise<{ id: string; clientSecret: string } | null> {
    return Promise.resolve(null);
  }

  describeCardMandate(): Promise<CardMandateFacts | null> {
    return Promise.resolve(null);
  }

  /**
   * Null, always. Webhooks arrive on the Stripe route and are verified against
   * the Stripe signing secret; an offline provider signs nothing and has no
   * events. Returning null is the same answer that route already handles for an
   * unverifiable payload.
   */
  constructWebhookEvent(): StripeWebhookEvent | null {
    return null;
  }

  /**
   * True: this gateway is configured and working.
   *
   * `isEnabled()` asks whether payments can be processed at all, and for an
   * offline agency they can -- elsewhere. Answering false would read to callers
   * as a misconfiguration and is the kind of thing somebody alerts on.
   */
  isEnabled(): boolean {
    return true;
  }
}
