/**
 * Which gateway moves a given agency's money.
 *
 * ── What this replaces ───────────────────────────────────────────────────────
 *
 * `paymentGateway()` in `ach.ts` is a process-wide singleton that returns
 * Stripe. Every charge site called it, so "who processes this payment" was not
 * a question the platform could ask -- there was one answer compiled in. That
 * is still exported and still returns Stripe, because a caller that genuinely
 * means Stripe (the webhook route verifying a Stripe signature) should say so.
 *
 * What is new is that the settlement and the opening purchase now ask for the
 * gateway belonging to a TENANT, and get back whatever that agency is on.
 *
 * ── Adding a provider ────────────────────────────────────────────────────────
 *
 * Three things, and nothing else:
 *
 *   1. A member on `PaymentProvider` in the schema, plus a migration.
 *   2. A class implementing `PaymentGateway` (see `offline-gateway.ts` for the
 *      smallest possible one).
 *   3. One line in `ADAPTERS` below.
 *
 * The settlement, the ledger, the delivery gate and the enrolment check are
 * untouched by any of it: they resolve a gateway and call the interface.
 *
 * ── On Melio, which is now the default ───────────────────────────────────────
 *
 * ASKED AND ANSWERED: Melio's partner API is an accounts-PAYABLE surface --
 * bills, vendors, payouts pushed OUT to vendors -- and cannot pull an unattended
 * debit from an agency's bank account, which is what a nightly settlement with
 * nobody present to approve it requires. Nobody needs to go and re-check this in
 * their sandbox.
 *
 * So MELIO resolves to the OfflineGateway: no money moves through this platform,
 * every settlement is computed in full and recorded EXTERNAL, and the invoice is
 * raised in Melio. It is a separate member from OFFLINE only so the ledger and
 * the settlement say which one it was -- a Melio invoice and a hand-deposited
 * check are both "collected elsewhere", and a year from now the difference is
 * one somebody will want.
 *
 * It is the column default as of `20260922020001_payment_provider_melio_default`.
 * That governs NEW agencies only; every agency already on STRIPE carries that
 * value explicitly and keeps being debited.
 *
 * ── Singletons, per provider ─────────────────────────────────────────────────
 *
 * Built once and reused. Constructing the Stripe adapter reads
 * `STRIPE_SECRET_KEY`, and a settlement run walking two hundred tenants must
 * not build two hundred clients.
 */

import { PaymentProvider } from '@prisma/client';

import { getPrismaClient } from '../../lib/prisma.js';

import { paymentGateway, type PaymentGateway } from './ach.js';
import { OfflineGateway } from './offline-gateway.js';

/**
 * Re-exported so a caller that already has the registry does not need a second
 * import for the predicate. It lives in `payment-provider.ts` because the
 * delivery gate reaches it through `loadAgencyTerms` and must not pull the
 * Stripe SDK in behind it.
 */
export { providerChargesInPlatform } from './payment-provider.js';

/** How to build each provider's adapter. One line per provider. */
const ADAPTERS: Record<PaymentProvider, () => PaymentGateway> = {
  [PaymentProvider.STRIPE]: () => paymentGateway(),
  [PaymentProvider.OFFLINE]: () => new OfflineGateway(),
  /*
   * The same gateway as OFFLINE, and not a mistake.
   *
   * Melio cannot pull an unattended debit from an agency's bank account, so no
   * money moves through this platform for a Melio agency either. What differs
   * is only what the record says, which is why it is a separate member rather
   * than an alias -- see the schema, and `payment-provider.ts` for the
   * predicate both share.
   */
  [PaymentProvider.MELIO]: () => new OfflineGateway(),
};

const built = new Map<PaymentProvider, PaymentGateway>();

/**
 * The gateway for a provider.
 *
 * An unrecognised provider falls back to Stripe rather than throwing. The
 * alternative is that adding an enum member without an adapter takes the
 * nightly settlement down for every agency, not just the one on the new
 * provider -- `settleAllAgencies` walks tenants in one process.
 */
export function gatewayForProvider(provider: PaymentProvider): PaymentGateway {
  const existing = built.get(provider);
  if (existing) return existing;

  const build = ADAPTERS[provider] ?? ADAPTERS[PaymentProvider.STRIPE];
  const gateway = build();
  built.set(provider, gateway);
  return gateway;
}

/**
 * The gateway for one agency, read from its billing profile.
 *
 * A tenant with no profile has not been given terms and cannot be charged at
 * all -- enrolment requires one. It gets Stripe rather than the column's MELIO
 * default, for the reason spelled out in `loadAgencyTerms`: the default is for
 * rows being written for a real agency, and treating a tenant with no terms as
 * collected-elsewhere would have it report itself as needing no mandate.
 *
 * The callers that matter all load the profile for other reasons anyway and
 * should pass the provider to `gatewayForProvider` directly rather than paying
 * for this second read.
 */
export async function gatewayForTenant(tenantId: string): Promise<PaymentGateway> {
  const profile = await getPrismaClient().agencyBillingProfile.findUnique({
    where: { tenantId },
    select: { paymentProvider: true },
  });
  return gatewayForProvider(profile?.paymentProvider ?? PaymentProvider.STRIPE);
}

/** Test seam: drop the built adapters so a suite can install its own. */
export function resetGatewayCache(): void {
  built.clear();
}
