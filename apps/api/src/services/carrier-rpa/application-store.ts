/**
 * Persistence layer for InsuranceCarrierApplication records.
 *
 * Stores the full carrier application (with SSN / routing / account numbers
 * encrypted at rest) and tracks the automation lifecycle: PENDING -> RUNNING
 * -> COMPLETED (with carrier application number) or FAILED (with a sanitized
 * error). API responses only ever expose masked last-4 values.
 */

import { encryptField, last4 } from '../../lib/field-encryption.js';
import { getPrismaClient } from '../../lib/prisma.js';

import type { NormalizedCarrierPayload } from './normalization.js';
import { sanitizeErrorMessage } from './redaction.js';

export interface CarrierApplicationRecord {
  id: string;
  [key: string]: unknown;
}

/**
 * Create the carrier application row for a new automation job.
 */
export const createCarrierApplication = async (params: {
  tenantId: string;
  jobId: string;
  normalized: NormalizedCarrierPayload;
  createdById?: string | null;
}): Promise<CarrierApplicationRecord> => {
  const { tenantId, jobId, normalized: n, createdById } = params;
  const prisma = getPrismaClient();

  const application = await prisma.insuranceCarrierApplication.create({
    data: {
      tenantId,
      insuranceLeadId: n.insuranceLeadId,
      prospectIntakeId: n.prospectIntakeId,
      callId: n.callId,
      carrier: 'American Amicable',
      product: 'Senior Choice',
      planType: n.selectedPlanType,
      monthlyPremium: n.monthlyPremium,
      faceAmount: n.selectedCoverage,
      status: 'PENDING',

      firstName: n.firstName,
      middleName: n.middleName || null,
      lastName: n.lastName,
      address: n.address || null,
      city: n.city || null,
      state: n.state || null,
      zip: n.zip || null,
      phone: n.phone || null,
      email: n.email || null,
      dob: n.dob || null,
      age: n.age,
      gender: n.gender || null,
      tobacco: n.tobacco,
      stateOfBirth: n.birthState || null,
      heightFeet: n.heightFeet,
      heightInches: n.heightInches,
      weight: isNaN(n.weight) ? null : n.weight,

      ssnEncrypted: encryptField(n.ssn),
      ssnLast4: last4(n.ssn),
      routingNumberEncrypted: encryptField(n.routingNumber),
      routingNumberLast4: last4(n.routingNumber),
      accountNumberEncrypted: encryptField(n.accountNumber),
      accountNumberLast4: last4(n.accountNumber),
      accountHolder: n.accountHolder || null,
      accountType: n.accountType || null,
      bankName: n.bankName || null,
      bankCityState: n.bankCityState || null,
      draftSchedule: n.ssPaymentSchedule ? 'ss_payment' : 'day_of_month',
      draftDay: n.draftDay || null,

      beneficiaryName: n.beneficiaryName || null,
      beneficiaryRelation: n.beneficiaryRelation || null,
      contingentBeneficiaryName: n.contingentBeneficiaryName || null,
      contingentBeneficiaryRelation: n.contingentBeneficiaryRelation || null,

      ownerIsInsured: n.ownerIsInsured,
      payorIsInsured: n.payorIsInsured,
      ownerName: n.ownerName || null,
      ownerRelation: n.ownerRelation || null,
      ownerAddress: n.ownerAddress || null,

      hasExistingInsurance: n.hasExistingInsurance,
      willReplaceExisting: n.willReplaceExisting,
      existingCompanyName: n.existingCompanyName || null,
      existingPolicyNumber: n.existingPolicyNumber || null,
      existingCoverageAmount: n.existingCoverageAmount || null,

      doctorName: n.doctorName || null,
      doctorAddress: n.doctorAddress || null,
      doctorPhone: n.doctorPhone || null,

      healthQ1: n.healthQ1,
      healthQ2: n.healthQ2,
      healthQ3: n.healthQ3,
      healthQ4: n.healthQ4,
      healthQ5: n.healthQ5,
      healthQ6: n.healthQ6,
      healthQ7a: n.healthQ7a,
      healthQ7b: n.healthQ7b,
      healthQ7c: n.healthQ7c,
      healthQ7d: n.healthQ7d,
      healthQ8a: n.healthQ8a,
      healthQ8b: n.healthQ8b,
      healthQ8c: n.healthQ8c,
      healthCovid: n.healthCovid,

      ilDesigneeChoice: n.ilDesigneeChoice,

      automationJobId: jobId,
      automationStatus: 'PENDING',
      createdById: createdById || null,
    },
  });

  return application as unknown as CarrierApplicationRecord;
};

/**
 * Mark an application's automation as running.
 */
export const markAutomationRunning = async (applicationId: string): Promise<void> => {
  const prisma = getPrismaClient();
  await prisma.insuranceCarrierApplication.update({
    where: { id: applicationId },
    data: {
      automationStatus: 'RUNNING',
      status: 'SUBMITTING',
      automationStartedAt: new Date(),
    },
  });
};

/**
 * Persist a successful automation run and the captured carrier application number.
 */
export const markAutomationCompleted = async (
  applicationId: string,
  carrierApplicationNumber: string
): Promise<void> => {
  const prisma = getPrismaClient();
  await prisma.insuranceCarrierApplication.update({
    where: { id: applicationId },
    data: {
      carrierApplicationNumber,
      automationStatus: 'COMPLETED',
      status: 'SUBMITTED',
      automationError: null,
      automationCompletedAt: new Date(),
    },
  });
};

/**
 * Persist a failed automation run with a sanitized error message.
 */
export const markAutomationFailed = async (
  applicationId: string,
  errorMessage: unknown,
  debugSnapshotPath?: string | null
): Promise<void> => {
  const prisma = getPrismaClient();
  await prisma.insuranceCarrierApplication.update({
    where: { id: applicationId },
    data: {
      automationStatus: 'FAILED',
      status: 'FAILED',
      automationError: sanitizeErrorMessage(errorMessage),
      automationCompletedAt: new Date(),
      lastDebugSnapshotPath: debugSnapshotPath || undefined,
    },
  });
};

/**
 * Shape an application row for API responses: sensitive values are removed
 * and only masked last-4 fields are exposed.
 */
export const toMaskedApplicationResponse = (
  application: Record<string, unknown>
): Record<string, unknown> => {
  const safe: Record<string, unknown> = { ...application };
  const { ssnLast4, routingNumberLast4, accountNumberLast4 } = application;
  delete safe.ssnEncrypted;
  delete safe.routingNumberEncrypted;
  delete safe.accountNumberEncrypted;
  delete safe.ssnLast4;
  delete safe.routingNumberLast4;
  delete safe.accountNumberLast4;

  return {
    ...safe,
    ssn: ssnLast4 ? `***-**-${String(ssnLast4)}` : null,
    routingNumber: routingNumberLast4 ? `*****${String(routingNumberLast4)}` : null,
    accountNumber: accountNumberLast4 ? `******${String(accountNumberLast4)}` : null,
  };
};
