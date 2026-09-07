/**
 * Recording a call we refused.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 *
 * Two places block TCPA litigators before a call is routed -- the SignalWire
 * voice webhook and the FreeSWITCH lookup -- and both wrote the same
 * `Call` row to record it, with `tenantId: 'default'`, inside a try/catch that
 * logged and moved on.
 *
 * `'default'` is not a tenant id and `calls.tenantId` is a foreign key, so every
 * one of those inserts failed the constraint and every failure was discarded.
 * The comment above each said "Create blocked call record for audit trail". No
 * such record was ever created. This is the same defect as the one in
 * `services/audit.ts`, on a different table.
 *
 * The tenant is recoverable: we know the number that was dialled, and a DID
 * belongs to exactly one agency. So look it up, and when it genuinely cannot be
 * resolved -- a number not in the platform at all, which is worth knowing about
 * on its own -- log everything needed to reconstruct the event rather than
 * writing a row that cannot be inserted.
 */

import { Prisma } from '@prisma/client';

import { getPrismaClient } from '../lib/prisma.js';

export interface BlockedCallRecord {
  /** The number that was dialled. Used to resolve the agency. */
  toNumber: string;
  /** The caller we refused. */
  callerId: string;
  callSid: string;
  blockReason: string;
  source: 'signalwire' | 'freeswitch';
  metadata?: Record<string, unknown>;
  /**
   * FreeSWITCH refuses the INVITE outright, so its blocks are attributed to
   * SYSTEM to keep them out of the abandon numerator while still counting as
   * instrumented. SignalWire's path does not set these.
   */
  terminationParty?: 'SYSTEM';
  terminationCause?: string;
}

/** Everything a log line needs to stand in for a row that could not be written. */
interface Logger {
  warn: (obj: Record<string, unknown>, msg: string) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
}

/**
 * Resolve the agency that owns a dialled number.
 *
 * Last ten digits, because the same DID arrives in several formats depending on
 * which carrier is asking -- `+15551234567`, `15551234567`, `5551234567`.
 */
export async function resolveTenantForDialledNumber(toNumber: string): Promise<string | null> {
  const digits = toNumber.replace(/\D/g, '');
  if (digits.length < 10) return null;

  const last10 = digits.slice(-10);
  const prisma = getPrismaClient();

  const number = await prisma.phoneNumber.findFirst({
    where: { number: { endsWith: last10 } },
    select: { tenantId: true },
  });

  return number?.tenantId ?? null;
}

/**
 * Record a refused call against the agency whose number was dialled.
 *
 * Returns the row's id, or null when no agency could be resolved -- in which
 * case the event is logged in full instead. Never throws: the caller is in the
 * middle of refusing a call, and failing to write the record must not turn a
 * clean rejection into an error the carrier retries.
 */
export async function recordBlockedCall(
  record: BlockedCallRecord,
  log: Logger
): Promise<string | null> {
  try {
    const tenantId = await resolveTenantForDialledNumber(record.toNumber);

    if (!tenantId) {
      // Not a number this platform serves. Worth a warning in its own right --
      // it means a carrier is sending us traffic for a DID we do not own.
      log.warn(
        {
          event: 'call.blocked.unattributable',
          toNumber: record.toNumber,
          callerId: record.callerId,
          callSid: record.callSid,
          blockReason: record.blockReason,
          source: record.source,
        },
        'Blocked a call on a number belonging to no agency; recorded in the log only'
      );
      return null;
    }

    const call = await getPrismaClient().call.create({
      data: {
        tenantId,
        callSid: record.callSid,
        toNumber: record.toNumber,
        callerId: record.callerId,
        direction: 'INBOUND',
        status: 'FAILED',
        blocked: true,
        blockReason: record.blockReason,
        ...(record.terminationParty ? { terminationParty: record.terminationParty } : {}),
        ...(record.terminationCause ? { terminationCause: record.terminationCause } : {}),
        startedAt: new Date(),
        endedAt: new Date(),
        metadata: { ...record.metadata, source: record.source } as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    return call.id;
  } catch (err) {
    // Logged with the full event, so the record can be reconstructed. Not
    // rethrown: see the note on the return type above.
    log.error(
      {
        err,
        event: 'call.blocked.record_failed',
        toNumber: record.toNumber,
        callerId: record.callerId,
        callSid: record.callSid,
        blockReason: record.blockReason,
        source: record.source,
      },
      'Failed to write blocked-call record'
    );
    return null;
  }
}
