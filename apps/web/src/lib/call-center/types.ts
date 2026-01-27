// Call Center Portal Types
// TypeScript interfaces for the integrated dialer, scripting, and quoting system

// ============================================================================
// Prospect & Lead Data
// ============================================================================

export interface ProspectData {
  // Basic Info
  firstName: string;
  middleName: string;
  lastName: string;
  phone: string;
  dob: string;
  age: number | string;
  gender: 'male' | 'female' | '';

  // Address
  address: string;
  city: string;
  state: string;
  zip: string;
  stateOfBirth: string;

  // Identity
  ssn: string;

  // Health
  height: string;
  weight: number | string;
  tobacco: boolean | null;

  // Insurance Details
  carrier: string;
  planType: string;
  faceAmount: number;
  monthlyPremium: string | number;

  // Beneficiaries
  primaryBenName: string;
  primaryBenRel: string;
  contingentBenName: string;
  contingentBenRel: string;

  // Owner (if different from insured)
  ownerName: string;
  ownerRel: string;
  ownerSsn: string;
  ownerAddress: string;

  // Existing Insurance
  hasExisting: boolean | null;
  willReplace: boolean | null;

  // Health Questions
  q1: boolean | null;
  q2: boolean | null;
  q3: boolean | null;
  q4: boolean | null;
  q5: boolean | null;
  q6: boolean | null;
  q7a: boolean | null;
  q7b: boolean | null;
  q7c: boolean | null;
  q7d: boolean | null;
  q8a: boolean | null;
  q8b: boolean | null;
  q8c: boolean | null;

  // Banking
  accountName: string;
  accountType: 'checking' | 'savings';
  bankName: string;
  bankAddress: string;
  routing: string;
  accountNum: string;
  draftSchedule: string;
  draftDate: string;

  // Physician
  physicianName: string;

  // Misc
  willingToAccept: boolean;
  applicationNumber: string;
  ilDesigneeChoice: string | null;
}

export const INITIAL_PROSPECT_DATA: ProspectData = {
  carrier: '',
  planType: '',
  monthlyPremium: '',
  firstName: '',
  middleName: '',
  lastName: '',
  address: '',
  city: '',
  state: '',
  zip: '',
  phone: '',
  dob: '',
  age: '',
  stateOfBirth: '',
  ssn: '',
  height: '5\'9"',
  weight: 170,
  gender: '',
  ownerName: '',
  ownerRel: '',
  ownerSsn: '',
  ownerAddress: '',
  primaryBenName: '',
  primaryBenRel: '',
  contingentBenName: '',
  contingentBenRel: '',
  faceAmount: 15000,
  willingToAccept: false,
  tobacco: null,
  hasExisting: null,
  willReplace: null,
  physicianName: '',
  q1: null,
  q2: null,
  q3: null,
  q4: null,
  q5: null,
  q6: null,
  q7a: null,
  q7b: null,
  q7c: null,
  q7d: null,
  q8a: null,
  q8b: null,
  q8c: null,
  accountName: '',
  accountType: 'checking',
  bankName: '',
  bankAddress: '',
  routing: '',
  accountNum: '',
  draftSchedule: 'ss_payment',
  draftDate: '',
  ilDesigneeChoice: null,
  applicationNumber: '',
};

// ============================================================================
// Script System
// ============================================================================

export type ScriptFieldType =
  | 'text'
  | 'select'
  | 'date'
  | 'number'
  | 'phone'
  | 'ssn'
  | 'email'
  | 'boolean'
  | 'state'
  | 'height'
  | 'currency';

export interface ScriptFieldOption {
  value: string;
  label: string;
  color?: 'green' | 'red' | 'yellow' | 'blue';
  nextNode?: string;
}

export interface ScriptField {
  id: string;
  label: string;
  type: ScriptFieldType;
  dataKey: keyof ProspectData;
  required?: boolean;
  options?: ScriptFieldOption[];
  placeholder?: string;
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
  };
}

export interface ScriptNode {
  id: string;
  title: string;
  category: 'intro' | 'qualification' | 'presentation' | 'application' | 'closing';
  script: string;
  tip?: string;
  fields?: ScriptField[];
  nextNode?: string;
  conditionalNext?: {
    field: keyof ProspectData;
    conditions: Array<{
      value: unknown;
      nextNode: string;
    }>;
  };
}

// ============================================================================
// Carrier & Quote System
// ============================================================================

export interface CarrierConfig {
  annualFee: number;
  monthlyFactor: number;
  hasTobacco: boolean;
  directLookup?: boolean;
}

export interface CarrierQuote {
  carrier: string;
  planType: string;
  premium: number | null;
  faceAmount: number;
  isEligible: boolean;
  eligibilityReason?: string;
}

export interface EligibilityResult {
  status: 'approved' | 'graded' | 'declined';
  message: string;
  tier: 'preferred' | 'standard' | 'graded' | 'gi' | 'declined';
}

// ============================================================================
// Constants
// ============================================================================

export const STATES = [
  'AL',
  'AK',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'DE',
  'FL',
  'GA',
  'HI',
  'ID',
  'IL',
  'IN',
  'IA',
  'KS',
  'KY',
  'LA',
  'ME',
  'MD',
  'MA',
  'MI',
  'MN',
  'MS',
  'MO',
  'MT',
  'NE',
  'NV',
  'NH',
  'NJ',
  'NM',
  'NY',
  'NC',
  'ND',
  'OH',
  'OK',
  'OR',
  'PA',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VT',
  'VA',
  'WA',
  'WV',
  'WI',
  'WY',
] as const;

export const RELATIONSHIPS = [
  'Spouse',
  'Child',
  'Parent',
  'Partner',
  'Friend',
  'Relative',
  'Other',
] as const;

export const FACE_AMOUNT_OPTIONS = [
  { value: 3000, label: '$3,000' },
  { value: 5000, label: '$5,000' },
  { value: 7500, label: '$7,500' },
  { value: 10000, label: '$10,000' },
  { value: 15000, label: '$15,000' },
  { value: 20000, label: '$20,000' },
  { value: 25000, label: '$25,000' },
] as const;

export const CARRIERS: Record<string, string[]> = {
  Aflac: ['Level', 'Modified'],
  SBLI: ['Level', 'Modified'],
  CICA: ['Level', 'Guaranteed Issue'],
  GTL: ['Graded'],
  Corebridge: ['Guaranteed Issue'],
  TransAmerica: ['Level', 'Graded'],
  'American Amicable': ['Level', 'Graded', 'ROP'],
  AHL: ['Level', 'Graded'],
  'Royal Neighbors': ['Level', 'Graded'],
  Gerber: ['Guaranteed Issue'],
  'Mutual of Omaha': ['Level', 'Graded'],
};

export const CARRIER_CONFIG: Record<string, CarrierConfig> = {
  Aflac: { annualFee: 48, monthlyFactor: 0.0875, hasTobacco: true },
  SBLI: { annualFee: 48, monthlyFactor: 0.087, hasTobacco: true },
  CICA: { annualFee: 48, monthlyFactor: 0.087, hasTobacco: false },
  GTL: { annualFee: 48, monthlyFactor: 0.08333, hasTobacco: false },
  Corebridge: { annualFee: 0, monthlyFactor: 0, hasTobacco: false, directLookup: true },
  TransAmerica: { annualFee: 48, monthlyFactor: 0.0875, hasTobacco: true },
  'American Amicable': { annualFee: 30, monthlyFactor: 0.088, hasTobacco: true },
  AHL: { annualFee: 120, monthlyFactor: 0.0875, hasTobacco: true },
  'Royal Neighbors': { annualFee: 30, monthlyFactor: 0.087, hasTobacco: true },
  Gerber: { annualFee: 11, monthlyFactor: 0.083334, hasTobacco: false },
  'Mutual of Omaha': { annualFee: 36, monthlyFactor: 0.089, hasTobacco: true },
};

export const CARRIER_LOGOS: Record<string, string> = {
  Aflac: '/logos/aflac.png',
  'American Amicable': '/logos/amam.png',
  CICA: '/logos/cica.png',
  Corebridge: '/logos/corebridge.png',
  GTL: '/logos/gtl.png',
  SBLI: '/logos/sbli.png',
  TransAmerica: '/logos/trans.png',
  AHL: '/logos/ahl.png',
  'Royal Neighbors': '/logos/royal.png',
  Gerber: '/logos/gerber.png',
  'Mutual of Omaha': '/logos/mutual.png',
};
