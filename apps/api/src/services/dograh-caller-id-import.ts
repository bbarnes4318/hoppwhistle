/**
 * Dograh state-matched caller-ID pool import.
 *
 * Imports DID phone numbers (CSV rows of `number,state`) into the canonical
 * PhoneNumber inventory and designates them as Dograh outbound caller IDs via
 * an authoritative CallerIdPool ("Dograh State Caller IDs") plus
 * `metadata.dograhCallerId = true`. Idempotent and dry-run capable.
 *
 * Validation is fail-closed: malformed, non-US, toll-free/non-geographic,
 * unknown-area-code, duplicate, state-mismatched, cross-tenant, and
 * user-assigned numbers are rejected with per-number reasons.
 */

import { NON_GEOGRAPHIC_CODES, extractAreaCode, getStateFromAreaCode } from '../lib/geo.js';
import { getPrismaClient } from '../lib/prisma.js';

export const DOGRAH_CALLER_ID_POOL_NAME = 'Dograh State Caller IDs';
export const DOGRAH_CID_METADATA_SOURCE = 'dograh-state-cid-import';

export interface ImportRow {
  number: string;
  state?: string;
}

export interface RejectedRow {
  number: string;
  reason: string;
}

export interface PlannedNumber {
  e164: string;
  npa: string;
  state: string;
}

export interface ImportPlan {
  totalSupplied: number;
  valid: PlannedNumber[];
  rejected: RejectedRow[];
  duplicates: string[];
  unknownState: string[];
}

/** Normalize 10-digit / 1-prefixed / formatted / E.164 US input to +1XXXXXXXXXX. */
export function normalizeUsE164(raw: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (hasPlus && !digits.startsWith('1')) return null; // explicit non-US country code
  let ten = digits;
  if (ten.length === 11 && ten.startsWith('1')) ten = ten.slice(1);
  if (ten.length !== 10) return null;
  if (ten[0] === '0' || ten[0] === '1' || ten[3] === '0' || ten[3] === '1') return null;
  return `+1${ten}`;
}

/** Pure validation/normalization pass — no database access. */
export function planImport(rows: ImportRow[]): ImportPlan {
  const plan: ImportPlan = {
    totalSupplied: rows.length,
    valid: [],
    rejected: [],
    duplicates: [],
    unknownState: [],
  };
  const seen = new Set<string>();

  for (const row of rows) {
    const e164 = normalizeUsE164(row.number);
    if (!e164) {
      plan.rejected.push({ number: row.number, reason: 'MALFORMED_OR_NON_US' });
      continue;
    }
    if (seen.has(e164)) {
      plan.duplicates.push(e164);
      continue;
    }
    seen.add(e164);

    const npa = extractAreaCode(e164);
    if (!npa) {
      plan.rejected.push({ number: e164, reason: 'MALFORMED_OR_NON_US' });
      continue;
    }
    if (NON_GEOGRAPHIC_CODES.has(npa)) {
      plan.rejected.push({ number: e164, reason: 'TOLL_FREE_OR_NON_GEOGRAPHIC' });
      continue;
    }
    const state = getStateFromAreaCode(npa);
    if (!state) {
      plan.rejected.push({ number: e164, reason: 'UNKNOWN_OR_UNSUPPORTED_AREA_CODE' });
      plan.unknownState.push(e164);
      continue;
    }
    const declared = row.state?.trim().toUpperCase();
    if (declared && declared !== state) {
      plan.rejected.push({
        number: e164,
        reason: `STATE_MISMATCH declared=${declared} canonical=${state}`,
      });
      continue;
    }
    plan.valid.push({ e164, npa, state });
  }

  return plan;
}

export interface ImportResult extends ImportPlan {
  dryRun: boolean;
  tenantId: string;
  provider: string;
  poolId: string | null;
  inserted: number;
  updated: number;
  alreadyCorrect: number;
  linkedToPool: number;
  stateInventory: Record<string, number>;
  dbConfirmedPoolTotal: number | null;
}

export interface RunImportOptions {
  tenantId: string;
  provider?: string; // carrier the DIDs egress through
  dryRun?: boolean;
  prismaClient?: ReturnType<typeof getPrismaClient>;
}

export async function runImport(
  rows: ImportRow[],
  options: RunImportOptions
): Promise<ImportResult> {
  const prisma = options.prismaClient ?? getPrismaClient();
  const dryRun = options.dryRun !== false; // default: dry run
  const provider = options.provider || 'fractel';
  const { tenantId } = options;

  const plan = planImport(rows);
  const result: ImportResult = {
    ...plan,
    dryRun,
    tenantId,
    provider,
    poolId: null,
    inserted: 0,
    updated: 0,
    alreadyCorrect: 0,
    linkedToPool: 0,
    stateInventory: {},
    dbConfirmedPoolTotal: null,
  };

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);

  // Authoritative pool designation record.
  let pool = await prisma.callerIdPool.findFirst({
    where: { tenantId, name: DOGRAH_CALLER_ID_POOL_NAME },
  });
  if (!pool && !dryRun) {
    pool = await prisma.callerIdPool.create({
      data: {
        tenantId,
        name: DOGRAH_CALLER_ID_POOL_NAME,
        status: 'ACTIVE',
        metadata: { purpose: 'dograh_state_cid', createdBy: DOGRAH_CID_METADATA_SOURCE },
      },
    });
  }
  result.poolId = pool?.id ?? null;

  const survivors: PlannedNumber[] = [];
  for (const item of plan.valid) {
    // Cross-tenant safety: the per-tenant unique key would happily create a
    // second row for our tenant — check globally first and refuse.
    const existingRows = await prisma.phoneNumber.findMany({
      where: { number: item.e164 },
      select: { id: true, tenantId: true, userId: true, status: true, metadata: true },
    });
    const otherTenant = existingRows.find(r => r.tenantId !== tenantId);
    const mine = existingRows.find(r => r.tenantId === tenantId);
    if (otherTenant && !mine) {
      result.rejected.push({ number: item.e164, reason: 'OWNED_BY_OTHER_TENANT' });
      continue;
    }
    if (mine?.userId) {
      // Agent-assigned DIDs must not enter the AI outbound caller-ID pool.
      result.rejected.push({ number: item.e164, reason: 'NUMBER_ASSIGNED_TO_USER' });
      continue;
    }
    survivors.push(item);

    const existingMeta =
      mine && mine.metadata && typeof mine.metadata === 'object' && !Array.isArray(mine.metadata)
        ? (mine.metadata as Record<string, unknown>)
        : {};
    const desiredMetaSubset = {
      npa: item.npa,
      state: item.state,
      dograhCallerId: true,
      source: DOGRAH_CID_METADATA_SOURCE,
    };
    const metaCorrect =
      existingMeta.npa === item.npa &&
      existingMeta.state === item.state &&
      existingMeta.dograhCallerId === true;

    if (mine) {
      if (metaCorrect && mine.status === 'ACTIVE') {
        result.alreadyCorrect++;
      } else {
        result.updated++;
        if (!dryRun) {
          await prisma.phoneNumber.update({
            where: { id: mine.id },
            data: {
              status: 'ACTIVE',
              metadata: { ...existingMeta, ...desiredMetaSubset },
            },
          });
        }
      }
      if (!dryRun && pool) {
        await prisma.callerIdPoolPhoneNumber.upsert({
          where: {
            callerIdPoolId_phoneNumberId: {
              callerIdPoolId: pool.id,
              phoneNumberId: mine.id,
            },
          },
          create: { callerIdPoolId: pool.id, phoneNumberId: mine.id },
          update: {},
        });
        result.linkedToPool++;
      }
    } else {
      result.inserted++;
      if (!dryRun && pool) {
        const created = await prisma.phoneNumber.create({
          data: {
            tenantId,
            number: item.e164,
            provider,
            status: 'ACTIVE',
            poolType: 'STATIC',
            capabilities: { voice: true },
            metadata: { ...desiredMetaSubset, importedAt: new Date().toISOString() },
            purchasedAt: new Date(),
          },
        });
        await prisma.callerIdPoolPhoneNumber.upsert({
          where: {
            callerIdPoolId_phoneNumberId: {
              callerIdPoolId: pool.id,
              phoneNumberId: created.id,
            },
          },
          create: { callerIdPoolId: pool.id, phoneNumberId: created.id },
          update: {},
        });
        result.linkedToPool++;
      }
    }
  }

  for (const item of survivors) {
    result.stateInventory[item.state] = (result.stateInventory[item.state] || 0) + 1;
  }

  // Independent post-apply confirmation — never claim success without it.
  if (!dryRun && pool) {
    result.dbConfirmedPoolTotal = await prisma.callerIdPoolPhoneNumber.count({
      where: { callerIdPoolId: pool.id, phoneNumber: { status: 'ACTIVE', tenantId } },
    });
  }

  return result;
}
