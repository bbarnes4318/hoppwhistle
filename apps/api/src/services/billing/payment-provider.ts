/**
 * What a payment provider means, with no adapter attached.
 *
 * Separate from `payment-gateways.ts` on purpose. That module imports the
 * Stripe adapter, which imports the Stripe SDK; this one imports an enum. The
 * delivery gate asks `chargesInPlatform` through `loadAgencyTerms` on every
 * call offered, and pulling a payment SDK into that module graph to answer a
 * question about an enum member is not a trade worth making.
 */

import { PaymentProvider } from '@prisma/client';

/**
 * Does this provider move money through this platform at all?
 *
 * The one question the settlement and the opening purchase ask before they
 * charge. Phrased as "not OFFLINE" rather than as a list of the providers that
 * do charge, so a provider added later is charged through by default and has to
 * opt out explicitly. The failure mode of forgetting is then a charge that is
 * attempted and refused -- loud, and recoverable -- rather than one that is
 * silently skipped and never billed to anybody.
 */
export function providerChargesInPlatform(provider: PaymentProvider): boolean {
  return provider !== PaymentProvider.OFFLINE;
}
