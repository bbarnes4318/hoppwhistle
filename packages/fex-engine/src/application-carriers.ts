/**
 * Which carrier name an engine product is logged under on the application
 * form (`APPLICATION_CARRIERS` in apps/web/src/components/call-center/
 * ApplicationLogForm.tsx).
 *
 * Four products map onto a carrier already on that form. Every other product
 * is logged as "Other" with the name below, which the form's free-text box
 * accepts. Exact strings matter: the Applications page reconciles against
 * carrier statements by this name.
 */
export const APPLICATION_CARRIER_BY_PRODUCT: Readonly<Record<string, string>> = {
  accendo_final_expense: 'Aetna (Accendo)',
  aetna_continental_protection_series: 'Aetna (Continental Life)',
  amam_golden_solution: 'American Amicable',
  americo_eagle_guaranteed: 'Americo',
  americo_eagle_premier: 'Americo',
  americo_eagle_select: 'Americo',
  bankers_fidelity_senior_security: 'Bankers Fidelity',
  bankers_fidelity_vantage_secure: 'Bankers Fidelity',
  betterlife_better_final_expense: 'BetterLife',
  betterlife_graded_benefit: 'BetterLife',
  betterlife_gi: 'BetterLife',
  catholic_financial_final_expense: 'Catholic Financial Life',
  chubb_generational_life: 'Chubb (Combined Insurance)',
  cica_superior_choice: 'CICA',
  cica_superior_choice_gi: 'CICA',
  family_benefit_golden_eagle: 'Family Benefit Life (Trinity)',
  fidelity_rapidecision_fe: 'Fidelity Life',
  foresters_planright: 'Foresters',
  gcu_eternal_advantage: 'GCU',
  liberty_bankers_simpl: 'Liberty Bankers',
  lifeshield_survivor: 'LifeShield',
  moo_living_promise: 'Mutual of Omaha',
  physicians_mutual_modified_wl: 'Physicians Mutual',
  physicians_mutual_secure_essential: 'Physicians Mutual',
  prosperity_new_vista: 'Prosperity Life',
  sentinel_new_vantage: 'Sentinel Security Life',
  snl_guardian: 'Security National',
  snl_icare: 'Security National',
  snl_loyalty: 'Security National',
  snl_mib: 'Security National',
  sons_of_norway_legacysure: 'Sons of Norway',
  transamerica_fe_express_2026: 'TransAmerica',
  transamerica_10pay_solution: 'TransAmerica',
  transamerica_easy_solution: 'TransAmerica',
  transamerica_immediate_solution: 'TransAmerica',
};

/** The application-form carrier name for a product; falls back to the product's family. */
export function applicationCarrierFor(productId: string, family: string): string {
  return APPLICATION_CARRIER_BY_PRODUCT[productId] ?? family.split(' / ')[0];
}

/**
 * The application's `planType` (ApplicationInputSchema in
 * apps/api/src/services/applications/input-schema.ts) for a quoted benefit.
 * The schema allows LEVEL | GRADED | ROP | GUARANTEED_ISSUE. A Modified plan
 * pays a reduced benefit in the early years, so it is recorded as GRADED;
 * anything unrecognised is left unset rather than guessed.
 */
export function applicationPlanTypeFor(
  benefit: string
): 'LEVEL' | 'GRADED' | 'ROP' | 'GUARANTEED_ISSUE' | undefined {
  switch (benefit) {
    case 'LEVEL':
      return 'LEVEL';
    case 'GRADED':
    case 'MODIFIED':
      return 'GRADED';
    case 'ROP':
      return 'ROP';
    case 'GI':
      return 'GUARANTEED_ISSUE';
    default:
      return undefined;
  }
}

/** Payments per year for a payment mode, to annualise a modal premium. */
export const PAYMENTS_PER_YEAR = { monthly: 12, quarterly: 4, semiannual: 2, annual: 1 } as const;
