/**
 * Number carriers: which carriers agencies buy phone numbers from.
 *
 * Two audiences, deliberately split:
 *
 *   /api/v1/platform/number-carriers   GET, PUT   NetEnroll platform admins only
 *                                                 (`requirePlatformAdmin`). The
 *                                                 Settings -> Number carriers tab.
 *   /api/v1/numbers/available          GET        an agency's OWNER or ADMIN
 *   /api/v1/numbers/buy                POST       (the AGENCY_OWNER_ALLOWED list in
 *                                                 lib/staff-only-endpoints.ts; an
 *                                                 AGENT is refused there).
 *
 * The agency endpoints take no carrier choice from the owner beyond the one
 * the search itself returned: search answers each number with the carrier it
 * is for sale at, and buy refuses a carrier the platform has not enabled. The
 * rules are in `services/numbers/number-carriers.ts`.
 */

import type { FastifyInstance } from 'fastify';

import { logger } from '../lib/logger.js';
import { requirePlatformAdmin } from '../lib/platform-context.js';
import { getActingTenantId, getActingUserId, sendTenantRefusal } from '../lib/tenant-context.js';
import { authenticate } from '../middleware/auth.js';
import {
  assertCarrierEnabled,
  getNumberCarriers,
  NumberCarrierSettingsError,
  NumberSearchError,
  saveNumberCarriers,
  searchAvailableNumbers,
  type NumberCarrierState,
} from '../services/numbers/number-carriers.js';
import {
  NumberPurchaseError,
  purchaseNumberForTenant,
} from '../services/numbers/number-purchase.js';

/** The settings screen's view of a carrier. */
function view(carrier: NumberCarrierState) {
  return {
    provider: carrier.provider,
    label: carrier.label,
    purchasable: carrier.purchasable,
    configured: carrier.configured,
    enabled: carrier.enabled,
    isDefault: carrier.isDefault,
    numberTypes: carrier.numberTypes,
    unavailableReason: carrier.unavailableReason ?? null,
    updatedAt: carrier.updatedAt,
  };
}

const AREA_CODE = /^\d{3}$/;

// eslint-disable-next-line @typescript-eslint/require-await -- plugin signature
export async function registerNumberCarrierRoutes(fastify: FastifyInstance): Promise<void> {
  /* ── The platform's choice ─────────────────────────────────────────────── */

  fastify.get(
    '/api/v1/platform/number-carriers',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async () => ({ data: (await getNumberCarriers()).map(view) })
  );

  fastify.put<{
    Body: {
      carriers?: Array<{ provider?: unknown; enabled?: unknown }>;
      defaultProvider?: unknown;
    };
  }>(
    '/api/v1/platform/number-carriers',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const body = request.body ?? {};
      if (
        !Array.isArray(body.carriers) ||
        body.carriers.some(
          c => typeof c?.provider !== 'string' || typeof c?.enabled !== 'boolean'
        ) ||
        (body.defaultProvider !== null && typeof body.defaultProvider !== 'string')
      ) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message:
              'Send carriers as [{ provider, enabled }] and defaultProvider as a carrier key',
          },
        });
      }

      try {
        const saved = await saveNumberCarriers(
          {
            carriers: body.carriers.map(c => ({
              provider: c.provider as string,
              enabled: c.enabled as boolean,
            })),
            defaultProvider: body.defaultProvider ?? null,
          },
          {
            userId: getActingUserId(request) as string,
            ipAddress: request.ip,
            requestId: request.id,
          }
        );
        return reply.send({ data: saved.map(view) });
      } catch (error) {
        if (error instanceof NumberCarrierSettingsError) {
          return reply.code(400).send({ error: { code: error.code, message: error.message } });
        }
        throw error;
      }
    }
  );

  /* ── An agency buying a number ─────────────────────────────────────────── */

  fastify.get<{ Querystring: { type?: string; areaCode?: string } }>(
    '/api/v1/numbers/available',
    async (request, reply) => {
      const tenantId = getActingTenantId(request);
      if (!tenantId) return sendTenantRefusal(request, reply);

      const numberType = request.query.type === 'tollfree' ? 'tollfree' : 'local';
      const areaCode = request.query.areaCode?.trim() || undefined;
      if (areaCode && !AREA_CODE.test(areaCode)) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'areaCode must be three digits' },
        });
      }
      if (numberType === 'local' && !areaCode) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'An area code is required for local numbers',
          },
        });
      }

      try {
        const { numbers, carriersSearched } = await searchAvailableNumbers({
          numberType,
          areaCode,
        });
        return {
          data: numbers,
          meta: {
            type: numberType,
            areaCode: areaCode ?? null,
            count: numbers.length,
            carriersSearched,
          },
        };
      } catch (error) {
        logger.error({
          msg: 'Number search failed',
          tenantId,
          numberType,
          areaCode,
          error: error instanceof Error ? error.message : String(error),
        });
        /*
         * NetEnroll staff are told which carrier failed and why -- they are the
         * ones who can fix a rejected credential or an allowlist. An agency
         * owner never sees a carrier, so they get the plain sentence.
         */
        const staff = (request.user as { isPlatformAdmin?: boolean } | undefined)?.isPlatformAdmin;
        const detail =
          staff && error instanceof NumberSearchError
            ? ` ${error.failures.map(f => `${f.label}: ${f.message}`).join(' · ')}`
            : '';
        return reply.code(502).send({
          error: {
            code: 'SEARCH_FAILED',
            message: `Could not reach the number carriers. Try again in a moment.${detail}`,
            ...(staff && error instanceof NumberSearchError ? { carriers: error.failures } : {}),
          },
        });
      }
    }
  );

  fastify.post<{
    Body: {
      provider?: unknown;
      number?: unknown;
      areaCode?: unknown;
      campaignId?: string | null;
      messagingEnabled?: boolean;
    };
  }>('/api/v1/numbers/buy', async (request, reply) => {
    const tenantId = getActingTenantId(request);
    if (!tenantId) return sendTenantRefusal(request, reply);

    const body = request.body ?? {};
    if (typeof body.number !== 'string' || !body.number.trim()) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Choose a number to buy' },
      });
    }

    try {
      // The carrier the search said this number is for sale at -- and only if
      // the platform still sells from it.
      const provider = await assertCarrierEnabled(String(body.provider ?? ''));

      const phoneNumber = await purchaseNumberForTenant({
        provider,
        request: {
          number: body.number.trim(),
          areaCode: typeof body.areaCode === 'string' ? body.areaCode : undefined,
          features: { voice: true, sms: body.messagingEnabled ?? false },
        },
        tenantId,
        campaignId: body.campaignId ?? null,
        actor: {
          userId: getActingUserId(request) ?? undefined,
          ipAddress: request.ip,
          requestId: request.id,
        },
      });

      return reply.code(201).send({
        success: true,
        data: {
          phoneNumber: {
            id: phoneNumber.id,
            number: phoneNumber.number,
            provider: phoneNumber.provider,
            status: phoneNumber.status,
            purchasedAt: phoneNumber.purchasedAt?.toISOString(),
          },
        },
      });
    } catch (error) {
      if (error instanceof NumberPurchaseError) {
        return reply
          .code(error.status)
          .send({ error: { code: error.code, message: error.message, ...(error.detail ?? {}) } });
      }
      logger.error({
        msg: 'Number purchase failed',
        tenantId,
        provider: body.provider,
        error: error instanceof Error ? error.message : String(error),
      });
      return reply.code(400).send({
        error: {
          code: 'PURCHASE_FAILED',
          message: error instanceof Error ? error.message : 'Failed to purchase number',
        },
      });
    }
  });
}
