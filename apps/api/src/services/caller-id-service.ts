import { timingSafeEqual } from 'crypto';

import { getPrismaClient } from '../lib/prisma.js';

export interface CallerIdValidationOptions {
  callId?: string | null;
  internalApiKey?: string | null;
  signedContext?: string | null;
}

export interface CallerIdValidationResult {
  valid: boolean;
  callerId?: string;
  source?: 'call_record' | 'fractel_default';
  reason?: string;
}

/**
 * Timing-safe secret verification helper
 */
export function verifyInternalApiKey(apiKey?: string | null): boolean {
  const secret = process.env.INTERNAL_API_SECRET || process.env.API_KEY;
  if (!secret || !apiKey) {
    return false;
  }

  const a = Buffer.from(apiKey.trim());
  const b = Buffer.from(secret.trim());

  if (a.length !== b.length) {
    return false;
  }

  return timingSafeEqual(a, b);
}

/**
 * Server-side Caller ID Validation & Resolution Service.
 * Hierarchy:
 *   1. Authoritative Call record lookup by X-Hopwhistle-Call-Id / callId
 *   2. Validated FracTEL-approved PhoneNumber record match
 *   3. DB-validated FRACTEL_DEFAULT_CALLER_ID
 *   4. Fail closed (valid: false)
 */
export async function validateAndResolveCallerId(
  options: CallerIdValidationOptions
): Promise<CallerIdValidationResult> {
  const prisma = getPrismaClient();

  // 1. Authenticate internal request
  if (!verifyInternalApiKey(options.internalApiKey)) {
    return { valid: false, reason: 'UNAUTHORIZED_INTERNAL_REQUEST' };
  }

  // 2. Look up Call record if callId is provided
  if (options.callId) {
    const cleanCallId = options.callId.trim();
    try {
      const call = await prisma.call.findFirst({
        where: {
          OR: [
            { id: cleanCallId },
            { callSid: cleanCallId },
            { callSid: `call_${cleanCallId}` },
            { callSid: `fs-${cleanCallId}` },
          ],
        },
        include: {
          fromNumber: true,
        },
      });

      if (call) {
        let candidateCid = call.callerId ? call.callerId.replace(/\D/g, '') : '';
        if (candidateCid.length === 10) candidateCid = '1' + candidateCid;

        if (
          candidateCid.length === 11 &&
          candidateCid.startsWith('1') &&
          !candidateCid.includes('555')
        ) {
          // Check DB PhoneNumber record for strict FracTEL approval & tenant ownership
          const last10 = candidateCid.slice(-10);
          const phoneRecord = await prisma.phoneNumber.findFirst({
            where: {
              number: { endsWith: last10 },
              tenantId: call.tenantId,
              status: 'ACTIVE',
            },
          });

          if (phoneRecord) {
            const providerLower = (phoneRecord.provider || '').toLowerCase().trim();
            const isFracTELApproved =
              providerLower === 'fractel' || providerLower === 'fractel_sbc';

            // User authorization check if assigned
            const phoneUser = phoneRecord.userId ?? null;
            const callUser = call.createdById ?? null;
            const isUserAuthorized =
              !callUser || phoneUser === null || phoneUser === callUser;

            // Campaign authorization check if assigned
            const phoneCampaign = phoneRecord.campaignId ?? null;
            const callCampaign = call.campaignId ?? null;
            const isCampaignAuthorized =
              !callCampaign || phoneCampaign === null || phoneCampaign === callCampaign;

            if (isFracTELApproved && isUserAuthorized && isCampaignAuthorized) {
              return {
                valid: true,
                callerId: candidateCid,
                source: 'call_record',
              };
            }
          }
        }
      }
    } catch (err) {
      console.error('[CallerIDValidation] Error checking Call record:', err);
    }
  }

  // 3. Fallback to DB-validated FRACTEL_DEFAULT_CALLER_ID
  const rawDefault = process.env.FRACTEL_DEFAULT_CALLER_ID || '';
  let defaultCid = rawDefault.replace(/\D/g, '');
  if (defaultCid.length === 10) {
    defaultCid = '1' + defaultCid;
  }

  if (
    defaultCid &&
    defaultCid.length === 11 &&
    defaultCid.startsWith('1') &&
    !defaultCid.includes('555')
  ) {
    try {
      const last10 = defaultCid.slice(-10);
      const defaultRecord = await prisma.phoneNumber.findFirst({
        where: {
          number: { endsWith: last10 },
          status: 'ACTIVE',
        },
      });

      if (defaultRecord) {
        const providerLower = (defaultRecord.provider || '').toLowerCase().trim();
        const isFracTELApproved =
          providerLower === 'fractel' || providerLower === 'fractel_sbc';

        if (isFracTELApproved) {
          return {
            valid: true,
            callerId: defaultCid,
            source: 'fractel_default',
          };
        }
      }
    } catch (err) {
      console.error('[CallerIDValidation] Error validating default CID in DB:', err);
    }
  }

  // 4. Fail closed if neither is valid
  return {
    valid: false,
    reason: 'NO_VALID_TENANT_CALLER_ID',
  };
}
