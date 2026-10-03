/**
 * The envelope's audit trail: append-only and hash-chained.
 *
 * Each event's `hash` is SHA-256 over the previous event's hash and the
 * canonical JSON of this event's content, so altering, inserting or removing
 * any row breaks every hash after it. The database refuses UPDATE and DELETE
 * on the table outright (trigger in migrations/20261007000000_agreements); the
 * chain is what proves, to someone who does not trust the database, that it
 * did.
 *
 * Every append goes through `appendEvent`, inside a transaction that holds a
 * row lock on the envelope, so two requests for one envelope cannot both read
 * the same "last event" and fork the chain.
 */

import type {
  AgreementActorType,
  AgreementEvent,
  AgreementEventType,
  Prisma,
  PrismaClient,
} from '@prisma/client';

import { getPrismaClient } from '../../lib/prisma.js';

import { canonicalJson, sha256Hex } from './format.js';

export const GENESIS_HASH = '0'.repeat(64);

export interface EventInput {
  type: AgreementEventType;
  actorType: AgreementActorType;
  actorUserId?: string | null;
  actorEmail?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  detail?: Record<string, unknown>;
  occurredAt?: Date;
}

type Tx = Prisma.TransactionClient;

/** The fields the hash covers, in the shape it covers them. */
function hashPayload(event: {
  envelopeId: string;
  seq: number;
  type: string;
  occurredAt: Date;
  actorType: string;
  actorUserId: string | null;
  actorEmail: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  detail: unknown;
}): string {
  return canonicalJson({
    envelopeId: event.envelopeId,
    seq: event.seq,
    type: event.type,
    occurredAt: event.occurredAt.toISOString(),
    actorType: event.actorType,
    actorUserId: event.actorUserId,
    actorEmail: event.actorEmail,
    ipAddress: event.ipAddress,
    userAgent: event.userAgent,
    detail: event.detail,
  });
}

export function eventHash(prevHash: string, event: Parameters<typeof hashPayload>[0]): string {
  return sha256Hex(prevHash + hashPayload(event));
}

/** Lock the envelope row for the rest of the transaction. */
export async function lockEnvelope(tx: Tx, envelopeId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "agreement_envelopes" WHERE "id" = ${envelopeId} FOR UPDATE`;
}

/** Append one event. Must run inside a transaction (`prisma.$transaction`). */
export async function appendEvent(
  tx: Tx,
  envelopeId: string,
  input: EventInput
): Promise<AgreementEvent> {
  await lockEnvelope(tx, envelopeId);
  const last = await tx.agreementEvent.findFirst({
    where: { envelopeId },
    orderBy: { seq: 'desc' },
    select: { seq: true, hash: true },
  });
  const seq = (last?.seq ?? 0) + 1;
  const prevHash = last?.hash ?? GENESIS_HASH;
  // Through JSON once, so what is hashed is exactly what jsonb will hold.
  const detail = JSON.parse(JSON.stringify(input.detail ?? {})) as Record<string, unknown>;
  // Millisecond precision, which is what the column stores.
  const occurredAt = new Date(Math.floor((input.occurredAt ?? new Date()).getTime()));
  const row = {
    envelopeId,
    seq,
    type: input.type,
    occurredAt,
    actorType: input.actorType,
    actorUserId: input.actorUserId ?? null,
    actorEmail: input.actorEmail ?? null,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    detail,
  };
  return tx.agreementEvent.create({
    data: {
      ...row,
      detail: detail as Prisma.InputJsonValue,
      prevHash,
      hash: eventHash(prevHash, row),
    },
  });
}

/** Append in a transaction of its own. */
export async function recordEvent(
  envelopeId: string,
  input: EventInput,
  prisma: PrismaClient = getPrismaClient()
): Promise<AgreementEvent> {
  return prisma.$transaction(tx => appendEvent(tx, envelopeId, input));
}

export type ChainVerification =
  | { ok: true; count: number; lastHash: string }
  | { ok: false; brokenSeq: number; count: number };

/** Recompute the chain from the first event. */
export function verifyEvents(events: AgreementEvent[]): ChainVerification {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  let prev = GENESIS_HASH;
  for (let i = 0; i < sorted.length; i += 1) {
    const event = sorted[i];
    const expected = eventHash(prev, {
      envelopeId: event.envelopeId,
      seq: event.seq,
      type: event.type,
      occurredAt: event.occurredAt,
      actorType: event.actorType,
      actorUserId: event.actorUserId,
      actorEmail: event.actorEmail,
      ipAddress: event.ipAddress,
      userAgent: event.userAgent,
      detail: event.detail,
    });
    if (event.seq !== i + 1 || event.prevHash !== prev || event.hash !== expected) {
      return { ok: false, brokenSeq: event.seq, count: sorted.length };
    }
    prev = event.hash;
  }
  return { ok: true, count: sorted.length, lastHash: prev };
}

export async function verifyEventChain(
  envelopeId: string,
  prisma: PrismaClient = getPrismaClient()
): Promise<ChainVerification> {
  const events = await prisma.agreementEvent.findMany({
    where: { envelopeId },
    orderBy: { seq: 'asc' },
  });
  return verifyEvents(events);
}
