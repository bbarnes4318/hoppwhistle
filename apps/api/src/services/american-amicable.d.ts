/**
 * TypeScript declaration for american-amicable.js
 */

export interface CarrierAppData {
  state: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  dob: string;
  age?: number;
  gender: string;
  tobacco: boolean;
  selectedCoverage: number;
  selectedPlanType: string;
  address?: string;
  zip?: string;
  ssn?: string;
  phone?: string;
  email?: string;
  birthState?: string;
  accountHolder?: string;
  bankName?: string;
  bankCityState?: string;
  ssPaymentSchedule?: boolean | null;
  draftDay?: string;
  routingNumber?: string;
  accountNumber?: string;
  accountType?: string;
  wantsEmail?: boolean | null;
  heightFeet?: number;
  heightInches?: number;
  weight?: number;
  doctorName?: string;
  doctorAddress?: string;
  doctorPhone?: string;
  ownerIsInsured?: boolean;
  payorIsInsured?: boolean;
  hasExistingInsurance?: boolean | null;
  existingCompanyName?: string;
  existingPolicyNumber?: string;
  existingCoverageAmount?: string;
  willReplaceExisting?: boolean | null;
  healthQ1?: boolean;
  healthQ2?: boolean;
  healthQ3?: boolean;
  healthQ4?: boolean;
  healthQ5?: boolean;
  healthQ6?: boolean;
  healthQ7a?: boolean;
  healthQ7b?: boolean;
  healthQ7c?: boolean;
  healthQ7d?: boolean;
  healthQ8a?: boolean;
  healthQ8b?: boolean;
  healthQ8c?: boolean;
  healthCovid?: boolean;
  beneficiaryName?: string;
  beneficiaryRelation?: string;
  ilDesigneeChoice?: string | null;
  retryMode?: boolean;
}

export interface AutomationResult {
  success: boolean;
  applicationNumber?: string;
  error?: string;
  screenshot?: string;
}

export function runAmericanAmicableAutomation(
  data: CarrierAppData,
  jobId?: string | null
): Promise<AutomationResult>;
