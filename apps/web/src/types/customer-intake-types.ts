// Customer Intake Form Types
// Shared between the Intake Form and Phone/Dialer components

export interface Beneficiary {
  id: string;
  name: string;
  relationship: 'child' | 'grandchild' | 'parent' | 'spouse' | 'partner' | 'relative' | 'other';
}

export type CarrierType =
  | 'Americo'
  | 'Baltimore Life'
  | 'Mutual of Omaha'
  | 'Securico'
  | 'Sentinel Security Life';
export type PolicyType = 'Level' | 'Graded' | 'Modified' | 'Guaranteed Issue';
export type AccountType = 'Checking' | 'Savings';
export type SSPayDayType = '1st' | '3rd' | '2nd Wednesday' | '3rd Wednesday' | '4th Wednesday';
export type RelationshipType = Beneficiary['relationship'];

export interface CustomerIntakeData {
  // Client Info
  firstName: string;
  lastName: string;
  phone: string; // Format: (XXX) XXX-XXXX
  email: string;
  address: string;
  city: string;
  zip: string;
  state: string; // 2-letter state code
  dateOfBirth: string; // MM/DD/YYYY
  age: number | ''; // Age in years
  stateOfBirth: string; // 2-letter state code

  // Policy Details
  coverage: number; // Range $1,000-$100,000
  carrier: CarrierType | '';
  policyType: PolicyType | '';
  monthlyPremium: number;

  // Beneficiaries
  primaryBeneficiaries: Beneficiary[];
  secondaryBeneficiaryName: string;
  secondaryBeneficiaryRelationship: RelationshipType | '';

  // Underwriting & Billing
  tobaccoUser: boolean;
  ssPayment: boolean;
  ssPayDay: SSPayDayType | '';
  firstPayDay: number | ''; // 1-31
  futurePayDay: number | ''; // 2-28

  // Banking
  nameOnAccount: string;
  bankName: string;
  routingNumber: string; // 9 digits
  accountNumber: string;
  accountType: AccountType | '';
  ssn: string; // Stored unmasked
}

// Default empty form data
export const DEFAULT_INTAKE_DATA: CustomerIntakeData = {
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  address: '',
  city: '',
  zip: '',
  state: '',
  dateOfBirth: '',
  age: '',
  stateOfBirth: '',
  coverage: 10000,
  carrier: '',
  policyType: '',
  monthlyPremium: 0,
  primaryBeneficiaries: [],
  secondaryBeneficiaryName: '',
  secondaryBeneficiaryRelationship: '',
  tobaccoUser: false,
  ssPayment: false,
  ssPayDay: '',
  firstPayDay: '',
  futurePayDay: '',
  nameOnAccount: '',
  bankName: '',
  routingNumber: '',
  accountNumber: '',
  accountType: '',
  ssn: '',
};

// Validation helpers
export const formatPhoneNumber = (value: string): string => {
  const digits = value.replace(/\D/g, '').slice(0, 10);
  if (digits.length === 0) return '';
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
};

export const isValidRoutingNumber = (routing: string): boolean => {
  return /^\d{9}$/.test(routing.replace(/\D/g, ''));
};

export const isValidEmail = (email: string): boolean => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

export const maskSSN = (ssn: string): string => {
  const digits = ssn.replace(/\D/g, '');
  if (digits.length <= 3) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `XXX-XX-${digits.slice(5, 9)}`;
};

export const formatSSN = (value: string): string => {
  const digits = value.replace(/\D/g, '').slice(0, 9);
  if (digits.length <= 3) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
};
