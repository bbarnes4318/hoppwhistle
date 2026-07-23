import { getPrismaClient } from '../lib/prisma.js';

export interface CallerIdValidationOptions {
  requestedCallerId?: string | null;
  tenantId?: string | null;
  userId?: string | null;
  campaignId?: string | null;
}

export interface CallerIdValidationResult {
  valid: boolean;
  callerId?: string;
  source?: 'requested_did' | 'fractel_default';
  reason?: string;
}

/**
 * Server-side Caller ID Validation & Resolution Service.
 * Hierarchy:
 *   1. Validated tenant-authorized selected FracTEL DID;
 *   2. Valid configured FRACTEL_DEFAULT_CALLER_ID;
 *   3. Otherwise fail closed (valid: false).
 */
export async function validateAndResolveCallerId(
  options: CallerIdValidationOptions
): Promise<CallerIdValidationResult> {
  const prisma = getPrismaClient();

  let candidate = (options.requestedCallerId || '').replace(/\D/g, '');
  if (candidate.length === 10) {
    candidate = '1' + candidate;
  }

  // Reject 555 demo numbers or invalid lengths
  if (candidate.includes('555') || candidate.length !== 11 || !candidate.startsWith('1')) {
    candidate = '';
  }

  // 1. If candidate DID was provided, validate against DB
  if (candidate) {
    const last10 = candidate.slice(-10);

    try {
      const phoneRecord = await prisma.phoneNumber.findFirst({
        where: {
          number: { endsWith: last10 },
          status: 'ACTIVE',
          ...(options.tenantId ? { tenantId: options.tenantId } : {}),
        },
      });

      if (phoneRecord) {
        // Cross-tenant check: if tenantId is provided, must match phoneRecord.tenantId
        const isTenantAuthorized = !options.tenantId || phoneRecord.tenantId === options.tenantId;

        // User authorization check: unassigned pool number or assigned to user
        const isUserAuthorized =
          !options.userId ||
          phoneRecord.userId === null ||
          phoneRecord.userId === options.userId;

        // Provider check: approved for FracTEL
        const providerLower = (phoneRecord.provider || '').toLowerCase();
        const isFracTELApproved =
          providerLower === 'fractel' ||
          providerLower === 'local' ||
          providerLower === 'active' ||
          providerLower === '' ||
          providerLower === 'default';

        if (isTenantAuthorized && isUserAuthorized && isFracTELApproved) {
          const cleanNum = phoneRecord.number.replace(/\D/g, '');
          const normNum = cleanNum.length === 10 ? '1' + cleanNum : cleanNum;
          return {
            valid: true,
            callerId: normNum,
            source: 'requested_did',
          };
        }
      }
    } catch (err) {
      console.error('[CallerIDValidation] Error checking DB:', err);
    }
  }

  // 2. Fallback to FRACTEL_DEFAULT_CALLER_ID
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
    return {
      valid: true,
      callerId: defaultCid,
      source: 'fractel_default',
    };
  }

  // 3. Fail closed if neither requested candidate nor default is valid
  return {
    valid: false,
    reason: 'NO_VALID_TENANT_CALLER_ID',
  };
}
