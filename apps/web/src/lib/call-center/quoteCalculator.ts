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
  45: { male: 60, female: 45 },
  50: { male: 65, female: 48 },
  55: { male: 75, female: 55 },
  60: { male: 90, female: 65 },
  65: { male: 110, female: 80 },
  70: { male: 140, female: 100 },
  75: { male: 185, female: 135 },
  80: { male: 250, female: 180 },
  85: { male: 340, female: 245 },
};

// ============================================================================
// AMERICAN AMICABLE RATES (Level, Graded, ROP)
// ============================================================================

const AMERICAN_AMICABLE_LEVEL: Record<
  number,
  { maleNS: number; maleSm: number; femaleNS: number; femaleSm: number }
> = {
  45: { maleNS: 25.5, maleSm: 38.25, femaleNS: 21.25, femaleSm: 31.88 },
  50: { maleNS: 30.0, maleSm: 45.0, femaleNS: 25.0, femaleSm: 37.5 },
  55: { maleNS: 36.0, maleSm: 54.0, femaleNS: 30.0, femaleSm: 45.0 },
  60: { maleNS: 44.0, maleSm: 66.0, femaleNS: 36.67, femaleSm: 55.0 },
  65: { maleNS: 55.0, maleSm: 82.5, femaleNS: 45.83, femaleSm: 68.75 },
  70: { maleNS: 70.0, maleSm: 105.0, femaleNS: 58.33, femaleSm: 87.5 },
  75: { maleNS: 92.0, maleSm: 138.0, femaleNS: 76.67, femaleSm: 115.0 },
  80: { maleNS: 125.0, maleSm: 187.5, femaleNS: 104.17, femaleSm: 156.25 },
  85: { maleNS: 170.0, maleSm: 255.0, femaleNS: 141.67, femaleSm: 212.5 },
};

const AMERICAN_AMICABLE_GRADED: Record<number, { male: number; female: number }> = {
  45: { male: 42.5, female: 35.42 },
  50: { male: 50.0, female: 41.67 },
  55: { male: 60.0, female: 50.0 },
  60: { male: 73.33, female: 61.11 },
  65: { male: 91.67, female: 76.39 },
  70: { male: 116.67, female: 97.22 },
  75: { male: 153.33, female: 127.78 },
  80: { male: 208.33, female: 173.61 },
  85: { male: 283.33, female: 236.11 },
};

const AMERICAN_AMICABLE_ROP: Record<
  number,
  { maleNS: number; maleSm: number; femaleNS: number; femaleSm: number }
> = {
  45: { maleNS: 35.7, maleSm: 53.55, femaleNS: 29.75, femaleSm: 44.63 },
  50: { maleNS: 42.0, maleSm: 63.0, femaleNS: 35.0, femaleSm: 52.5 },
  55: { maleNS: 50.4, maleSm: 75.6, femaleNS: 42.0, femaleSm: 63.0 },
  60: { maleNS: 61.6, maleSm: 92.4, femaleNS: 51.33, femaleSm: 77.0 },
  65: { maleNS: 77.0, maleSm: 115.5, femaleNS: 64.17, femaleSm: 96.25 },
  70: { maleNS: 98.0, maleSm: 147.0, femaleNS: 81.67, femaleSm: 122.5 },
  75: { maleNS: 128.8, maleSm: 193.2, femaleNS: 107.33, femaleSm: 161.0 },
};

// ============================================================================
// TRANSAMERICA RATES (Level, Graded)
// ============================================================================

const TRANSAMERICA_LEVEL: Record<
  number,
  { maleNS: number; maleSm: number; femaleNS: number; femaleSm: number }
> = {
  45: { maleNS: 26.5, maleSm: 39.75, femaleNS: 22.08, femaleSm: 33.13 },
  50: { maleNS: 31.2, maleSm: 46.8, femaleNS: 26.0, femaleSm: 39.0 },
  55: { maleNS: 37.44, maleSm: 56.16, femaleNS: 31.2, femaleSm: 46.8 },
  60: { maleNS: 45.76, maleSm: 68.64, femaleNS: 38.13, femaleSm: 57.2 },
  65: { maleNS: 57.2, maleSm: 85.8, femaleNS: 47.67, femaleSm: 71.5 },
  70: { maleNS: 72.8, maleSm: 109.2, femaleNS: 60.67, femaleSm: 91.0 },
  75: { maleNS: 95.68, maleSm: 143.52, femaleNS: 79.73, femaleSm: 119.6 },
  80: { maleNS: 130.0, maleSm: 195.0, femaleNS: 108.33, femaleSm: 162.5 },
};

const TRANSAMERICA_GRADED: Record<number, { male: number; female: number }> = {
  45: { male: 44.17, female: 36.81 },
  50: { male: 52.0, female: 43.33 },
  55: { male: 62.4, female: 52.0 },
  60: { male: 76.27, female: 63.56 },
  65: { male: 95.33, female: 79.44 },
  70: { male: 121.33, female: 101.11 },
  75: { male: 159.47, female: 132.89 },
  80: { male: 216.67, female: 180.56 },
};

// ============================================================================
// COREBRIDGE RATES (Guaranteed Issue only, no health Qs)
// ============================================================================

const COREBRIDGE_GI: Record<number, { male: number; female: number }> = {
  45: { male: 45.0, female: 38.0 },
  50: { male: 52.0, female: 44.0 },
  55: { male: 62.0, female: 52.0 },
  60: { male: 75.0, female: 63.0 },
  65: { male: 92.0, female: 77.0 },
  70: { male: 115.0, female: 96.0 },
  75: { male: 148.0, female: 123.0 },
  80: { male: 195.0, female: 163.0 },
  85: { male: 260.0, female: 217.0 },
};

// ============================================================================
// AHL RATES (Level, Graded)
// ============================================================================

const AHL_LEVEL: Record<
  number,
  { maleNS: number; maleSm: number; femaleNS: number; femaleSm: number }
> = {
  50: { maleNS: 32.0, maleSm: 48.0, femaleNS: 26.67, femaleSm: 40.0 },
  55: { maleNS: 38.4, maleSm: 57.6, femaleNS: 32.0, femaleSm: 48.0 },
  60: { maleNS: 46.93, maleSm: 70.4, femaleNS: 39.11, femaleSm: 58.67 },
  65: { maleNS: 58.67, maleSm: 88.0, femaleNS: 48.89, femaleSm: 73.33 },
  70: { maleNS: 74.67, maleSm: 112.0, femaleNS: 62.22, femaleSm: 93.33 },
  75: { maleNS: 98.13, maleSm: 147.2, femaleNS: 81.78, femaleSm: 122.67 },
  80: { maleNS: 133.33, maleSm: 200.0, femaleNS: 111.11, femaleSm: 166.67 },
};

const AHL_GRADED: Record<number, { male: number; female: number }> = {
  50: { male: 53.33, female: 44.44 },
  55: { male: 64.0, female: 53.33 },
  60: { male: 78.22, female: 65.19 },
  65: { male: 97.78, female: 81.48 },
  70: { male: 124.44, female: 103.7 },
  75: { male: 163.56, female: 136.3 },
  80: { male: 222.22, female: 185.19 },
};

// ============================================================================
// ROYAL NEIGHBORS RATES (Level, Graded)
// ============================================================================

const ROYAL_NEIGHBORS_LEVEL: Record<
  number,
  { maleNS: number; maleSm: number; femaleNS: number; femaleSm: number }
> = {
  50: { maleNS: 29.0, maleSm: 43.5, femaleNS: 24.17, femaleSm: 36.25 },
  55: { maleNS: 34.8, maleSm: 52.2, femaleNS: 29.0, femaleSm: 43.5 },
  60: { maleNS: 42.53, maleSm: 63.8, femaleNS: 35.44, femaleSm: 53.17 },
  65: { maleNS: 53.17, maleSm: 79.75, femaleNS: 44.31, femaleSm: 66.46 },
  70: { maleNS: 67.67, maleSm: 101.5, femaleNS: 56.39, femaleSm: 84.58 },
  75: { maleNS: 88.93, maleSm: 133.4, femaleNS: 74.11, femaleSm: 111.17 },
  80: { maleNS: 120.83, maleSm: 181.25, femaleNS: 100.69, femaleSm: 151.04 },
};

const ROYAL_NEIGHBORS_GRADED: Record<number, { male: number; female: number }> = {
  50: { male: 48.33, female: 40.28 },
  55: { male: 58.0, female: 48.33 },
  60: { male: 70.89, female: 59.07 },
  65: { male: 88.61, female: 73.84 },
  70: { male: 112.78, female: 93.98 },
  75: { male: 148.22, female: 123.52 },
  80: { male: 201.39, female: 167.82 },
};

// ============================================================================
// GERBER RATES (Guaranteed Issue only)
// ============================================================================

const GERBER_GI: Record<number, { male: number; female: number }> = {
  50: { male: 48.0, female: 40.0 },
  55: { male: 57.6, female: 48.0 },
  60: { male: 70.4, female: 58.67 },
  65: { male: 88.0, female: 73.33 },
  70: { male: 112.0, female: 93.33 },
  75: { male: 147.2, female: 122.67 },
  80: { male: 200.0, female: 166.67 },
};

// ============================================================================
// MUTUAL OF OMAHA RATES (Level, Graded)
// ============================================================================

const MUTUAL_OF_OMAHA_LEVEL: Record<
  number,
  { maleNS: number; maleSm: number; femaleNS: number; femaleSm: number }
> = {
  45: { maleNS: 27.0, maleSm: 40.5, femaleNS: 22.5, femaleSm: 33.75 },
  50: { maleNS: 31.8, maleSm: 47.7, femaleNS: 26.5, femaleSm: 39.75 },
  55: { maleNS: 38.16, maleSm: 57.24, femaleNS: 31.8, femaleSm: 47.7 },
  60: { maleNS: 46.64, maleSm: 69.96, femaleNS: 38.87, femaleSm: 58.3 },
  65: { maleNS: 58.3, maleSm: 87.45, femaleNS: 48.58, femaleSm: 72.88 },
  70: { maleNS: 74.2, maleSm: 111.3, femaleNS: 61.83, femaleSm: 92.75 },
  75: { maleNS: 97.52, maleSm: 146.28, femaleNS: 81.27, femaleSm: 121.9 },
  80: { maleNS: 132.56, maleSm: 198.84, femaleNS: 110.47, femaleSm: 165.7 },
};

const MUTUAL_OF_OMAHA_GRADED: Record<number, { male: number; female: number }> = {
  45: { male: 45.0, female: 37.5 },
  50: { male: 53.0, female: 44.17 },
  55: { male: 63.6, female: 53.0 },
  60: { male: 77.73, female: 64.78 },
  65: { male: 97.17, female: 80.97 },
  70: { male: 123.67, female: 103.06 },
  75: { male: 162.53, female: 135.44 },
  80: { male: 220.93, female: 184.11 },
};

// ============================================================================
// CARRIER CONFIGURATION - ALL 11 CARRIERS
// ============================================================================

export const CARRIERS = {
  'American Amicable': ['Level', 'Graded', 'ROP'],
  Corebridge: ['Guaranteed Issue'],
  TransAmerica: ['Level', 'Graded'],
  Aflac: ['Level', 'Modified'],
  SBLI: ['Level', 'Modified'],
  CICA: ['Level', 'Guaranteed Issue'],
  GTL: ['Graded'],
  AHL: ['Level', 'Graded'],
  'Royal Neighbors': ['Level', 'Graded'],
  Gerber: ['Guaranteed Issue'],
  'Mutual of Omaha': ['Level', 'Graded'],
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
  Aflac: {
    annualFee: 48,
    monthlyFactor: 0.0875,
    hasTobacco: true,
    minAge: 45,
    maxAge: 80,
    planTypes: ['Level', 'Modified'],
  },
  SBLI: {
    annualFee: 48,
    monthlyFactor: 0.087,
    hasTobacco: true,
    minAge: 50,
    maxAge: 85,
    planTypes: ['Level', 'Modified'],
  },
  CICA: {
    annualFee: 48,
    monthlyFactor: 0.087,
    hasTobacco: false,
    minAge: 45,
    maxAge: 85,
    planTypes: ['Level', 'Guaranteed Issue'],
  },
  GTL: {
    annualFee: 48,
    monthlyFactor: 0.08333,
    hasTobacco: false,
    minAge: 40,
    maxAge: 89,
    planTypes: ['Graded'],
  },
  'American Amicable': {
    annualFee: 30,
    monthlyFactor: 0.088,
    hasTobacco: true,
    minAge: 45,
    maxAge: 85,
    planTypes: ['Level', 'Graded', 'ROP'],
  },
  TransAmerica: {
    annualFee: 48,
    monthlyFactor: 0.0875,
    hasTobacco: true,
    minAge: 45,
    maxAge: 80,
    planTypes: ['Level', 'Graded'],
  },
  Corebridge: {
    annualFee: 0,
    monthlyFactor: 0.083,
    hasTobacco: false,
    minAge: 45,
    maxAge: 85,
    planTypes: ['Guaranteed Issue'],
  },
  AHL: {
    annualFee: 120,
    monthlyFactor: 0.0875,
    hasTobacco: true,
    minAge: 50,
    maxAge: 80,
    planTypes: ['Level', 'Graded'],
  },
  'Royal Neighbors': {
    annualFee: 30,
    monthlyFactor: 0.087,
    hasTobacco: true,
    minAge: 50,
    maxAge: 80,
    planTypes: ['Level', 'Graded'],
  },
  Gerber: {
    annualFee: 11,
    monthlyFactor: 0.083334,
    hasTobacco: false,
    minAge: 50,
    maxAge: 80,
    planTypes: ['Guaranteed Issue'],
  },
  'Mutual of Omaha': {
    annualFee: 36,
    monthlyFactor: 0.089,
    hasTobacco: true,
    minAge: 45,
    maxAge: 80,
    planTypes: ['Level', 'Graded'],
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
      return ['Aflac', 'SBLI', 'CICA', 'American Amicable', 'TransAmerica', 'Mutual of Omaha'];
    case 'ROP':
      return ['American Amicable']; // Only AA offers ROP
    case 'GRADED':
      return ['GTL', 'American Amicable', 'TransAmerica', 'Royal Neighbors'];
    case 'GI':
      return ['GTL', 'Corebridge', 'Gerber']; // Guaranteed Issue
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
 * Calculate monthly premium for American Amicable (Level, Graded, ROP)
 */
function calculateAmAmPremium(
  params: QuoteParams,
  planType: 'Level' | 'Graded' | 'ROP'
): number | null {
  const { age, gender, tobacco, faceAmount } = params;
  const config = CARRIER_CONFIG['American Amicable'];

  // Find bracketed age
  const findBracketAge = (rateTable: Record<number, unknown>) => {
    const ageKeys = Object.keys(rateTable)
      .map(Number)
      .sort((a, b) => a - b);
    let bracketAge = ageKeys[0];
    for (const key of ageKeys) {
      if (key <= age) bracketAge = key;
      else break;
    }
    return bracketAge;
  };

  if (planType === 'Level') {
    const bracketAge = findBracketAge(AMERICAN_AMICABLE_LEVEL);
    const rates = AMERICAN_AMICABLE_LEVEL[bracketAge];
    if (!rates) return null;
    const rateKey =
      gender === 'male' ? (tobacco ? 'maleSm' : 'maleNS') : tobacco ? 'femaleSm' : 'femaleNS';
    const baseRate = rates[rateKey];
    const annualPremium = baseRate * (faceAmount / 10000) + config.annualFee;
    return Math.round(annualPremium * config.monthlyFactor * 100) / 100;
  }

  if (planType === 'Graded') {
    const bracketAge = findBracketAge(AMERICAN_AMICABLE_GRADED);
    const rates = AMERICAN_AMICABLE_GRADED[bracketAge];
    if (!rates) return null;
    const baseRate = rates[gender];
    const annualPremium = baseRate * (faceAmount / 10000) + config.annualFee;
    return Math.round(annualPremium * config.monthlyFactor * 100) / 100;
  }

  if (planType === 'ROP') {
    const bracketAge = findBracketAge(AMERICAN_AMICABLE_ROP);
    const rates = AMERICAN_AMICABLE_ROP[bracketAge];
    if (!rates) return null;
    const rateKey =
      gender === 'male' ? (tobacco ? 'maleSm' : 'maleNS') : tobacco ? 'femaleSm' : 'femaleNS';
    const baseRate = rates[rateKey];
    const annualPremium = baseRate * (faceAmount / 10000) + config.annualFee;
    return Math.round(annualPremium * config.monthlyFactor * 100) / 100;
  }

  return null;
}

/**
 * Calculate monthly premium for TransAmerica (Level, Graded)
 */
function calculateTransAmericaPremium(
  params: QuoteParams,
  planType: 'Level' | 'Graded'
): number | null {
  const { age, gender, tobacco, faceAmount } = params;
  const config = CARRIER_CONFIG['TransAmerica'];

  const findBracketAge = (rateTable: Record<number, unknown>) => {
    const ageKeys = Object.keys(rateTable)
      .map(Number)
      .sort((a, b) => a - b);
    let bracketAge = ageKeys[0];
    for (const key of ageKeys) {
      if (key <= age) bracketAge = key;
      else break;
    }
    return bracketAge;
  };

  if (planType === 'Level') {
    const bracketAge = findBracketAge(TRANSAMERICA_LEVEL);
    const rates = TRANSAMERICA_LEVEL[bracketAge];
    if (!rates) return null;
    const rateKey =
      gender === 'male' ? (tobacco ? 'maleSm' : 'maleNS') : tobacco ? 'femaleSm' : 'femaleNS';
    const baseRate = rates[rateKey];
    const annualPremium = baseRate * (faceAmount / 10000) + config.annualFee;
    return Math.round(annualPremium * config.monthlyFactor * 100) / 100;
  }

  if (planType === 'Graded') {
    const bracketAge = findBracketAge(TRANSAMERICA_GRADED);
    const rates = TRANSAMERICA_GRADED[bracketAge];
    if (!rates) return null;
    const baseRate = rates[gender];
    const annualPremium = baseRate * (faceAmount / 10000) + config.annualFee;
    return Math.round(annualPremium * config.monthlyFactor * 100) / 100;
  }

  return null;
}

/**
 * Calculate monthly premium for Corebridge (Guaranteed Issue only)
 */
function calculateCorebridgePremium(params: QuoteParams): number | null {
  const { age, gender, faceAmount } = params;
  const config = CARRIER_CONFIG['Corebridge'];

  const ageKeys = Object.keys(COREBRIDGE_GI)
    .map(Number)
    .sort((a, b) => a - b);
  let bracketAge = ageKeys[0];
  for (const key of ageKeys) {
    if (key <= age) bracketAge = key;
    else break;
  }

  const rates = COREBRIDGE_GI[bracketAge];
  if (!rates) return null;

  const baseRate = rates[gender];
  // Corebridge has different calculation - direct monthly rate
  return Math.round(baseRate * (faceAmount / 10000) * 100) / 100;
}

/**
 * Calculate monthly premium for AHL (Level, Graded)
 */
function calculateAHLPremium(params: QuoteParams, planType: 'Level' | 'Graded'): number | null {
  const { age, gender, tobacco, faceAmount } = params;
  const config = CARRIER_CONFIG['AHL'];

  const findBracketAge = (rateTable: Record<number, unknown>) => {
    const ageKeys = Object.keys(rateTable)
      .map(Number)
      .sort((a, b) => a - b);
    let bracketAge = ageKeys[0];
    for (const key of ageKeys) {
      if (key <= age) bracketAge = key;
      else break;
    }
    return bracketAge;
  };

  if (planType === 'Level') {
    const bracketAge = findBracketAge(AHL_LEVEL);
    const rates = AHL_LEVEL[bracketAge];
    if (!rates) return null;
    const rateKey =
      gender === 'male' ? (tobacco ? 'maleSm' : 'maleNS') : tobacco ? 'femaleSm' : 'femaleNS';
    const baseRate = rates[rateKey];
    const annualPremium = baseRate * (faceAmount / 10000) + config.annualFee;
    return Math.round(annualPremium * config.monthlyFactor * 100) / 100;
  }

  if (planType === 'Graded') {
    const bracketAge = findBracketAge(AHL_GRADED);
    const rates = AHL_GRADED[bracketAge];
    if (!rates) return null;
    const baseRate = rates[gender];
    const annualPremium = baseRate * (faceAmount / 10000) + config.annualFee;
    return Math.round(annualPremium * config.monthlyFactor * 100) / 100;
  }

  return null;
}

/**
 * Calculate monthly premium for Royal Neighbors (Level, Graded)
 */
function calculateRoyalNeighborsPremium(
  params: QuoteParams,
  planType: 'Level' | 'Graded'
): number | null {
  const { age, gender, tobacco, faceAmount } = params;
  const config = CARRIER_CONFIG['Royal Neighbors'];

  const findBracketAge = (rateTable: Record<number, unknown>) => {
    const ageKeys = Object.keys(rateTable)
      .map(Number)
      .sort((a, b) => a - b);
    let bracketAge = ageKeys[0];
    for (const key of ageKeys) {
      if (key <= age) bracketAge = key;
      else break;
    }
    return bracketAge;
  };

  if (planType === 'Level') {
    const bracketAge = findBracketAge(ROYAL_NEIGHBORS_LEVEL);
    const rates = ROYAL_NEIGHBORS_LEVEL[bracketAge];
    if (!rates) return null;
    const rateKey =
      gender === 'male' ? (tobacco ? 'maleSm' : 'maleNS') : tobacco ? 'femaleSm' : 'femaleNS';
    const baseRate = rates[rateKey];
    const annualPremium = baseRate * (faceAmount / 10000) + config.annualFee;
    return Math.round(annualPremium * config.monthlyFactor * 100) / 100;
  }

  if (planType === 'Graded') {
    const bracketAge = findBracketAge(ROYAL_NEIGHBORS_GRADED);
    const rates = ROYAL_NEIGHBORS_GRADED[bracketAge];
    if (!rates) return null;
    const baseRate = rates[gender];
    const annualPremium = baseRate * (faceAmount / 10000) + config.annualFee;
    return Math.round(annualPremium * config.monthlyFactor * 100) / 100;
  }

  return null;
}

/**
 * Calculate monthly premium for Gerber (Guaranteed Issue only)
 */
function calculateGerberPremium(params: QuoteParams): number | null {
  const { age, gender, faceAmount } = params;
  const config = CARRIER_CONFIG['Gerber'];

  const ageKeys = Object.keys(GERBER_GI)
    .map(Number)
    .sort((a, b) => a - b);
  let bracketAge = ageKeys[0];
  for (const key of ageKeys) {
    if (key <= age) bracketAge = key;
    else break;
  }

  const rates = GERBER_GI[bracketAge];
  if (!rates) return null;

  const baseRate = rates[gender];
  const annualPremium = baseRate * (faceAmount / 10000) + config.annualFee;
  return Math.round(annualPremium * config.monthlyFactor * 100) / 100;
}

/**
 * Calculate monthly premium for Mutual of Omaha (Level, Graded)
 */
function calculateMutualOfOmahaPremium(
  params: QuoteParams,
  planType: 'Level' | 'Graded'
): number | null {
  const { age, gender, tobacco, faceAmount } = params;
  const config = CARRIER_CONFIG['Mutual of Omaha'];

  const findBracketAge = (rateTable: Record<number, unknown>) => {
    const ageKeys = Object.keys(rateTable)
      .map(Number)
      .sort((a, b) => a - b);
    let bracketAge = ageKeys[0];
    for (const key of ageKeys) {
      if (key <= age) bracketAge = key;
      else break;
    }
    return bracketAge;
  };

  if (planType === 'Level') {
    const bracketAge = findBracketAge(MUTUAL_OF_OMAHA_LEVEL);
    const rates = MUTUAL_OF_OMAHA_LEVEL[bracketAge];
    if (!rates) return null;
    const rateKey =
      gender === 'male' ? (tobacco ? 'maleSm' : 'maleNS') : tobacco ? 'femaleSm' : 'femaleNS';
    const baseRate = rates[rateKey];
    const annualPremium = baseRate * (faceAmount / 10000) + config.annualFee;
    return Math.round(annualPremium * config.monthlyFactor * 100) / 100;
  }

  if (planType === 'Graded') {
    const bracketAge = findBracketAge(MUTUAL_OF_OMAHA_GRADED);
    const rates = MUTUAL_OF_OMAHA_GRADED[bracketAge];
    if (!rates) return null;
    const baseRate = rates[gender];
    const annualPremium = baseRate * (faceAmount / 10000) + config.annualFee;
    return Math.round(annualPremium * config.monthlyFactor * 100) / 100;
  }

  return null;
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
 * Now includes all 11 carriers and respects eligibility tier
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

  // Aflac
  if (isAgeEligible('Aflac', age)) {
    quotes.push({
      carrier: 'Aflac',
      planType: 'Level',
      premium: calculateAflacPremium(params),
      isEligible: availableCarriers.includes('Aflac'),
    });
  }

  // SBLI
  if (isAgeEligible('SBLI', age)) {
    quotes.push({
      carrier: 'SBLI',
      planType: 'Level',
      premium: calculateSBLIPremium(params),
      isEligible: availableCarriers.includes('SBLI'),
    });
  }

  // CICA
  if (isAgeEligible('CICA', age)) {
    quotes.push({
      carrier: 'CICA',
      planType: 'Level',
      premium: calculateCICAPremium(params),
      isEligible: availableCarriers.includes('CICA'),
    });
  }

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

  // TransAmerica (Level, Graded)
  if (isAgeEligible('TransAmerica', age)) {
    quotes.push({
      carrier: 'TransAmerica',
      planType: 'Level',
      premium: calculateTransAmericaPremium(params, 'Level'),
      isEligible: availableCarriers.includes('TransAmerica') && eligibilityTier === 'LEVEL',
    });
    quotes.push({
      carrier: 'TransAmerica',
      planType: 'Graded',
      premium: calculateTransAmericaPremium(params, 'Graded'),
      isEligible: availableCarriers.includes('TransAmerica') && eligibilityTier === 'GRADED',
    });
  }

  // Corebridge (GI only)
  if (isAgeEligible('Corebridge', age)) {
    quotes.push({
      carrier: 'Corebridge',
      planType: 'Guaranteed Issue',
      premium: calculateCorebridgePremium(params),
      isEligible: availableCarriers.includes('Corebridge'),
    });
  }

  // AHL (Level, Graded)
  if (isAgeEligible('AHL', age)) {
    quotes.push({
      carrier: 'AHL',
      planType: 'Level',
      premium: calculateAHLPremium(params, 'Level'),
      isEligible: availableCarriers.includes('AHL') && eligibilityTier === 'LEVEL',
    });
    quotes.push({
      carrier: 'AHL',
      planType: 'Graded',
      premium: calculateAHLPremium(params, 'Graded'),
      isEligible: availableCarriers.includes('AHL') && eligibilityTier === 'GRADED',
    });
  }

  // Royal Neighbors (Level, Graded)
  if (isAgeEligible('Royal Neighbors', age)) {
    quotes.push({
      carrier: 'Royal Neighbors',
      planType: 'Level',
      premium: calculateRoyalNeighborsPremium(params, 'Level'),
      isEligible: availableCarriers.includes('Royal Neighbors') && eligibilityTier === 'LEVEL',
    });
    quotes.push({
      carrier: 'Royal Neighbors',
      planType: 'Graded',
      premium: calculateRoyalNeighborsPremium(params, 'Graded'),
      isEligible: availableCarriers.includes('Royal Neighbors') && eligibilityTier === 'GRADED',
    });
  }

  // Gerber (GI only)
  if (isAgeEligible('Gerber', age)) {
    quotes.push({
      carrier: 'Gerber',
      planType: 'Guaranteed Issue',
      premium: calculateGerberPremium(params),
      isEligible: availableCarriers.includes('Gerber'),
    });
  }

  // Mutual of Omaha (Level, Graded)
  if (isAgeEligible('Mutual of Omaha', age)) {
    quotes.push({
      carrier: 'Mutual of Omaha',
      planType: 'Level',
      premium: calculateMutualOfOmahaPremium(params, 'Level'),
      isEligible: availableCarriers.includes('Mutual of Omaha') && eligibilityTier === 'LEVEL',
    });
    quotes.push({
      carrier: 'Mutual of Omaha',
      planType: 'Graded',
      premium: calculateMutualOfOmahaPremium(params, 'Graded'),
      isEligible: availableCarriers.includes('Mutual of Omaha') && eligibilityTier === 'GRADED',
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
