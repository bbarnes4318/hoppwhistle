/**
 * Dialer V2 — raw ESL event → normalized event.
 *
 * Pure. `receivedAt` is an argument, not a clock read, so normalization is
 * replayable and every branch is testable.
 *
 * Two rules that are not negotiable:
 *
 * 1. **No default tenant.** An event whose tenant cannot be proven is
 *    quarantined. Attributing it to a fallback tenant would be a cross-tenant
 *    leak; dropping it would hide a correlation bug.
 * 2. **Deterministic identity.** `eventId` is derived from the event's own
 *    content, so the same physical event redelivered after an ESL reconnect
 *    produces the same id and dedupes cleanly.
 */

import { createHash } from 'node:crypto';

import { isValidTenantId } from '../config/redis-keys.js';

import {
  EVENT_VERSION,
  QuarantineReason,
  TelephonyEventType,
  type AnswerState,
  type NormalizeResult,
  type RawEslEvent,
} from './types.js';

const SUPPORTED = new Set<string>(Object.values(TelephonyEventType));

/** Read the first present header from a list of candidates. */
function header(raw: RawEslEvent, ...names: string[]): string | null {
  for (const name of names) {
    const value = raw[name];
    if (typeof value === 'string' && value.length > 0 && value !== '_undef_') {
      return value;
    }
  }
  return null;
}

/**
 * FreeSWITCH reports epoch time in MICROseconds in `Event-Date-Timestamp`.
 * Getting this wrong by 1000x silently makes every event look 50 years stale,
 * which would trip the event-lag hard stop in the pacing controller.
 */
function parseOccurredAt(raw: RawEslEvent, fallbackMs: number): number {
  const micros = header(raw, 'Event-Date-Timestamp');
  if (micros) {
    const n = Number.parseInt(micros, 10);
    if (Number.isFinite(n) && n > 0) return Math.floor(n / 1000);
  }
  const local = header(raw, 'Event-Date-Local', 'Event-Date-GMT');
  if (local) {
    const parsed = Date.parse(local);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallbackMs;
}

function parseEventType(raw: RawEslEvent): TelephonyEventType | null {
  const name = header(raw, 'Event-Name');
  if (!name) return null;
  if (name === 'CUSTOM') {
    const subclass = header(raw, 'Event-Subclass');
    if (subclass && SUPPORTED.has(subclass)) return subclass as TelephonyEventType;
    return null;
  }
  return SUPPORTED.has(name) ? (name as TelephonyEventType) : null;
}

function deriveAnswerState(eventType: TelephonyEventType, raw: RawEslEvent): AnswerState {
  switch (eventType) {
    case TelephonyEventType.CHANNEL_ANSWER:
    case TelephonyEventType.CHANNEL_BRIDGE:
      return 'answered';
    case TelephonyEventType.CHANNEL_PROGRESS:
    case TelephonyEventType.CHANNEL_PROGRESS_MEDIA:
      return 'early';
    case TelephonyEventType.CHANNEL_CREATE:
    case TelephonyEventType.CHANNEL_ORIGINATE:
      return 'ringing';
    case TelephonyEventType.CHANNEL_HANGUP:
    case TelephonyEventType.CHANNEL_HANGUP_COMPLETE:
      return 'hangup';
    default: {
      // For DTMF/RECORD_* fall back to whatever the channel reports.
      const state = header(raw, 'Answer-State');
      if (state === 'answered' || state === 'early' || state === 'ringing' || state === 'hangup') {
        return state;
      }
      return 'unknown';
    }
  }
}

/**
 * Extract the gateway name from a FreeSWITCH channel name such as
 * `sofia/gateway/fractel3/+18005551212`. Returns null rather than guessing when
 * the channel is not a gateway channel (a WebRTC agent leg, for instance).
 */
function parseGateway(raw: RawEslEvent): string | null {
  const explicit = header(raw, 'variable_hopwhistle_gateway', 'variable_sip_gateway_name');
  if (explicit) return explicit;

  const channelName = header(raw, 'Channel-Name', 'variable_channel_name');
  if (!channelName) return null;
  const match = /^sofia\/gateway\/([^/]+)\//.exec(channelName);
  return match ? match[1] : null;
}

function parseDialerVersion(raw: RawEslEvent): number | null {
  const value = header(raw, 'variable_hopwhistle_dialer_version');
  if (!value) return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Deterministic event identity.
 *
 * Derived from content rather than generated, so an ESL reconnect that
 * redelivers the same physical event yields the same id. `Event-Sequence` is
 * included because FreeSWITCH guarantees it is unique per event on a given
 * instance; the other components make the id stable even when it is absent.
 */
export function deriveEventId(raw: RawEslEvent, eventType: string, occurredAt: number): string {
  const parts = [
    header(raw, 'Core-UUID') ?? '',
    header(raw, 'Event-Sequence') ?? '',
    header(raw, 'Unique-ID', 'Channel-Call-UUID') ?? '',
    eventType,
    String(occurredAt),
    // DTMF events can repeat within a millisecond on the same channel.
    header(raw, 'DTMF-Digit') ?? '',
    header(raw, 'Record-File-Path') ?? '',
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
}

/** Headers worth keeping when quarantining. Deliberately small — no PII dump. */
function quarantineDetail(raw: RawEslEvent): Record<string, string> {
  const keep = ['Event-Name', 'Event-Subclass', 'Channel-Name', 'Call-Direction', 'Unique-ID'];
  const detail: Record<string, string> = {};
  for (const key of keep) {
    const value = raw[key];
    if (typeof value === 'string' && value.length > 0) detail[key] = value;
  }
  return detail;
}

export function normalizeEslEvent(raw: RawEslEvent, receivedAt: number): NormalizeResult {
  if (!raw || typeof raw !== 'object') {
    return {
      ok: false,
      quarantined: {
        reason: QuarantineReason.MALFORMED,
        rawEventName: 'UNKNOWN',
        channelUuid: null,
        occurredAt: receivedAt,
        receivedAt,
        detail: {},
      },
    };
  }

  const rawEventName = header(raw, 'Event-Name') ?? 'UNKNOWN';
  const rawEventSubclass = header(raw, 'Event-Subclass');
  const occurredAt = parseOccurredAt(raw, receivedAt);
  const channelUuid = header(raw, 'Unique-ID', 'Channel-Call-UUID', 'variable_uuid');

  const eventType = parseEventType(raw);
  if (!eventType) {
    return {
      ok: false,
      quarantined: {
        reason: QuarantineReason.UNSUPPORTED_EVENT,
        rawEventName,
        channelUuid,
        occurredAt,
        receivedAt,
        detail: quarantineDetail(raw),
      },
    };
  }

  // Tenant attribution. The channel variable is set at originate time by both
  // the Hopper (hopwhistle_tenant_id) and Dialer V2.
  const tenantId = header(
    raw,
    'variable_hopwhistle_tenant_id',
    'variable_sip_h_X-Hopwhistle-Tenant-Id'
  );

  if (!tenantId) {
    return {
      ok: false,
      quarantined: {
        reason: QuarantineReason.NO_TENANT,
        rawEventName,
        channelUuid,
        occurredAt,
        receivedAt,
        detail: quarantineDetail(raw),
      },
    };
  }

  if (!isValidTenantId(tenantId)) {
    // A channel variable claiming to be tenant `global` is either a bug or an
    // attempt to write into the platform namespace. Neither gets through.
    return {
      ok: false,
      quarantined: {
        reason: QuarantineReason.INVALID_TENANT_ID,
        rawEventName,
        channelUuid,
        occurredAt,
        receivedAt,
        detail: quarantineDetail(raw),
      },
    };
  }

  return {
    ok: true,
    event: {
      eventId: deriveEventId(raw, eventType, occurredAt),
      eventType,
      eventVersion: EVENT_VERSION,
      occurredAt,
      receivedAt,
      tenantId,
      campaignId: header(raw, 'variable_hopwhistle_campaign_id'),
      leadId: header(raw, 'variable_hopwhistle_lead_id'),
      attemptId: header(raw, 'variable_hopwhistle_attempt_id'),
      callId: header(raw, 'variable_hopwhistle_call_id', 'variable_hopwhistle_callid'),
      agentId: header(raw, 'variable_hopwhistle_agent_id'),
      channelUuid,
      otherLegUuid: header(raw, 'Other-Leg-Unique-ID', 'variable_bridge_uuid'),
      callerNumber: header(raw, 'Caller-Caller-ID-Number', 'variable_origination_caller_id_number'),
      destinationNumber: header(raw, 'Caller-Destination-Number', 'variable_sip_to_user'),
      gateway: parseGateway(raw),
      answerState: deriveAnswerState(eventType, raw),
      hangupCause: header(raw, 'Hangup-Cause', 'variable_hangup_cause'),
      rawEventName,
      rawEventSubclass,
      dialerVersion: parseDialerVersion(raw),
    },
  };
}
