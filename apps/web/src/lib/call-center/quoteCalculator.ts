// Quote Calculator for Call Center Portal - Restricted to American Amicable & GTL
// Rate tables for active carriers and premium calculation functions

// ============================================================================
// AMERICAN AMICABLE RATES (Ages 50-85)
// ============================================================================

const AMAM_RATES: Record<
  number,
  { maleNS: number; maleSm: number; femaleNS: number; femaleSm: number }
> = {
  50: { maleNS: 32.96, maleSm: 43.12, femaleNS: 27.30, femaleSm: 32.55 },
  51: { maleNS: 34.90, maleSm: 45.03, femaleNS: 29.36, femaleSm: 33.62 },
  52: { maleNS: 36.67, maleSm: 47.09, femaleNS: 30.58, femaleSm: 35.34 },
  53: { maleNS: 39.14, maleSm: 49.42, femaleNS: 32.21, femaleSm: 37.29 },
  54: { maleNS: 40.94, maleSm: 51.61, femaleNS: 33.74, femaleSm: 38.73 },
  55: { maleNS: 42.49, maleSm: 53.82, femaleNS: 35.28, femaleSm: 40.94 },
  56: { maleNS: 44.18, maleSm: 56.05, femaleNS: 36.42, femaleSm: 42.23 },
  57: { maleNS: 45.32, maleSm: 58.29, femaleNS: 37.70, femaleSm: 44.20 },
  58: { maleNS: 47.64, maleSm: 61.08, femaleNS: 38.77, femaleSm: 45.91 },
  59: { maleNS: 49.50, maleSm: 63.35, femaleNS: 40.17, femaleSm: 47.70 },
  60: { maleNS: 50.47, maleSm: 65.82, femaleNS: 40.48, femaleSm: 49.01 },
  61: { maleNS: 53.38, maleSm: 70.04, femaleNS: 42.85, femaleSm: 51.46 },
  62: { maleNS: 56.09, maleSm: 73.13, femaleNS: 44.50, femaleSm: 54.08 },
  63: { maleNS: 58.71, maleSm: 76.01, femaleNS: 46.44, femaleSm: 56.85 },
  64: { maleNS: 61.80, maleSm: 79.64, femaleNS: 48.50, femaleSm: 59.78 },
  65: { maleNS: 64.89, maleSm: 83.43, femaleNS: 50.47, femaleSm: 62.57 },
  66: { maleNS: 69.24, maleSm: 88.51, femaleNS: 53.59, femaleSm: 65.88 },
  67: { maleNS: 73.78, maleSm: 93.22, femaleNS: 56.34, femaleSm: 69.33 },
  68: { maleNS: 78.70, maleSm: 98.88, femaleNS: 59.45, femaleSm: 72.10 },
  69: { maleNS: 83.12, maleSm: 104.55, femaleNS: 62.52, femaleSm: 77.12 },
  70: { maleNS: 86.53, maleSm: 108.72, femaleNS: 65.61, femaleSm: 79.02 },
  71: { maleNS: 92.03, maleSm: 115.15, femaleNS: 69.53, femaleSm: 83.20 },
  72: { maleNS: 97.83, maleSm: 121.93, femaleNS: 73.65, femaleSm: 87.61 },
  73: { maleNS: 104.40, maleSm: 129.60, femaleNS: 78.84, femaleSm: 92.61 },
  74: { maleNS: 111.76, maleSm: 137.51, femaleNS: 83.69, femaleSm: 97.75 },
  75: { maleNS: 119.74, maleSm: 147.55, femaleNS: 89.87, femaleSm: 104.29 },
  76: { maleNS: 128.75, maleSm: 157.59, femaleNS: 95.83, femaleSm: 112.49 },
  77: { maleNS: 138.02, maleSm: 168.10, femaleNS: 101.29, femaleSm: 120.00 },
  78: { maleNS: 150.28, maleSm: 180.87, femaleNS: 108.15, femaleSm: 127.85 },
  79: { maleNS: 161.92, maleSm: 191.58, femaleNS: 116.60, femaleSm: 139.06 },
  80: { maleNS: 174.07, maleSm: 203.53, femaleNS: 126.18, femaleSm: 150.62 },
  81: { maleNS: 187.87, maleSm: 216.30, femaleNS: 135.75, femaleSm: 164.14 },
  82: { maleNS: 202.91, maleSm: 229.56, femaleNS: 146.26, femaleSm: 179.51 },
  83: { maleNS: 217.02, maleSm: 246.08, femaleNS: 158.11, femaleSm: 195.69 },
  84: { maleNS: 232.78, maleSm: 266.64, femaleNS: 170.98, femaleSm: 214.76 },
  85: { maleNS: 248.49, maleSm: 289.69, femaleNS: 185.66, femaleSm: 236.13 },
};

// ============================================================================
// GTL RATES (Ages 40-90)
// ============================================================================

const GTL_RATES: Record<number, { male: number; female: number }> = {
  40: { male: 55.00, female: 40.00 },
  41: { male: 56.00, female: 40.00 },
  42: { male: 57.00, female: 40.00 },
  43: { male: 58.00, female: 40.00 },
  44: { male: 59.00, female: 40.00 },
  45: { male: 60.00, female: 40.00 },
  46: { male: 60.00, female: 40.00 },
  47: { male: 60.00, female: 40.00 },
  48: { male: 60.00, female: 40.00 },
  49: { male: 60.00, female: 40.00 },
  50: { male: 61.00, female: 41.00 },
  51: { male: 62.00, female: 42.00 },
  52: { male: 63.00, female: 44.00 },
  53: { male: 64.00, female: 46.00 },
  54: { male: 65.00, female: 49.00 },
  55: { male: 67.00, female: 51.00 },
  56: { male: 70.00, female: 53.00 },
  57: { male: 72.00, female: 55.00 },
  58: { male: 73.00, female: 56.00 },
  59: { male: 75.00, female: 58.00 },
  60: { male: 78.00, female: 60.00 },
  61: { male: 81.00, female: 63.00 },
  62: { male: 86.00, female: 66.00 },
  63: { male: 90.00, female: 70.00 },
  64: { male: 95.00, female: 72.00 },
  65: { male: 100.00, female: 73.00 },
  66: { male: 104.00, female: 77.00 },
  67: { male: 108.00, female: 80.00 },
  68: { male: 112.00, female: 83.00 },
  69: { male: 116.00, female: 86.00 },
  70: { male: 120.00, female: 90.00 },
  71: { male: 132.00, female: 98.00 },
  72: { male: 142.00, female: 107.00 },
  73: { male: 152.00, female: 115.00 },
  74: { male: 162.00, female: 124.00 },
  75: { male: 172.00, female: 132.00 },
  76: { male: 200.00, female: 150.00 },
  77: { male: 225.00, female: 170.00 },
  78: { male: 250.00, female: 190.00 },
  79: { male: 275.00, female: 200.00 },
  80: { male: 290.00, female: 210.00 },
  81: { male: 300.00, female: 220.00 },
  82: { male: 320.00, female: 230.00 },
  83: { male: 340.00, female: 240.00 },
  84: { male: 360.00, female: 250.00 },
  85: { male: 375.00, female: 260.00 },
  86: { male: 400.00, female: 280.00 },
  87: { male: 420.00, female: 300.00 },
  88: { male: 440.00, female: 330.00 },
  89: { male: 450.00, female: 360.00 },
  90: { male: 460.00, female: 400.00 },
};

// ============================================================================
// CARRIER CONFIGURATION - RESTRICTED TO 2 ACTIVE CARRIERS
// ============================================================================

export const CARRIERS = {
  'American Amicable': ['Level', 'Graded', 'ROP'],
  GTL: ['Graded'],
} as const;

interface CarrierConfig {
  annualFee: number;
  monthlyFactor: number;
  hasTobacco: boolean;
  minAge: number;
  maxAge: number;
  planTypes: readonly string[];
}

const CARRIER_CONFIG: Record<string, CarrierConfig> = {
  'American Amicable': {
    annualFee: 30,
    monthlyFactor: 0.088,
    hasTobacco: true,
    minAge: 50,
    maxAge: 85,
    planTypes: ['Level', 'Graded', 'ROP'],
  },
  GTL: {
    annualFee: 48,
    monthlyFactor: 0.08333,
    hasTobacco: false,
    minAge: 40,
    maxAge: 90,
    planTypes: ['Graded'],
  },
};

// ============================================================================
// ELIGIBILITY TIER SYSTEM (Based on American Amicable Health Questions)
// ============================================================================

export type EligibilityTier = 'NOT_ELIGIBLE' | 'LEVEL' | 'ROP' | 'GRADED' | 'GI';

export interface HealthAnswers {
  // Q1-Q3: If ANY is true = NOT ELIGIBLE
  q1?: boolean | null; // Critical conditions (hospitalized, oxygen, hospice, cancer, ADL)
  q2?: boolean | null; // Serious conditions (transplant, dialysis, CHF, Alzheimer's, ALS, terminal)
  q3?: boolean | null; // HIV/AIDS

  // Q4-Q7: If ANY is true = ROP Plan
  q4?: boolean | null; // Diabetes complications, insulin <50
  q5?: boolean | null; // Kidney failure, multiple cancers
  q6?: boolean | null; // Pending tests/surgery (2yr)
  q7a?: boolean | null; // Heart/lung conditions (2yr)
  q7b?: boolean | null; // Heart surgery/aneurysm (2yr)
  q7c?: boolean | null; // Cancer treatment (2yr)
  q7d?: boolean | null; // Substance abuse (2yr)

  // Q8: If ANY is true = GRADED Plan
  q8a?: boolean | null; // Heart/circulation/stroke (3yr)
  q8b?: boolean | null; // Cancer/lung/liver (3yr)
  q8c?: boolean | null; // Neurological (3yr)
}

export interface EligibilityResult {
  tier: EligibilityTier;
  planType: string;
  message: string;
  disqualifyingQuestions: string[];
}

/**
 * Determine eligibility tier based on health question answers
 * Rule hierarchy:
 *   Q1-Q3 ANY Yes → NOT ELIGIBLE
 *   Q4-Q7 ANY Yes → ROP (Return of Premium)
 *   Q8    ANY Yes → GRADED
 *   All No        → LEVEL (Immediate, First Day Coverage)
 */
export function determineEligibilityTier(answers: HealthAnswers): EligibilityResult {
  const disqualifyingQuestions: string[] = [];

  // Check Q1-Q3: Critical - NOT ELIGIBLE
  const criticalQuestions = [
    { key: 'q1', label: 'Critical conditions (hospitalized, oxygen, cancer, ADL)' },
    { key: 'q2', label: "Serious conditions (transplant, CHF, Alzheimer's, terminal)" },
    { key: 'q3', label: 'HIV/AIDS' },
  ];

  for (const q of criticalQuestions) {
    if (answers[q.key as keyof HealthAnswers] === true) {
      disqualifyingQuestions.push(q.label);
    }
  }

  if (disqualifyingQuestions.length > 0) {
    return {
      tier: 'NOT_ELIGIBLE',
      planType: 'None',
      message: 'Not eligible for coverage due to critical health conditions',
      disqualifyingQuestions,
    };
  }

  // Check Q4-Q7: Moderate conditions → ROP Plan
  const ropQuestions = [
    { key: 'q4', label: 'Diabetes complications' },
    { key: 'q5', label: 'Kidney disease or multiple cancers' },
    { key: 'q6', label: 'Pending medical tests' },
    { key: 'q7a', label: 'Heart/lung conditions (2yr)' },
    { key: 'q7b', label: 'Heart surgery (2yr)' },
    { key: 'q7c', label: 'Cancer treatment (2yr)' },
    { key: 'q7d', label: 'Substance use (2yr)' },
  ];

  const ropFlags: string[] = [];
  for (const q of ropQuestions) {
    if (answers[q.key as keyof HealthAnswers] === true) {
      ropFlags.push(q.label);
    }
  }

  if (ropFlags.length > 0) {
    return {
      tier: 'ROP',
      planType: 'ROP',
      message: 'Qualifies for Return of Premium plan',
      disqualifyingQuestions: ropFlags,
    };
  }

  // Check Q8: Historical conditions → GRADED Plan
  const gradedQuestions = [
    { key: 'q8a', label: 'Heart/stroke (3yr)' },
    { key: 'q8b', label: 'Cancer/lung/liver (3yr)' },
    { key: 'q8c', label: 'Neurological conditions (3yr)' },
  ];

  const gradedFlags: string[] = [];
  for (const q of gradedQuestions) {
    if (answers[q.key as keyof HealthAnswers] === true) {
      gradedFlags.push(q.label);
    }
  }

  if (gradedFlags.length > 0) {
    return {
      tier: 'GRADED',
      planType: 'Graded',
      message: 'Qualifies for Graded benefit plan (2-year waiting period)',
      disqualifyingQuestions: gradedFlags,
    };
  }

  // All No → LEVEL (Best tier - First Day Coverage)
  return {
    tier: 'LEVEL',
    planType: 'Level',
    message: 'Qualifies for Level plan with First Day Coverage!',
    disqualifyingQuestions: [],
  };
}

/**
 * Get available carriers for a given eligibility tier
 */
export function getCarriersForTier(tier: EligibilityTier): string[] {
  switch (tier) {
    case 'NOT_ELIGIBLE':
      return []; // No carriers available
    case 'LEVEL':
      return ['American Amicable'];
    case 'ROP':
      return ['American Amicable']; // Only AA offers ROP
    case 'GRADED':
      return ['GTL', 'American Amicable'];
    case 'GI':
      return ['GTL']; // Guaranteed Issue fallback
    default:
      return [];
  }
}

/**
 * Check if all required health questions have been answered
 */
export function areHealthQuestionsComplete(answers: HealthAnswers): boolean {
  const requiredQ1to3 = ['q1', 'q2', 'q3'] as const;
  for (const key of requiredQ1to3) {
    if (answers[key] === null || answers[key] === undefined) {
      return false;
    }
  }
  // Q1-Q3 answered - if any are true, we stop there (NOT ELIGIBLE)
  if (answers.q1 || answers.q2 || answers.q3) {
    return true;
  }
  // Need to check Q4-Q8 for LEVEL/ROP/GRADED determination
  const remainingQuestions = ['q4', 'q5', 'q6', 'q7a', 'q8a', 'q8b', 'q8c'] as const;
  for (const key of remainingQuestions) {
    if (answers[key] === null || answers[key] === undefined) {
      return false;
    }
  }
  return true;
}

// ============================================================================
// CALCULATION FUNCTIONS
// ============================================================================

interface QuoteParams {
  age: number;
  gender: 'male' | 'female';
  tobacco: boolean;
  faceAmount: number;
  eligibilityTier?: EligibilityTier;
}

interface CarrierQuote {
  carrier: string;
  planType: string;
  premium: number | null;
  isEligible: boolean;
  eligibilityReason?: string;
}

/**
 * Calculate monthly premium for American Amicable (Level, Graded, ROP) using amam sheet rates
 */
function calculateAmAmPremium(
  params: QuoteParams,
  _planType: 'Level' | 'Graded' | 'ROP'
): number | null {
  const { age, gender, tobacco, faceAmount } = params;
  const config = CARRIER_CONFIG['American Amicable'];

  const rates = AMAM_RATES[age];
  if (!rates) return null;

  const rateKey =
    gender === 'male' ? (tobacco ? 'maleSm' : 'maleNS') : tobacco ? 'femaleSm' : 'femaleNS';
  const baseRate = rates[rateKey];

  // Rate is per $1,000 coverage, adjust for face amount
  const annualPremium = baseRate * (faceAmount / 1000) + config.annualFee;
  return Math.round(annualPremium * config.monthlyFactor * 100) / 100;
}

/**
 * Calculate monthly premium for GTL using gtl sheet rates
 */
function calculateGTLPremium(params: QuoteParams): number | null {
  const { age, gender, faceAmount } = params;
  const rates = GTL_RATES[age];
  if (!rates) return null;

  const baseRate = rates[gender];
  const config = CARRIER_CONFIG['GTL'];

  // Rate is per $1,000 coverage, adjust for face amount
  const annualPremium = baseRate * (faceAmount / 1000) + config.annualFee;
  return Math.round(annualPremium * config.monthlyFactor * 100) / 100;
}

/**
 * Check if age is within carrier's range
 */
export function isAgeEligible(carrier: string, age: number): boolean {
  const config = CARRIER_CONFIG[carrier];
  if (!config) return false;
  return age >= config.minAge && age <= config.maxAge;
}

/**
 * Get all carrier quotes for given parameters
 * Restricted to active carriers (American Amicable & GTL) and respects eligibility tier
 */
export function getAllCarrierQuotes(
  params: QuoteParams,
  eligibilityTier?: EligibilityTier
): CarrierQuote[] {
  const { age } = params;
  const quotes: CarrierQuote[] = [];

  // Get available carriers based on eligibility tier
  const availableCarriers = eligibilityTier
    ? getCarriersForTier(eligibilityTier)
    : Object.keys(CARRIERS);

  // GTL (Graded only)
  if (isAgeEligible('GTL', age)) {
    quotes.push({
      carrier: 'GTL',
      planType: 'Graded',
      premium: calculateGTLPremium(params),
      isEligible: availableCarriers.includes('GTL'),
    });
  }

  // American Amicable (Level, Graded, ROP)
  if (isAgeEligible('American Amicable', age)) {
    // Level
    quotes.push({
      carrier: 'American Amicable',
      planType: 'Level',
      premium: calculateAmAmPremium(params, 'Level'),
      isEligible: availableCarriers.includes('American Amicable') && eligibilityTier === 'LEVEL',
    });
    // Graded
    quotes.push({
      carrier: 'American Amicable',
      planType: 'Graded',
      premium: calculateAmAmPremium(params, 'Graded'),
      isEligible: availableCarriers.includes('American Amicable') && eligibilityTier === 'GRADED',
    });
    // ROP
    quotes.push({
      carrier: 'American Amicable',
      planType: 'ROP',
      premium: calculateAmAmPremium(params, 'ROP'),
      isEligible: availableCarriers.includes('American Amicable') && eligibilityTier === 'ROP',
    });
  }

  // Sort by: eligible first, then by premium (lowest first)
  return quotes.sort((a, b) => {
    if (a.isEligible && !b.isEligible) return -1;
    if (!a.isEligible && b.isEligible) return 1;
    return (a.premium || 9999) - (b.premium || 9999);
  });
}

/**
 * Calculate age from date of birth
 */
export function calculateAgeFromDOB(dob: string): number {
  const birthDate = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }

  return age;
}

/**
 * Format currency for display
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export { CARRIER_CONFIG };
