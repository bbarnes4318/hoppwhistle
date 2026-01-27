// Quote Calculator for Call Center Portal
// Rate tables for all carriers and premium calculation functions

// ============================================================================
// AFLAC RATES (Ages 45-80)
// ============================================================================

const AFLAC_RATES: Record<
  number,
  { maleNS: number; maleSm: number; femaleNS: number; femaleSm: number }
> = {
  45: { maleNS: 28.97, maleSm: 45.4, femaleNS: 24, femaleSm: 36.7 },
  46: { maleNS: 29.87, maleSm: 45.83, femaleNS: 24.41, femaleSm: 37.05 },
  47: { maleNS: 30.78, maleSm: 46.29, femaleNS: 24.81, femaleSm: 37.43 },
  48: { maleNS: 31.68, maleSm: 46.76, femaleNS: 25.22, femaleSm: 37.81 },
  49: { maleNS: 32.59, maleSm: 47.23, femaleNS: 25.62, femaleSm: 38.19 },
  50: { maleNS: 33.49, maleSm: 47.71, femaleNS: 26.03, femaleSm: 38.57 },
  51: { maleNS: 34.58, maleSm: 50, femaleNS: 26.6, femaleSm: 40.17 },
  52: { maleNS: 35.67, maleSm: 52.28, femaleNS: 27.16, femaleSm: 41.77 },
  53: { maleNS: 36.75, maleSm: 54.57, femaleNS: 27.73, femaleSm: 43.37 },
  54: { maleNS: 37.84, maleSm: 56.85, femaleNS: 28.29, femaleSm: 44.97 },
  55: { maleNS: 38.93, maleSm: 59.14, femaleNS: 28.86, femaleSm: 46.57 },
  56: { maleNS: 40.5, maleSm: 61.42, femaleNS: 30.04, femaleSm: 48.17 },
  57: { maleNS: 42.08, maleSm: 63.71, femaleNS: 31.23, femaleSm: 49.77 },
  58: { maleNS: 43.66, maleSm: 66, femaleNS: 32.42, femaleSm: 51.37 },
  59: { maleNS: 45.23, maleSm: 68.28, femaleNS: 33.61, femaleSm: 52.97 },
  60: { maleNS: 46.81, maleSm: 70.57, femaleNS: 34.8, femaleSm: 54.57 },
  61: { maleNS: 49.24, maleSm: 75.48, femaleNS: 36.93, femaleSm: 57.31 },
  62: { maleNS: 51.67, maleSm: 80.4, femaleNS: 39.06, femaleSm: 60.06 },
  63: { maleNS: 54.11, maleSm: 85.31, femaleNS: 41.2, femaleSm: 62.8 },
  64: { maleNS: 56.54, maleSm: 90.23, femaleNS: 43.33, femaleSm: 65.54 },
  65: { maleNS: 58.98, maleSm: 95.14, femaleNS: 45.47, femaleSm: 68.29 },
  66: { maleNS: 62.67, maleSm: 100.06, femaleNS: 48.21, femaleSm: 71.03 },
  67: { maleNS: 66.37, maleSm: 104.97, femaleNS: 50.95, femaleSm: 73.77 },
  68: { maleNS: 70.07, maleSm: 109.89, femaleNS: 53.69, femaleSm: 76.52 },
  69: { maleNS: 73.76, maleSm: 114.8, femaleNS: 56.43, femaleSm: 79.26 },
  70: { maleNS: 77.46, maleSm: 119.72, femaleNS: 59.17, femaleSm: 82 },
  71: { maleNS: 83.85, maleSm: 131.6, femaleNS: 65.11, femaleSm: 91.14 },
  72: { maleNS: 90.25, maleSm: 143.49, femaleNS: 71.04, femaleSm: 100.29 },
  73: { maleNS: 96.64, maleSm: 155.37, femaleNS: 76.98, femaleSm: 109.43 },
  74: { maleNS: 103.03, maleSm: 167.26, femaleNS: 82.92, femaleSm: 118.57 },
  75: { maleNS: 109.42, maleSm: 179.14, femaleNS: 88.85, femaleSm: 127.72 },
  76: { maleNS: 122.23, maleSm: 191.03, femaleNS: 96.63, femaleSm: 136.86 },
  77: { maleNS: 135.03, maleSm: 202.91, femaleNS: 104.4, femaleSm: 146 },
  78: { maleNS: 147.83, maleSm: 214.8, femaleNS: 112.17, femaleSm: 155.15 },
  79: { maleNS: 160.63, maleSm: 226.69, femaleNS: 119.94, femaleSm: 164.29 },
  80: { maleNS: 173.43, maleSm: 238.57, femaleNS: 127.72, femaleSm: 173.43 },
};

// ============================================================================
// SBLI RATES (Ages 50-85)
// ============================================================================

const SBLI_RATES: Record<
  number,
  { maleNS: number; maleSm: number; femaleNS: number; femaleSm: number }
> = {
  50: { maleNS: 38.9, maleSm: 52.9, femaleNS: 30.85, femaleSm: 41.8 },
  51: { maleNS: 40.35, maleSm: 55.05, femaleNS: 32.05, femaleSm: 43.25 },
  52: { maleNS: 41.8, maleSm: 57.2, femaleNS: 33.25, femaleSm: 44.7 },
  53: { maleNS: 43.25, maleSm: 59.35, femaleNS: 34.45, femaleSm: 46.15 },
  54: { maleNS: 44.7, maleSm: 61.5, femaleNS: 35.65, femaleSm: 47.6 },
  55: { maleNS: 46.15, maleSm: 63.65, femaleNS: 36.85, femaleSm: 49.05 },
  56: { maleNS: 48.2, maleSm: 66.5, femaleNS: 38.5, femaleSm: 51.25 },
  57: { maleNS: 50.25, maleSm: 69.35, femaleNS: 40.15, femaleSm: 53.45 },
  58: { maleNS: 52.3, maleSm: 72.2, femaleNS: 41.8, femaleSm: 55.65 },
  59: { maleNS: 54.35, maleSm: 75.05, femaleNS: 43.45, femaleSm: 57.85 },
  60: { maleNS: 56.4, maleSm: 77.9, femaleNS: 45.1, femaleSm: 60.05 },
  61: { maleNS: 59.35, maleSm: 82.4, femaleNS: 47.55, femaleSm: 63.35 },
  62: { maleNS: 62.3, maleSm: 86.9, femaleNS: 50, femaleSm: 66.65 },
  63: { maleNS: 65.25, maleSm: 91.4, femaleNS: 52.45, femaleSm: 69.95 },
  64: { maleNS: 68.2, maleSm: 95.9, femaleNS: 54.9, femaleSm: 73.25 },
  65: { maleNS: 71.15, maleSm: 100.4, femaleNS: 57.35, femaleSm: 76.55 },
  66: { maleNS: 76.2, maleSm: 108.5, femaleNS: 61.8, femaleSm: 83.5 },
  67: { maleNS: 81.25, maleSm: 116.6, femaleNS: 66.25, femaleSm: 90.45 },
  68: { maleNS: 86.3, maleSm: 124.7, femaleNS: 70.7, femaleSm: 97.4 },
  69: { maleNS: 91.35, maleSm: 132.8, femaleNS: 75.15, femaleSm: 104.35 },
  70: { maleNS: 96.4, maleSm: 140.9, femaleNS: 79.6, femaleSm: 111.3 },
  71: { maleNS: 105.1, maleSm: 153.2, femaleNS: 86.85, femaleSm: 121.15 },
  72: { maleNS: 113.8, maleSm: 165.5, femaleNS: 94.1, femaleSm: 131 },
  73: { maleNS: 122.5, maleSm: 177.8, femaleNS: 101.35, femaleSm: 140.85 },
  74: { maleNS: 131.2, maleSm: 190.1, femaleNS: 108.6, femaleSm: 150.7 },
  75: { maleNS: 139.9, maleSm: 202.4, femaleNS: 115.85, femaleSm: 160.55 },
  76: { maleNS: 153.2, maleSm: 219.1, femaleNS: 126.9, femaleSm: 172.95 },
  77: { maleNS: 166.5, maleSm: 235.8, femaleNS: 137.95, femaleSm: 185.35 },
  78: { maleNS: 179.8, maleSm: 252.5, femaleNS: 149, femaleSm: 197.75 },
  79: { maleNS: 193.1, maleSm: 269.2, femaleNS: 160.05, femaleSm: 210.15 },
  80: { maleNS: 206.4, maleSm: 285.9, femaleNS: 171.1, femaleSm: 222.55 },
  81: { maleNS: 223.1, maleSm: 310.2, femaleNS: 184.6, femaleSm: 241.2 },
  82: { maleNS: 239.8, maleSm: 334.5, femaleNS: 198.1, femaleSm: 259.85 },
  83: { maleNS: 256.5, maleSm: 358.8, femaleNS: 211.6, femaleSm: 278.5 },
  84: { maleNS: 273.2, maleSm: 383.1, femaleNS: 225.1, femaleSm: 297.15 },
  85: { maleNS: 289.9, maleSm: 407.4, femaleNS: 238.6, femaleSm: 315.8 },
};

// ============================================================================
// CICA RATES (Ages 45-85, no tobacco distinction)
// ============================================================================

const CICA_RATES: Record<number, { male: number; female: number }> = {
  45: { male: 32.38, female: 30.03 },
  46: { male: 33.63, female: 31.21 },
  47: { male: 34.89, female: 32.39 },
  48: { male: 36.24, female: 33.64 },
  49: { male: 37.67, female: 34.9 },
  50: { male: 39.11, female: 36.25 },
  51: { male: 40.72, female: 37.68 },
  52: { male: 42.74, female: 39.12 },
  53: { male: 44.92, female: 40.63 },
  54: { male: 47.21, female: 42.54 },
  55: { male: 49.63, female: 44.61 },
  56: { male: 52.39, female: 46.77 },
  57: { male: 55.03, female: 49.05 },
  58: { male: 57.78, female: 51.66 },
  59: { male: 60.68, female: 54.13 },
  60: { male: 63.71, female: 56.7 },
  61: { male: 66.9, female: 59.41 },
  62: { male: 70.25, female: 62.22 },
  63: { male: 73.76, female: 65.18 },
  64: { male: 77.46, female: 68.28 },
  65: { male: 83.12, female: 72.04 },
  66: { male: 89.2, female: 76.36 },
  67: { male: 95.72, female: 80.94 },
  68: { male: 102.72, female: 85.8 },
  69: { male: 110.22, female: 90.94 },
  70: { male: 118.28, female: 96.4 },
  71: { male: 126.93, female: 102.18 },
  72: { male: 136.21, female: 108.31 },
  73: { male: 146.17, female: 114.81 },
  74: { male: 156.85, female: 121.7 },
  75: { male: 168.32, female: 129 },
  76: { male: 180.62, female: 136.74 },
  77: { male: 193.83, female: 144.95 },
  78: { male: 208, female: 153.65 },
  79: { male: 223.08, female: 164.4 },
  80: { male: 239.25, female: 175.91 },
  81: { male: 256.6, female: 188.22 },
  82: { male: 275.2, female: 201.4 },
  83: { male: 295.15, female: 215.5 },
  84: { male: 316.55, female: 230.58 },
  85: { male: 339.5, female: 246.72 },
};

// ============================================================================
// GTL RATES (Ages 40-89, Graded only)
// ============================================================================

const GTL_RATES: Record<number, { male: number; female: number }> = {
  40: { male: 55, female: 40 },
  45: { male: 60, female: 40 },
  50: { male: 61, female: 41 },
  55: { male: 67, female: 51 },
  60: { male: 78, female: 60 },
  65: { male: 100, female: 73 },
  70: { male: 120, female: 90 },
  75: { male: 172, female: 132 },
  80: { male: 290, female: 210 },
  85: { male: 375, female: 260 },
};

// ============================================================================
// CARRIER CONFIGURATION
// ============================================================================

interface CarrierConfig {
  annualFee: number;
  monthlyFactor: number;
  hasTobacco: boolean;
  minAge: number;
  maxAge: number;
}

const CARRIER_CONFIG: Record<string, CarrierConfig> = {
  Aflac: { annualFee: 48, monthlyFactor: 0.0875, hasTobacco: true, minAge: 45, maxAge: 80 },
  SBLI: { annualFee: 48, monthlyFactor: 0.087, hasTobacco: true, minAge: 50, maxAge: 85 },
  CICA: { annualFee: 48, monthlyFactor: 0.087, hasTobacco: false, minAge: 45, maxAge: 85 },
  GTL: { annualFee: 48, monthlyFactor: 0.08333, hasTobacco: false, minAge: 40, maxAge: 89 },
};

// ============================================================================
// CALCULATION FUNCTIONS
// ============================================================================

interface QuoteParams {
  age: number;
  gender: 'male' | 'female';
  tobacco: boolean;
  faceAmount: number;
}

interface CarrierQuote {
  carrier: string;
  planType: string;
  premium: number | null;
  isEligible: boolean;
  eligibilityReason?: string;
}

/**
 * Calculate monthly premium for Aflac
 */
function calculateAflacPremium(params: QuoteParams): number | null {
  const { age, gender, tobacco, faceAmount } = params;
  const rates = AFLAC_RATES[age];
  if (!rates) return null;

  const rateKey =
    gender === 'male' ? (tobacco ? 'maleSm' : 'maleNS') : tobacco ? 'femaleSm' : 'femaleNS';

  const baseRate = rates[rateKey];
  const config = CARRIER_CONFIG['Aflac'];

  // Rate is per $10,000 coverage, adjust for face amount
  const annualPremium = baseRate * (faceAmount / 10000) + config.annualFee;
  return Math.round(annualPremium * config.monthlyFactor * 100) / 100;
}

/**
 * Calculate monthly premium for SBLI
 */
function calculateSBLIPremium(params: QuoteParams): number | null {
  const { age, gender, tobacco, faceAmount } = params;
  const rates = SBLI_RATES[age];
  if (!rates) return null;

  const rateKey =
    gender === 'male' ? (tobacco ? 'maleSm' : 'maleNS') : tobacco ? 'femaleSm' : 'femaleNS';

  const baseRate = rates[rateKey];
  const config = CARRIER_CONFIG['SBLI'];

  const annualPremium = baseRate * (faceAmount / 10000) + config.annualFee;
  return Math.round(annualPremium * config.monthlyFactor * 100) / 100;
}

/**
 * Calculate monthly premium for CICA
 */
function calculateCICAPremium(params: QuoteParams): number | null {
  const { age, gender, faceAmount } = params;
  const rates = CICA_RATES[age];
  if (!rates) return null;

  const baseRate = rates[gender];
  const config = CARRIER_CONFIG['CICA'];

  const annualPremium = baseRate * (faceAmount / 10000) + config.annualFee;
  return Math.round(annualPremium * config.monthlyFactor * 100) / 100;
}

/**
 * Calculate monthly premium for GTL
 */
function calculateGTLPremium(params: QuoteParams): number | null {
  const { age, gender, faceAmount } = params;

  // GTL uses bracketed ages - find closest lower bracket
  const ageKeys = Object.keys(GTL_RATES)
    .map(Number)
    .sort((a, b) => a - b);
  let bracketAge = ageKeys[0];
  for (const key of ageKeys) {
    if (key <= age) bracketAge = key;
    else break;
  }

  const rates = GTL_RATES[bracketAge];
  if (!rates) return null;

  const baseRate = rates[gender];
  const config = CARRIER_CONFIG['GTL'];

  const annualPremium = baseRate * (faceAmount / 10000) + config.annualFee;
  return Math.round(annualPremium * config.monthlyFactor * 100) / 100;
}

/**
 * Check if age is within carrier's range
 */
function isAgeEligible(carrier: string, age: number): boolean {
  const config = CARRIER_CONFIG[carrier];
  if (!config) return false;
  return age >= config.minAge && age <= config.maxAge;
}

/**
 * Get all carrier quotes for given parameters
 */
export function getAllCarrierQuotes(params: QuoteParams): CarrierQuote[] {
  const { age } = params;
  const quotes: CarrierQuote[] = [];

  // Aflac
  if (isAgeEligible('Aflac', age)) {
    quotes.push({
      carrier: 'Aflac',
      planType: 'Level',
      premium: calculateAflacPremium(params),
      isEligible: true,
    });
  } else {
    quotes.push({
      carrier: 'Aflac',
      planType: 'Level',
      premium: null,
      isEligible: false,
      eligibilityReason: `Age must be 45-80 (current: ${age})`,
    });
  }

  // SBLI
  if (isAgeEligible('SBLI', age)) {
    quotes.push({
      carrier: 'SBLI',
      planType: 'Level',
      premium: calculateSBLIPremium(params),
      isEligible: true,
    });
  } else {
    quotes.push({
      carrier: 'SBLI',
      planType: 'Level',
      premium: null,
      isEligible: false,
      eligibilityReason: `Age must be 50-85 (current: ${age})`,
    });
  }

  // CICA
  if (isAgeEligible('CICA', age)) {
    quotes.push({
      carrier: 'CICA',
      planType: 'Level',
      premium: calculateCICAPremium(params),
      isEligible: true,
    });
  } else {
    quotes.push({
      carrier: 'CICA',
      planType: 'Level',
      premium: null,
      isEligible: false,
      eligibilityReason: `Age must be 45-85 (current: ${age})`,
    });
  }

  // GTL (Graded only)
  if (isAgeEligible('GTL', age)) {
    quotes.push({
      carrier: 'GTL',
      planType: 'Graded',
      premium: calculateGTLPremium(params),
      isEligible: true,
    });
  } else {
    quotes.push({
      carrier: 'GTL',
      planType: 'Graded',
      premium: null,
      isEligible: false,
      eligibilityReason: `Age must be 40-89 (current: ${age})`,
    });
  }

  // Sort by premium (eligible first, then by price)
  return quotes.sort((a, b) => {
    if (a.isEligible && !b.isEligible) return -1;
    if (!a.isEligible && b.isEligible) return 1;
    return (a.premium || 999) - (b.premium || 999);
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
