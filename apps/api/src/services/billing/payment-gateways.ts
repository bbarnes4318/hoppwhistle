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
 * ── On Melio specifically ────────────────────────────────────────────────────
 *
 * Deliberately not added here yet. Melio's partner API is documented as an
 * accounts-PAYABLE surface -- bills, vendors, scheduled payouts to vendors --
 * and this platform's settlement needs the opposite: an unattended pull debit
 * against an agency's bank account, nightly, with no one present to approve it.
 * Whether their API can do that has to be answered from their sandbox before an
 * adapter is written, and an enum member nothing implements is a member an
 * agency can be assigned to and then fail to be billed under.
 *
 * Until that is settled, an agency invoiced through Melio is an OFFLINE agency:
 * it delivers, meters and computes exactly like any other, and the money is
 * collected in Melio with the reference recorded on the settlement.
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
 * An agency with no profile has not been given terms and cannot be charged; it
 * gets Stripe, which is what every caller assumed before this column existed.
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
