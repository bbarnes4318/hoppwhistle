/**
 * Which carriers agencies buy phone numbers from.
 *
 * ── Who decides ──────────────────────────────────────────────────────────────
 *
 * A NetEnroll platform admin, on Settings -> Number carriers. Never an agency
 * owner: an owner buys "a local number in 615" and the platform decides where
 * it comes from. The owner's Buy numbers dialog searches every enabled carrier,
 * the default first, and the purchase goes to the carrier the chosen number
 * came from -- which the server checks is still enabled, so switching a
 * carrier off stops purchases from it everywhere, including through the older
 * `/api/v1/fractel/*` and `/api/v1/bulkvs/*` routes.
 *
 * ── Which carriers can be offered ────────────────────────────────────────────
 *
 * Only carriers this platform can both SEARCH for numbers on sale and BUY
 * from. FracTEL and BulkVS search their inventory in `listNumbers`; Vonage
 * searches with `searchAvailable`. Telnyx, Twilio and SignalWire can buy, but
 * their adapters only list numbers already on the account, so there is nothing
 * to show a buyer -- they are listed as unavailable rather than offered as a
 * switch that would do nothing. A carrier must also be configured (its
 * credentials present) to be switched on.
 *
 * ── Storage ──────────────────────────────────────────────────────────────────
 *
 * `number_carrier_settings`, one row per carrier. A carrier with no row takes
 * BUILT_IN_DEFAULTS -- what the dialog did before this existed -- and so does
 * every carrier if the table has not been created yet, so a deploy that ships
 * before its migration is applied keeps buying exactly as it did.
 */

import { Prisma } from '@prisma/client';

import { logger } from '../../lib/logger.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { auditLog } from '../audit.js';
import { provisioningService } from '../provisioning/provisioning-service.js';
import type { Provider } from '../provisioning/types.js';

import { NumberPurchaseError } from './number-purchase.js';

export type NumberType = 'local' | 'tollfree';

export interface NumberCarrierDefinition {
  provider: Provider;
  label: string;
  /** Whether this platform can search this carrier's inventory and buy from it. */
  purchasable: boolean;
  /** The kinds of number its inventory search covers. */
  numberTypes: readonly NumberType[];
  /** Why it cannot be offered, when it cannot. */
  unavailableReason?: string;
}

/** Every carrier the settings screen lists, in the order it lists them. */
export const NUMBER_CARRIERS: readonly NumberCarrierDefinition[] = [
  { provider: 'fractel', label: 'FracTEL', purchasable: true, numberTypes: ['local', 'tollfree'] },
  { provider: 'bulkvs', label: 'BulkVS', purchasable: true, numberTypes: ['local'] },
  { provider: 'vonage', label: 'Vonage', purchasable: true, numberTypes: ['local'] },
  ...(['telnyx', 'twilio', 'signalwire'] as const).map(provider => ({
    provider,
    label: { telnyx: 'Telnyx', twilio: 'Twilio', signalwire: 'SignalWire' }[provider],
    purchasable: false,
    numberTypes: [] as NumberType[],
    unavailableReason:
      'No inventory search for this carrier yet, so numbers cannot be bought from it here.',
  })),
];

export type PurchasableProvider = 'fractel' | 'bulkvs' | 'vonage';

export function isPurchasableProvider(value: unknown): value is PurchasableProvider {
  return NUMBER_CARRIERS.some(c => c.purchasable && c.provider === value);
}

/** What applies to a carrier that has no row: the dialog's behaviour before this existed. */
const BUILT_IN_DEFAULTS: Record<string, { enabled: boolean; isDefault: boolean }> = {
  fractel: { enabled: true, isDefault: true },
  bulkvs: { enabled: true, isDefault: false },
};

export interface NumberCarrierState extends NumberCarrierDefinition {
  /** Credentials are present, so it can be searched and bought from. */
  configured: boolean;
  enabled: boolean;
  isDefault: boolean;
  updatedAt: string | null;
}

type Db = Pick<Prisma.TransactionClient, 'numberCarrierSetting'>;

/** True for "the table is not there yet" -- the migration has not been applied. */
function isMissingTable(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2021';
}

async function storedRows(
  db: Db
): Promise<Map<string, { enabled: boolean; isDefault: boolean; updatedAt: Date }>> {
  try {
    const rows = await db.numberCarrierSetting.findMany();
    return new Map(rows.map(row => [row.provider, row]));
  } catch (error) {
    if (isMissingTable(error)) {
      logger.warn({
        msg: 'number_carrier_settings does not exist yet; using the built-in carrier defaults',
      });
      return new Map();
    }
    throw error;
  }
}

/**
 * Every carrier, with whether it is configured, enabled and the default.
 *
 * A carrier that is enabled but not configured (its credentials were removed)
 * reads as enabled here, so the settings screen can say so, and is skipped by
 * `enabledCarriers` -- it cannot be searched.
 */
export async function getNumberCarriers(db: Db = getPrismaClient()): Promise<NumberCarrierState[]> {
  const stored = await storedRows(db);
  return NUMBER_CARRIERS.map(carrier => {
    const row = stored.get(carrier.provider);
    const fallback = BUILT_IN_DEFAULTS[carrier.provider] ?? { enabled: false, isDefault: false };
    const enabled = carrier.purchasable && (row ? row.enabled : fallback.enabled);
    return {
      ...carrier,
      configured: provisioningService.isConfigured(carrier.provider),
      enabled,
      isDefault: enabled && (row ? row.isDefault : fallback.isDefault),
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  });
}

/** The carriers an agency's purchase may use right now, the default first. */
export async function enabledCarriers(
  numberType: NumberType = 'local',
  db: Db = getPrismaClient()
): Promise<NumberCarrierState[]> {
  return (await getNumberCarriers(db))
    .filter(c => c.enabled && c.configured && c.numberTypes.includes(numberType))
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
}

/**
 * Refuse a purchase from a carrier the platform has not enabled.
 *
 * Whether its credentials are present is not checked here: the purchase itself
 * fails at the carrier without them, with the carrier's own error.
 */
export async function assertCarrierEnabled(
  provider: string,
  db: Db = getPrismaClient()
): Promise<PurchasableProvider> {
  if (!isPurchasableProvider(provider)) {
    throw new NumberPurchaseError(
      400,
      'UNKNOWN_CARRIER',
      'That carrier is not one numbers are bought from.'
    );
  }
  const carrier = (await getNumberCarriers(db)).find(c => c.provider === provider);
  if (!carrier?.enabled) {
    throw new NumberPurchaseError(
      403,
      'CARRIER_DISABLED',
      'Numbers are not being sold from that carrier. Search again and choose another number.'
    );
  }
  return provider;
}

export interface NumberCarrierUpdate {
  carriers: Array<{ provider: string; enabled: boolean }>;
  defaultProvider: string | null;
}

export class NumberCarrierSettingsError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'NumberCarrierSettingsError';
  }
}

/**
 * Save the platform's carrier choice, whole: every listed carrier's switch and
 * the default. Validated before anything is written:
 *
 *   - every provider is one the screen lists, named once;
 *   - only a purchasable, configured carrier may be switched on;
 *   - at least one carrier stays on -- otherwise no agency can buy a number,
 *     which is a decision to make by talking to them, not by a checkbox;
 *   - the default is one of the enabled carriers.
 */
export async function saveNumberCarriers(
  update: NumberCarrierUpdate,
  actor: { userId: string; ipAddress?: string; requestId?: string }
): Promise<NumberCarrierState[]> {
  const prisma = getPrismaClient();
  const current = await getNumberCarriers(prisma);
  const known = new Map(current.map(c => [c.provider as string, c]));

  const seen = new Set<string>();
  for (const entry of update.carriers) {
    const carrier = known.get(entry.provider);
    if (!carrier) {
      throw new NumberCarrierSettingsError('UNKNOWN_CARRIER', `Unknown carrier: ${entry.provider}`);
    }
    if (seen.has(entry.provider)) {
      throw new NumberCarrierSettingsError('DUPLICATE_CARRIER', `${carrier.label} is listed twice`);
    }
    seen.add(entry.provider);
    if (entry.enabled && !carrier.purchasable) {
      throw new NumberCarrierSettingsError(
        'CARRIER_NOT_PURCHASABLE',
        `${carrier.label} cannot be switched on: ${carrier.unavailableReason ?? 'it is not supported'}`
      );
    }
    if (entry.enabled && !carrier.enabled && !carrier.configured) {
      throw new NumberCarrierSettingsError(
        'CARRIER_NOT_CONFIGURED',
        `${carrier.label} cannot be switched on: its credentials are not configured on the server.`
      );
    }
  }

  const nextEnabled = new Map(current.map(c => [c.provider as string, c.enabled]));
  for (const entry of update.carriers) nextEnabled.set(entry.provider, entry.enabled);

  if (![...nextEnabled.values()].some(Boolean)) {
    throw new NumberCarrierSettingsError(
      'NO_CARRIER_ENABLED',
      'Keep at least one carrier on, or no agency can buy a number.'
    );
  }
  if (!update.defaultProvider || !nextEnabled.get(update.defaultProvider)) {
    throw new NumberCarrierSettingsError(
      'DEFAULT_NOT_ENABLED',
      'Choose a default carrier from the ones that are switched on.'
    );
  }

  const before = current.map(c => ({
    provider: c.provider,
    enabled: c.enabled,
    isDefault: c.isDefault,
  }));

  await prisma.$transaction(
    current
      .filter(c => c.purchasable)
      .map(c =>
        prisma.numberCarrierSetting.upsert({
          where: { provider: c.provider },
          create: {
            provider: c.provider,
            enabled: nextEnabled.get(c.provider) === true,
            isDefault: c.provider === update.defaultProvider,
            updatedByUserId: actor.userId,
          },
          update: {
            enabled: nextEnabled.get(c.provider) === true,
            isDefault: c.provider === update.defaultProvider,
            updatedByUserId: actor.userId,
          },
        })
      )
  );

  const after = await getNumberCarriers(prisma);
  await auditLog({
    // Platform-wide, so it belongs to no agency.
    tenantId: null,
    action: 'number_carriers.updated',
    entityType: 'NumberCarrierSetting',
    entityId: 'platform',
    userId: actor.userId,
    ipAddress: actor.ipAddress,
    requestId: actor.requestId,
    changes: {
      before,
      after: after.map(c => ({ provider: c.provider, enabled: c.enabled, isDefault: c.isDefault })),
    },
    success: true,
  });
  return after;
}

/** One number an agency could buy, and which carrier it is for sale at. */
export interface AvailableNumber {
  /** Unique across carriers: `<provider>:<carrier id>`. */
  id: string;
  /** What the carrier calls this number; what `/numbers/buy` sends back to it. */
  carrierId: string;
  number: string;
  provider: PurchasableProvider;
  metadata?: Record<string, unknown>;
}

/**
 * Numbers for sale across every enabled carrier, the default first.
 *
 * One carrier failing -- down, rate-limited, nothing in that area code -- does
 * not fail the search: its results are simply absent and the others are
 * shown. Only when EVERY carrier failed is the error raised, because then the
 * empty list would be a lie about inventory. A number two carriers both offer
 * is shown once, from the earlier (default-first) carrier.
 */
export async function searchAvailableNumbers(params: {
  numberType: NumberType;
  areaCode?: string;
  limit?: number;
}): Promise<{ numbers: AvailableNumber[]; carriersSearched: number }> {
  const carriers = await enabledCarriers(params.numberType);
  if (carriers.length === 0) return { numbers: [], carriersSearched: 0 };

  const results = await Promise.allSettled(
    carriers.map(carrier =>
      provisioningService.searchAvailable(carrier.provider, {
        areaCode: params.areaCode,
        numberType: params.numberType,
        limit: params.limit ?? 50,
      })
    )
  );

  const failures = results.filter(r => r.status === 'rejected');
  if (failures.length === results.length) {
    logger.error({
      msg: 'Every enabled number carrier failed to search',
      numberType: params.numberType,
      areaCode: params.areaCode,
      errors: failures.map(f => String((f).reason)),
    });
    throw new Error('Number search failed at every carrier');
  }

  const seen = new Set<string>();
  const numbers: AvailableNumber[] = [];
  results.forEach((result, i) => {
    const provider = carriers[i].provider as PurchasableProvider;
    if (result.status === 'rejected') {
      logger.warn({
        msg: 'A number carrier failed to search',
        provider,
        error: String(result.reason),
      });
      return;
    }
    for (const found of result.value) {
      const digits = found.number.replace(/\D/g, '').slice(-10);
      if (!digits || seen.has(digits)) continue;
      seen.add(digits);
      numbers.push({
        id: `${provider}:${found.id}`,
        carrierId: found.id,
        number: found.number,
        provider,
        metadata: found.metadata,
      });
    }
  });

  return { numbers, carriersSearched: carriers.length };
}
