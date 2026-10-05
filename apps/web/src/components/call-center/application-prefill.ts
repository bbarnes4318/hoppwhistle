/**
 * What the console's call data puts into the application form, and what a
 * quote used from the Quote tab puts into the call data. Pure, so the two
 * halves of "Use this quote" -> application are tested together without the
 * console around them.
 */

import type { FexSelection } from '@/lib/fex/api';

import type { ApplicationLogPrefill } from './ApplicationLogForm';

/**
 * "Use this quote": the keys `applicationPrefillFrom` already reads.
 * `selectedPremium` stays MONTHLY, as that function and the CRM payload read
 * it; the exact annual figure travels as `selectedAnnualPremium`.
 */
export function quoteToCallData(selection: FexSelection): Record<string, unknown> {
  const annual = selection.application.annualizedPremium;
  return {
    selectedCarrier: selection.application.carrier,
    selectedPlanType: selection.application.planType,
    selectedCoverage: selection.face,
    selectedPremium: annual == null ? null : Math.round((annual / 12) * 100) / 100,
    selectedAnnualPremium: annual,
    selectedProduct: selection.application.product,
    selectedProductId: selection.productId,
    selectedClass: selection.classLabel,
    fexQuoteId: selection.fexQuoteId,
  };
}

/**
 * What the quote and the call already know, so the agent retypes none of it.
 *
 * The call data is a bag with an `unknown` index signature -- the script
 * panels write whatever they capture into it -- so every value is coerced
 * here rather than passed through. A blank field is better than a "[object
 * Object]" in the premium box on the screen that decides the agency's price.
 */
export function applicationPrefillFrom(
  data: Record<string, unknown> | null | undefined
): ApplicationLogPrefill {
  const text = (value: unknown): string | null =>
    typeof value === 'string' || typeof value === 'number' ? String(value) : null;

  /*
   * The quote's premium is MONTHLY -- the console's CRM payload sends
   * `selectedPremium` as `monthlyPremium`. The form asks for the ANNUAL
   * premium, because that is the figure the agency's production is reported
   * in. So it is converted here, once, rather than prefilled raw into a box
   * labelled "Annual premium": a monthly number in that box understates the
   * agency's reported production by a factor of twelve, and nothing
   * downstream would catch it.
   */
  const annualFromMonthly = (value: unknown): string | null => {
    const monthly = typeof value === 'number' ? value : Number(text(value) ?? NaN);
    if (!Number.isFinite(monthly) || monthly <= 0) return null;
    return (Math.round(monthly * 12 * 100) / 100).toFixed(2);
  };

  /*
   * A quote used from the Quote tab carries its premium already annualised,
   * from the mode it was quoted in. Used as it is: dividing by twelve into
   * `selectedPremium` and multiplying back would round, and a quarterly or
   * annual quote would not come back exact.
   */
  const annual = Number(text(data?.selectedAnnualPremium) ?? NaN);
  const premium =
    Number.isFinite(annual) && annual > 0
      ? annual.toFixed(2)
      : annualFromMonthly(data?.selectedPremium);

  return {
    carrier: text(data?.selectedCarrier),
    planType: text(data?.selectedPlanType),
    faceAmount: text(data?.selectedCoverage),
    premium,
    product: text(data?.selectedProduct),
    fexQuoteId: text(data?.fexQuoteId),
    quoteClass: text(data?.selectedClass),
    firstName: text(data?.firstName ?? data?.first_name),
    lastName: text(data?.lastName ?? data?.last_name),
    dob: text(data?.dob),
    state: text(data?.state),
    phone: text(data?.phone ?? data?.caller_id),
  };
}
