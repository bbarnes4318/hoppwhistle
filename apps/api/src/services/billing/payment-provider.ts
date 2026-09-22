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
 * The providers whose money is collected somewhere else.
 *
 * A deny list rather than an allow list, and that direction is the safety
 * property: a provider added later and not listed here is charged through by
 * default and has to opt out explicitly. Forgetting to add one produces a
 * charge that is attempted and refused -- loud, and recoverable. Forgetting the
 * other way round produces an agency that is silently never billed, which
 * nobody notices until a quarter closes.
 *
 * MELIO is here because Melio's partner API is an accounts-payable surface and
 * cannot pull an unattended debit from an agency's bank account. It is the same
 * behaviour as OFFLINE for that reason, and a separate member only so the
 * record says which one it was.
 */
const COLLECTED_OUTSIDE_PLATFORM: ReadonlySet<PaymentProvider> = new Set([
  PaymentProvider.OFFLINE,
  PaymentProvider.MELIO,
]);

/**
 * Does this provider move money through this platform at all?
 *
 * The one question the settlement and the opening purchase ask before they
 * charge. Every branch in both reads this rather than comparing enum members
 * itself, so adding a provider is one line in the set above.
 */
export function providerChargesInPlatform(provider: PaymentProvider): boolean {
  return !COLLECTED_OUTSIDE_PLATFORM.has(provider);
}
