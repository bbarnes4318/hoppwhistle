import type { Prisma } from '@prisma/client';

import { createServiceLogger } from '../lib/logger.js';
import { getPrismaClient } from '../lib/prisma.js';

import { getInsuranceLeadMode } from './insurance-lead-config.js';
import { mapToAmeriquote } from './insurance-lead-mapper.js';
import { postToAmeriquote } from './insurance-lead-poster.js';

const log = createServiceLogger('insurance-lead-delivery');

const ACTIVITY_TITLES: Record<'MATCHED' | 'UNMATCHED' | 'MANUAL_REVIEW' | 'ERROR', string> = {
  MATCHED: 'Ameriquote Delivery Matched',
  UNMATCHED: 'Ameriquote Delivery Unmatched',
  MANUAL_REVIEW: 'Ameriquote Delivery Awaiting Buyer Approval',
  ERROR: 'Ameriquote Delivery Failed',
};

type DeliveryVertical = 'ACA' | 'FE';

export interface InsuranceLeadDeliveryResult {
  success: true;
  postStatus: 'MATCHED' | 'UNMATCHED' | 'MANUAL_REVIEW' | 'ERROR';
  postMode: 'TEST' | 'LIVE';
  ameriquoteStatus: string;
  ameriquoteLeadId?: string;
  ameriquotePrice?: string;
  errorMessage?: string;
}

export interface InsuranceLeadDeliveryOptions {
  /**
   * The legacy retry handler increments the attempt counter before the response
   * hook runs. Set this to avoid counting one manual retry twice.
   */
  attemptAlreadyCounted?: boolean;
  trigger?: 'AUTO' | 'RETRY';
}

/**
 * Deliver one validated CRM lead submission to Ameriquote and persist the
 * complete result. This is shared by automatic inbound delivery and the
 * existing manual retry endpoint.
 */
export async function deliverInsuranceLeadSubmission(
  tenantId: string,
  insuranceLeadId: string,
  submissionId: string,
  options: InsuranceLeadDeliveryOptions = {}
): Promise<InsuranceLeadDeliveryResult | { error: string }> {
  const prisma = getPrismaClient();
  const mode = getInsuranceLeadMode();

  const submission = await prisma.insuranceLeadSubmission.findFirst({
    where: {
      id: submissionId,
      tenantId,
      insuranceLeadId,
    },
  });

  if (!submission) return { error: 'Submission not found' };
  if (submission.validationStatus !== 'VALID') {
    return { error: 'Cannot deliver an invalid submission' };
  }
  if (submission.vertical === 'B2B') {
    return { error: 'B2B submissions do not have an Ameriquote delivery mapping' };
  }

  // Both are terminal: the buyer has the lead. Re-posting either one comes
  // back as a 90-day duplicate and burns it, so report the recorded outcome
  // rather than sending again.
  if (submission.postStatus === 'MATCHED' || submission.postStatus === 'MANUAL_REVIEW') {
    return {
      success: true,
      postStatus: submission.postStatus,
      postMode: submission.postMode,
      ameriquoteStatus:
        submission.ameriquoteResponseStatus ||
        (submission.postStatus === 'MATCHED' ? 'Matched' : 'ManualReview'),
      ameriquoteLeadId: submission.ameriquoteLeadId || undefined,
      ameriquotePrice: submission.ameriquotePrice || undefined,
      errorMessage: submission.ameriquoteErrorMessage || undefined,
    };
  }

  const normalized = submission.normalizedPayload as Record<string, unknown> | null;
  if (!normalized) return { error: 'No normalized payload is available for delivery' };

  const attemptUpdate: Prisma.InsuranceLeadSubmissionUpdateInput = options.attemptAlreadyCounted
    ? {}
    : { attemptCount: { increment: 1 } };

  try {
    const { fullPayload, redactedPayload } = mapToAmeriquote(
      submission.vertical as DeliveryVertical,
      normalized
    );

    await prisma.insuranceLeadSubmission.update({
      where: { id: submissionId },
      data: {
        mappedOutboundPayload: redactedPayload as unknown as Prisma.InputJsonValue,
        postMode: mode,
        postStatus: 'PENDING',
        ameriquoteErrorMessage: null,
      },
    });

    const result = await postToAmeriquote(fullPayload);

    let postStatus: 'MATCHED' | 'UNMATCHED' | 'MANUAL_REVIEW' | 'ERROR' = 'ERROR';
    if (result.status === 'Matched') postStatus = 'MATCHED';
    else if (result.status === 'Unmatched') postStatus = 'UNMATCHED';
    // Accepted and holding for the buyer's review. Terminal for our purposes:
    // the lead is with them and must not be posted a second time.
    else if (result.status === 'ManualReview') postStatus = 'MANUAL_REVIEW';

    await prisma.insuranceLeadSubmission.update({
      where: { id: submissionId },
      data: {
        postStatus,
        postMode: mode,
        ameriquoteResponseRaw: result.rawBody || null,
        ameriquoteResponseStatus: result.status,
        ameriquoteLeadId: result.leadId || null,
        ameriquotePrice: result.price || null,
        ameriquoteErrorMessage: result.errorMessage || null,
        postedAt: new Date(),
        lastAttemptAt: new Date(),
        ...attemptUpdate,
      },
    });

    await prisma.insuranceActivity.create({
      data: {
        tenantId,
        insuranceLeadId,
        type: 'SUBMISSION',
        // MANUAL_REVIEW used to be logged as "Unmatched" here, and an UNMATCHED
        // logged no reason at all. Both now say what actually happened.
        title: ACTIVITY_TITLES[postStatus],
        description:
          postStatus === 'MATCHED'
            ? `Lead delivery completed in ${mode} mode with status ${result.status}.`
            : result.errorMessage ||
              `Lead delivery completed in ${mode} mode with status ${result.status}.`,
        metadata: {
          submissionId,
          trigger: options.trigger || 'AUTO',
          ameriquoteLeadId: result.leadId || null,
          ameriquotePrice: result.price || null,
        } as Prisma.InputJsonValue,
      },
    });

    log.info({
      msg: 'Insurance lead delivery completed',
      tenantId,
      insuranceLeadId,
      submissionId,
      mode,
      postStatus,
      ameriquoteStatus: result.status,
      trigger: options.trigger || 'AUTO',
    });

    return {
      success: true,
      postStatus,
      postMode: mode,
      ameriquoteStatus: result.status,
      ameriquoteLeadId: result.leadId,
      ameriquotePrice: result.price,
      errorMessage: result.errorMessage,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown delivery error';

    await prisma.insuranceLeadSubmission.update({
      where: { id: submissionId },
      data: {
        postStatus: 'ERROR',
        postMode: mode,
        ameriquoteErrorMessage: message,
        lastAttemptAt: new Date(),
        ...attemptUpdate,
      },
    });

    await prisma.insuranceActivity.create({
      data: {
        tenantId,
        insuranceLeadId,
        type: 'SUBMISSION',
        title: 'Ameriquote Delivery Failed',
        description: message,
        metadata: {
          submissionId,
          trigger: options.trigger || 'AUTO',
        } as Prisma.InputJsonValue,
      },
    });

    log.error({
      msg: 'Insurance lead delivery failed',
      tenantId,
      insuranceLeadId,
      submissionId,
      error: message,
      trigger: options.trigger || 'AUTO',
    });

    return { error: message };
  }
}
