/**
 * Who answered an inbound call, from the CDR.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 *
 * The call record says who ACTUALLY answered, and billing, payouts, Today,
 * Revenue and the leaderboard all read that.
 *
 * Until this existed the CDR carried the FIRST leg of the routing plan as the
 * call's buyer: routing picked a primary endpoint, the Lua echoed it back, and
 * the handler wrote it to `calls.buyerId` whoever picked up. A call answered
 * by an agent, or by the buyer in step three, was billed to the buyer in step
 * one; a call nobody answered was billed to them too.
 *
 * Every leg of the dial string now carries `x_leg_party=buyer:<id>` or
 * `x_leg_party=agent:<userId>` (see `taggedLeg` in routing.ts), and
 * inbound_route.lua reads it back off the leg that answered and sends it as
 * `answeredParty`. That is the only thing attribution is taken from.
 *
 * ── Validated, not trusted ──────────────────────────────────────────────────
 *
 * The id arrives in a webhook body. A buyer id must name a buyer of THIS
 * tenant and an agent id an AGENT user of this tenant, or it is dropped: an
 * unknown id would violate a foreign key and lose the row, and another
 * agency's id would put the call on their books.
 */

import type { Prisma, PrismaClient } from '@prisma/client';

import { recordDelivery } from './routing-buyer-gates.js';

export type AnsweredParty =
  | { kind: 'buyer'; id: string }
  | { kind: 'agent'; id: string }
  | { kind: 'none' };

export function parseAnsweredParty(raw: string | null | undefined): AnsweredParty {
  const value = (raw ?? '').trim();
  const match = /^(buyer|agent):([A-Za-z0-9_-]+)$/.exec(value);
  if (!match) return { kind: 'none' };
  return { kind: match[1] as 'buyer' | 'agent', id: match[2] };
}

export interface AnsweredAttribution {
  buyerId: string | null;
  buyerName: string | null;
  /** The buyer endpoint that took the call, when it can be named. */
  targetId: string | null;
  answeredByUserId: string | null;
  /** For the cap counter: the endpoint's cap settings, when a buyer endpoint answered. */
  endpoint: { id: string; capPeriod: string; timezone: string | null; maxCap: number } | null;
}

const NOBODY: AnsweredAttribution = {
  buyerId: null,
  buyerName: null,
  targetId: null,
  answeredByUserId: null,
  endpoint: null,
};

function lastTen(value: string | null | undefined): string {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

type AttributionClient = Pick<PrismaClient, 'buyer' | 'buyerEndpoint' | 'user'>;

export async function resolveAnsweredParty(
  prisma: AttributionClient,
  input: {
    tenantId: string;
    answeredParty: string | null | undefined;
    answeredTarget?: string | null;
    answeredNumber?: string | null;
  }
): Promise<AnsweredAttribution> {
  const party = parseAnsweredParty(input.answeredParty);

  if (party.kind === 'agent') {
    const agent = await prisma.user.findFirst({
      where: {
        id: party.id,
        tenantId: input.tenantId,
        roles: { some: { role: { name: 'AGENT' } } },
      },
      select: { id: true },
    });
    return agent ? { ...NOBODY, answeredByUserId: agent.id } : NOBODY;
  }

  if (party.kind === 'buyer') {
    const buyer = await prisma.buyer.findFirst({
      where: { id: party.id, tenantId: input.tenantId },
      select: { id: true, name: true },
    });
    if (!buyer) return NOBODY;

    const endpointSelect = {
      id: true,
      destination: true,
      capPeriod: true,
      timezone: true,
      maxCap: true,
    } as const;
    let endpoint: Prisma.BuyerEndpointGetPayload<{ select: typeof endpointSelect }> | null = null;
    if (input.answeredTarget) {
      endpoint = await prisma.buyerEndpoint.findFirst({
        where: { id: input.answeredTarget, buyerId: buyer.id },
        select: endpointSelect,
      });
    }
    if (!endpoint && input.answeredNumber) {
      const wanted = lastTen(input.answeredNumber);
      const candidates = await prisma.buyerEndpoint.findMany({
        where: { buyerId: buyer.id, status: 'ACTIVE' },
        select: endpointSelect,
      });
      endpoint = candidates.find(ep => wanted && lastTen(ep.destination) === wanted) ?? null;
    }

    return {
      buyerId: buyer.id,
      buyerName: buyer.name,
      targetId: endpoint?.id ?? null,
      answeredByUserId: null,
      endpoint: endpoint
        ? {
            id: endpoint.id,
            capPeriod: endpoint.capPeriod,
            timezone: endpoint.timezone,
            maxCap: endpoint.maxCap,
          }
        : null,
    };
  }

  return NOBODY;
}

/** Count an answered call against the endpoint's routing cap. Never throws. */
export async function countDelivery(attribution: AnsweredAttribution, at: Date): Promise<void> {
  if (!attribution.endpoint) return;
  await recordDelivery(
    attribution.endpoint.id,
    attribution.endpoint.capPeriod,
    attribution.endpoint.timezone,
    at
  );
}
