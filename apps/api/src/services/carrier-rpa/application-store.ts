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
  const now = new Date();

  /*
   * `submittedAt` is the timestamp the closing percentage attributes by, so it
   * decides which business day an application is counted on and therefore which
   * window prices the agency. Two properties, and they pull in opposite
   * directions:
   *
   *   WRITE-ONCE. A retried automation run, or a redelivered completion, must
   *   not move an application from the day it was actually submitted onto the
   *   day the retry happened. That would move a submission across a
   *   business-day boundary and change two different days' rates. So an
   *   existing timestamp is carried forward rather than replaced.
   *
   *   NEVER SEPARATE FROM THE STATUS. This was briefly a second statement --
   *   an `updateMany` guarded on `submittedAt: null` after the update below --
   *   which reads well and is wrong here. The only caller
   *   (`routes/automation.ts`) wraps this whole function in a try/catch that
   *   logs and continues, so a failure on the second statement would leave the
   *   row SUBMITTED with a null `submittedAt`: an application the agency
   *   submitted, that the closing percentage never counts, with nothing on the
   *   surface to say so. A silently uncounted application is a silently wrong
   *   price.
   *
   * So it is one statement. The row is read first only to learn whether a
   * timestamp already exists; SUBMITTED and `submittedAt` are then written
   * together and fail together.
   */
  const existing = await prisma.insuranceCarrierApplication.findUnique({
    where: { id: applicationId },
    select: { submittedAt: true },
  });

  const application = await prisma.insuranceCarrierApplication.update({
    where: { id: applicationId },
    data: {
      carrierApplicationNumber,
      automationStatus: 'COMPLETED',
      status: 'SUBMITTED',
      automationError: null,
      automationCompletedAt: now,
      // The carrier application number is worth refreshing on a re-run. The
      // submission timestamp is not.
      submittedAt: existing?.submittedAt ?? now,
    },
    select: { id: true, tenantId: true, submittedAt: true },
  });

  /*
   * The application has reached submitted state, so it costs one credit.
   *
   * ── Deliberately after the update, and deliberately not in a transaction ────
   *
   * The carrier has accepted the application by the time this runs. Wrapping
   * the ledger write into the same transaction would let a ledger failure roll
   * back a submission that has already happened at the carrier -- an
   * application the agency made, that the closing percentage would never count,
   * because our billing had a bad second.
   *
   * ── Deliberately swallowed ─────────────────────────────────────────────────
   *
   * A failure here must not fail the submission for the same reason. It is not
   * lost money either: the ledger row is keyed on the application, and the
   * settlement's reconciliation pass writes a row for every application
   * submitted on the Delivery Day that does not have one yet, before it counts
   * the day's overrun. So the worst case is that the credit is spent tonight
   * rather than at the moment of submission.
   *
   * ── It costs one credit however many times this runs ───────────────────────
   *
   * A retried automation run calls this again with the same application id. The
   * unique index on `application_credit_ledger("applicationId")` means the
   * second call finds the existing row and writes nothing, exactly as
   * `submittedAt` above is carried forward rather than replaced.
   */
  try {
    const { consumeCreditForApplication } = await import('../billing/credit-ledger.js');
    const { calendarDayOf } = await import('../rating/calendar-day.js');
    await consumeCreditForApplication({
      tenantId: application.tenantId,
      applicationId: application.id,
      // The Delivery Day the application is ATTRIBUTED to, which is the day of
      // its first submission -- not today. A retry the next morning must not
      // move an application onto a day it was not submitted on, for the same
      // reason `submittedAt` is write-once.
      deliveryDay: calendarDayOf(application.submittedAt ?? now),
    });
  } catch (error) {
    console.error(
      `[billing] Could not record a credit for application ${applicationId}; ` +
        'the settlement reconciliation pass will record it.',
      error
    );
  }
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
