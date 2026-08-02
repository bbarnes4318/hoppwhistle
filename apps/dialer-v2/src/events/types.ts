/**
 * Dialer V2 — normalized telephony event contract.
 *
 * Spec: `docs/dialer-v2/EVENT_MODEL.md`.
 *
 * Every raw FreeSWITCH event is converted into exactly one shape before it
 * reaches any consumer, so nothing downstream ever parses ESL headers.
 */

export const EVENT_VERSION = 1 as const;

/** FreeSWITCH events Dialer V2 subscribes to. */
export enum TelephonyEventType {
  CHANNEL_CREATE = 'CHANNEL_CREATE',
  CHANNEL_ORIGINATE = 'CHANNEL_ORIGINATE',
  CHANNEL_PROGRESS = 'CHANNEL_PROGRESS',
  CHANNEL_PROGRESS_MEDIA = 'CHANNEL_PROGRESS_MEDIA',
  CHANNEL_ANSWER = 'CHANNEL_ANSWER',
  CHANNEL_BRIDGE = 'CHANNEL_BRIDGE',
  CHANNEL_UNBRIDGE = 'CHANNEL_UNBRIDGE',
  CHANNEL_HANGUP = 'CHANNEL_HANGUP',
  CHANNEL_HANGUP_COMPLETE = 'CHANNEL_HANGUP_COMPLETE',
  DTMF = 'DTMF',
  RECORD_START = 'RECORD_START',
  RECORD_STOP = 'RECORD_STOP',
}

export const SUBSCRIBED_EVENT_TYPES: readonly TelephonyEventType[] = Object.freeze([
  TelephonyEventType.CHANNEL_CREATE,
  TelephonyEventType.CHANNEL_ORIGINATE,
  TelephonyEventType.CHANNEL_PROGRESS,
  TelephonyEventType.CHANNEL_PROGRESS_MEDIA,
  TelephonyEventType.CHANNEL_ANSWER,
  TelephonyEventType.CHANNEL_BRIDGE,
  TelephonyEventType.CHANNEL_UNBRIDGE,
  TelephonyEventType.CHANNEL_HANGUP,
  TelephonyEventType.CHANNEL_HANGUP_COMPLETE,
  TelephonyEventType.DTMF,
  TelephonyEventType.RECORD_START,
  TelephonyEventType.RECORD_STOP,
]);

/**
 * Monotonic rank used to reject backwards state transitions after an ESL
 * reconnect redelivers events out of order. Events not in this map (DTMF,
 * RECORD_*) do not move call state and carry rank 0.
 */
export const EVENT_STATE_RANK: Readonly<Record<string, number>> = Object.freeze({
  [TelephonyEventType.CHANNEL_CREATE]: 1,
  [TelephonyEventType.CHANNEL_ORIGINATE]: 2,
  [TelephonyEventType.CHANNEL_PROGRESS]: 3,
  [TelephonyEventType.CHANNEL_PROGRESS_MEDIA]: 4,
  [TelephonyEventType.CHANNEL_ANSWER]: 5,
  [TelephonyEventType.CHANNEL_BRIDGE]: 6,
  [TelephonyEventType.CHANNEL_UNBRIDGE]: 7,
  [TelephonyEventType.CHANNEL_HANGUP]: 8,
  [TelephonyEventType.CHANNEL_HANGUP_COMPLETE]: 9,
});

export type AnswerState = 'ringing' | 'early' | 'answered' | 'hangup' | 'unknown';

export interface NormalizedTelephonyEvent {
  eventId: string;
  eventType: TelephonyEventType;
  eventVersion: typeof EVENT_VERSION;

  /** Source clock, epoch milliseconds. */
  occurredAt: number;
  /** Our clock, epoch milliseconds. The gap is the lag metric. */
  receivedAt: number;

  tenantId: string;
  campaignId: string | null;
  leadId: string | null;
  attemptId: string | null;
  callId: string | null;
  agentId: string | null;

  channelUuid: string | null;
  otherLegUuid: string | null;

  callerNumber: string | null;
  destinationNumber: string | null;
  gateway: string | null;

  answerState: AnswerState;
  hangupCause: string | null;

  rawEventName: string;
  rawEventSubclass: string | null;

  /** Which dialer produced the channel: 1 = Hopper, 2 = Dialer V2, null = unknown. */
  dialerVersion: number | null;
}

/**
 * An event that could not be attributed to a tenant. Deliberately a distinct
 * type: it is neither dropped nor assigned a default tenant, because assigning
 * one is a cross-tenant data leak and dropping it hides a correlation bug.
 */
export interface QuarantinedEvent {
  reason: QuarantineReason;
  rawEventName: string;
  channelUuid: string | null;
  occurredAt: number;
  receivedAt: number;
  /** Header subset kept for forensics. Never includes full channel variables. */
  detail: Record<string, string>;
}

export enum QuarantineReason {
  NO_TENANT = 'NO_TENANT',
  INVALID_TENANT_ID = 'INVALID_TENANT_ID',
  UNSUPPORTED_EVENT = 'UNSUPPORTED_EVENT',
  MALFORMED = 'MALFORMED',
}

export type NormalizeResult =
  | { ok: true; event: NormalizedTelephonyEvent }
  | { ok: false; quarantined: QuarantinedEvent };

/** Raw ESL event as a flat header map — what modesl hands us. */
export type RawEslEvent = Record<string, string | undefined>;
