/**
 * Add a number the platform already owns at a carrier to one agency.
 *
 * Buying goes through `POST /api/v1/numbers`, and `Sync Anveo` pulls the WHOLE
 * Anveo account into whichever agency is acting. Neither puts one existing DID
 * into one agency, which is what setting up a new agency needs: take a number
 * that already rings into FreeSWITCH and point it at that agency's campaign.
 *
 * ── One owner per number ────────────────────────────────────────────────────
 *
 * `phone_numbers` and `did_routes` are unique per (tenant, number), not per
 * number, and the FreeSWITCH lookup takes the first ACTIVE route for a DID with
 * no ordering. A number active in two agencies therefore routes to either of
 * them at random. So a number that is ACTIVE in another agency is refused, with
 * that agency named, rather than silently duplicated.
 */

import type { PrismaClient } from '@prisma/client';

import type { Provider } from './provisioning/types.js';

export const EXISTING_NUMBER_PROVIDERS: Provider[] = [
  'anveo',
  'fractel',
  'bulkvs',
  'signalwire',
  'telnyx',
  'twilio',
  'vonage',
  'bandwidth',
  'local',
];

export interface AddExistingNumberInput {
  number: string;
  provider: string;
  campaignId?: string | null;
}

export type AddExistingNumberResult =
  | { ok: true; id: string; number: string; created: boolean }
  | {
      ok: false;
      status: 400 | 404 | 409;
      code: 'INVALID_NUMBER' | 'INVALID_PROVIDER' | 'CAMPAIGN_NOT_FOUND' | 'NUMBER_IN_USE';
      message: string;
    };

/** `+1XXXXXXXXXX` for a US number, or null. */
export function normalizeUsNumber(raw: string): string | null {
  const trimmed = (raw || '').trim();
  if (!trimmed || !/^[\d\s()+.-]+$/.test(trimmed)) return null;
  let digits = trimmed.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10 || /^[01]/.test(digits)) return null;
  return `+1${digits}`;
}

export async function addExistingNumber(
  prisma: PrismaClient,
  tenantId: string,
  input: AddExistingNumberInput
): Promise<AddExistingNumberResult> {
  const number = normalizeUsNumber(input.number);
  if (!number) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_NUMBER',
      message: 'Enter a 10-digit US phone number',
    };
  }

  const provider = (input.provider || '').toLowerCase() as Provider;
  if (!EXISTING_NUMBER_PROVIDERS.includes(provider)) {
    return { ok: false, status: 400, code: 'INVALID_PROVIDER', message: 'Unknown carrier' };
  }

  const campaignId = input.campaignId || null;
  if (campaignId) {
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, tenantId },
      select: { id: true },
    });
    if (!campaign) {
      return {
        ok: false,
        status: 404,
        code: 'CAMPAIGN_NOT_FOUND',
        message: 'That campaign does not belong to this agency',
      };
    }
  }

  const elsewhere = await prisma.phoneNumber.findFirst({
    where: { number, status: 'ACTIVE', tenantId: { not: tenantId } },
    select: { tenant: { select: { name: true } } },
  });
  const routedElsewhere = elsewhere
    ? null
    : await prisma.didRoute.findFirst({
        where: { did: number, status: 'ACTIVE', tenantId: { not: tenantId } },
        select: { tenant: { select: { name: true } } },
      });
  const owner = elsewhere ?? routedElsewhere;
  if (owner) {
    return {
      ok: false,
      status: 409,
      code: 'NUMBER_IN_USE',
      message: `${number} is already active in ${owner.tenant?.name ?? 'another agency'}. Release it there first, or calls to it would reach either agency.`,
    };
  }

  const existing = await prisma.phoneNumber.findUnique({
    where: { tenantId_number: { tenantId, number } },
    select: { id: true },
  });

  if (existing) {
    await prisma.phoneNumber.update({
      where: { id: existing.id },
      data: { provider, status: 'ACTIVE', campaignId },
    });
    return { ok: true, id: existing.id, number, created: false };
  }

  const created = await prisma.phoneNumber.create({
    data: {
      tenantId,
      number,
      provider,
      status: 'ACTIVE',
      campaignId,
      capabilities: { voice: true },
      purchasedAt: new Date(),
      metadata: { source: 'manual_add', addedAt: new Date().toISOString() },
    },
    select: { id: true },
  });
  return { ok: true, id: created.id, number, created: true };
}
