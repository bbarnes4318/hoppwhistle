/**
 * Tone assignments for every enum value in apps/api/prisma/schema.prisma.
 *
 * 68 enums, 266 (enum, value) pairs, 155 distinct value names. Rather than
 * repeat a mapping 22 times for ACTIVE, tones resolve in two layers:
 *
 *   1. DEFAULT_TONE — by value name, correct for that name almost everywhere.
 *   2. ENUM_TONE — per-enum overrides, for the cases where the same word means
 *      something different. This layer is the point of the file.
 *
 * The distinction that matters most: `blocked` (violet) is for something the
 * system stopped ON PURPOSE — DNC, a filtered bid, a cap, an empty wallet, a
 * suspension, a compliance hold. `dropped` (red) is for something that FAILED —
 * abandoned, busy, declined, errored. Colouring a compliance stop red trains
 * people to ignore red, which is the colour that should scare them.
 *
 * scripts/check-status-tones.mjs re-reads the schema and fails if any value is
 * unmapped, so a new enum value cannot silently render as neutral.
 */

export type StatusTone = 'live' | 'ringing' | 'dropped' | 'blocked' | 'money' | 'neutral';

/** Layer 1: by value name. */
export const DEFAULT_TONE: Record<string, StatusTone> = {
  // --- lifecycle ---------------------------------------------------------
  ACTIVE: 'live',
  INACTIVE: 'neutral', // switched off is not a failure
  DRAFT: 'neutral',
  ARCHIVED: 'neutral',
  CLOSED: 'neutral',
  READY: 'live',
  OPEN: 'ringing',

  // --- deliberate stops → blocked ---------------------------------------
  SUSPENDED: 'blocked',
  PAUSED: 'blocked',
  REVOKED: 'blocked',
  EXPIRED: 'blocked',
  MAINTENANCE: 'blocked',
  HELD: 'blocked',
  HOLD: 'blocked',
  SKIPPED: 'blocked', // DNC, invalid number — screened out on purpose
  FILTERED: 'blocked', // bid removed by a targeting rule
  DO_NOT_CALL: 'blocked', // the case this whole colour exists for
  INVALID: 'blocked',
  COMPLIANCE: 'blocked',
  DISPUTE_HOLD: 'blocked',

  // --- failures → dropped ------------------------------------------------
  FAILED: 'dropped',
  ERROR: 'dropped',
  BUSY: 'dropped',
  NO_ANSWER: 'dropped',
  VOICEMAIL: 'dropped', // never reached a person
  LOST: 'dropped',
  DECLINED: 'dropped',
  NOT_TAKEN: 'dropped',
  LAPSED: 'dropped',
  OVERDUE: 'dropped',
  UNMATCHED: 'dropped',
  NEEDS_RECONCILIATION: 'dropped',
  DISPUTE_REVERSAL: 'dropped',
  DAILY_EXCEEDED: 'dropped',
  MONTHLY_EXCEEDED: 'dropped',
  NONE: 'dropped', // STIR: no attestation at all

  // --- in flight → ringing ----------------------------------------------
  PENDING: 'ringing',
  PENDING_APPROVAL: 'ringing',
  PROCESSING: 'ringing',
  RUNNING: 'ringing',
  INITIATED: 'ringing',
  RINGING: 'ringing',
  QUEUED: 'ringing',
  CALLING: 'ringing',
  IN_PROGRESS: 'ringing',
  PORTING: 'ringing',
  RESERVED: 'ringing',
  SENT: 'ringing',
  SUBMITTED: 'ringing',
  UW_REVIEW: 'ringing',
  ORIGINATION_SUBMITTED: 'ringing',
  NEW: 'ringing',
  CONTACTED: 'ringing',
  TEST: 'ringing', // test mode is worth noticing
  DAILY_THRESHOLD: 'ringing',
  MONTHLY_THRESHOLD: 'ringing',
  WARM: 'ringing',
  HIGH: 'ringing',

  // --- good outcomes → live ---------------------------------------------
  COMPLETED: 'live',
  ANSWERED: 'live',
  AVAILABLE: 'live',
  ASSIGNED: 'live',
  VERIFIED: 'live',
  VALID: 'live',
  MATCHED: 'live',
  QUALIFIED: 'live',
  CONVERTED: 'live',
  WON: 'live',
  ISSUED: 'live',
  ORIGINATION_ACCEPTED: 'live',
  LIVE: 'live',
  CREDIT: 'live',
  HOT: 'live',
  A: 'live', // STIR: full attestation

  // --- money -------------------------------------------------------------
  PAID: 'money',
  SOLD: 'money',
  CALL_MINUTE_INBOUND: 'money',
  CALL_MINUTE_OUTBOUND: 'money',
  CONNECTION_FEE: 'money',
  RECORDING_FEE: 'money',
  CPA_CONVERSION: 'money',
  BUYER_REVENUE: 'money',
  PUBLISHER_PAYOUT: 'money',
  CARRIER_COST: 'money',
  PLATFORM_PROFIT: 'money',

  // --- neutral: kinds, types, categories, not health --------------------
  CANCELLED: 'neutral',
  RELEASED: 'neutral',
  NO_BID: 'neutral', // choosing not to bid is not a failure
  COLD: 'neutral',
  B: 'neutral', // STIR: partial attestation
  C: 'neutral', // STIR: gateway attestation
  TAX: 'neutral',
  ADJUSTMENT: 'neutral',
  DEBIT: 'neutral',
  LOW: 'neutral',
  NORMAL: 'neutral',
  URGENT: 'dropped',
  // auth + roles
  EMAIL: 'neutral',
  GOOGLE: 'neutral',
  OWNER: 'neutral',
  ADMIN: 'neutral',
  ANALYST: 'neutral',
  PUBLISHER: 'neutral',
  BUYER: 'neutral',
  AGENT: 'neutral',
  READONLY: 'neutral',
  // transport + routing
  SIP: 'neutral',
  IAX2: 'neutral',
  WEBRTC: 'neutral',
  PSTN: 'neutral',
  STATIC: 'neutral',
  PERFORMANCE: 'neutral',
  HYBRID: 'neutral',
  POOL: 'neutral',
  INBOUND: 'neutral',
  OUTBOUND: 'neutral',
  // flow nodes
  IVR: 'neutral',
  QUEUE: 'neutral',
  BUYER_FORWARD: 'neutral',
  HANGUP: 'neutral',
  RECORDING: 'neutral',
  TRANSFER: 'neutral',
  CONDITIONAL: 'neutral',
  // periods + billing kinds
  HOUR: 'neutral',
  DAY: 'neutral',
  MONTH: 'neutral',
  TERMS: 'neutral',
  UPFRONT: 'neutral',
  // list + consent kinds
  GLOBAL: 'neutral',
  CAMPAIGN: 'neutral',
  CUSTOM: 'neutral',
  TRUSTEDFORM: 'neutral',
  JORNAYA: 'neutral',
  // policy + relationship kinds
  LEVEL: 'neutral',
  GRADED: 'neutral',
  MODIFIED: 'neutral',
  GUARANTEED_ISSUE: 'neutral',
  SPOUSE: 'neutral',
  CHILD: 'neutral',
  PARENT: 'neutral',
  GRANDCHILD: 'neutral',
  SIBLING: 'neutral',
  PARTNER: 'neutral',
  FRIEND: 'neutral',
  OTHER: 'neutral',
  // verticals + activity kinds
  ACA: 'neutral',
  FE: 'neutral',
  B2B: 'neutral',
  NOTE: 'neutral',
  CALL: 'neutral',
  STATUS_CHANGE: 'neutral',
  SUBMISSION: 'neutral',
  VALIDATION: 'neutral',
  SYSTEM: 'neutral',
  TASK: 'neutral',
};

/**
 * Layer 2: per-enum overrides, where the same word means something else.
 * Every entry here is a deliberate reading of that enum's own semantics —
 * several are taken straight from the comments in schema.prisma.
 */
export const ENUM_TONE: Record<string, Record<string, StatusTone>> = {
  // An ACTIVE compliance override is a gate someone deliberately bypassed.
  // It belongs in the compliance colour, not the healthy one.
  ComplianceOverrideStatus: { ACTIVE: 'blocked', PENDING_APPROVAL: 'ringing' },

  // Storage tier is a cost bucket, not a health signal — all neutral.
  RecordingStorageTier: { HOT: 'neutral', WARM: 'neutral', COLD: 'neutral' },

  // A DNC list being ACTIVE means the protection is on. That is healthy.
  DncListStatus: { ACTIVE: 'live' },

  // schema: "Auto-paused when wallet empty" — stopped on purpose.
  BuyerStatus: { PAUSED: 'blocked' },
  // schema: "Manually paused or auto-paused (low funds)".
  AICampaignStatus: { PAUSED: 'blocked' },
  // schema: "Temporarily disabled" vs "Permanently disabled".
  DidRouteStatus: { PAUSED: 'blocked', INACTIVE: 'neutral' },

  // A failed endpoint is an outage, not a deliberate stop.
  BuyerEndpointStatus: { FAILED: 'dropped' },
  WebhookStatus: { FAILED: 'dropped' },

  // Consent that is INVALID or EXPIRED is a compliance stop, not an error.
  ConsentStatus: { INVALID: 'blocked', EXPIRED: 'blocked', VERIFIED: 'live' },

  // A cancelled payout/invoice is a decision, not a failure.
  PayoutStatus: { CANCELLED: 'neutral', FAILED: 'dropped' },
  PayrollPayoutStatus: { CANCELLED: 'neutral', PAID: 'money' },
  InvoiceStatus: { CANCELLED: 'neutral' },

  // A cancelled call never became a call. Not a failure to chase.
  CallStatus: { CANCELLED: 'neutral' },
  CallLegStatus: { CANCELLED: 'neutral' },

  // Task lifecycle, not call health.
  InsuranceTaskStatus: { OPEN: 'ringing', COMPLETED: 'live', CANCELLED: 'neutral' },
};

/** Values that render with their acronym intact rather than title-cased. */
const ACRONYMS = new Set([
  'SIP',
  'PSTN',
  'IAX2',
  'WEBRTC',
  'IVR',
  'ACA',
  'FE',
  'B2B',
  'CPA',
  'UW',
  'DNC',
  'STIR',
  'API',
  'ID',
]);

/** Per-enum label overrides where the raw value would read badly. */
const ENUM_LABEL: Record<string, Record<string, string>> = {
  StirAttestationLevel: {
    A: 'Attestation A',
    B: 'Attestation B',
    C: 'Attestation C',
    NONE: 'No attestation',
  },
  InsuranceLeadMode: { TEST: 'Test mode', LIVE: 'Live' },
  BuyerBillingType: { TERMS: 'Post-pay', UPFRONT: 'Pre-pay' },
  PhoneNumberPoolType: { POOL: 'Pool', STATIC: 'Static', BUYER: 'Buyer-owned' },
};

/**
 * SCREAMING_SNAKE_CASE to human. Acronyms stay uppercase, everything else is
 * sentence case, so a column of chips reads as language and not as constants.
 */
export function formatEnumLabel(value: string, enumName?: string): string {
  const override = enumName && ENUM_LABEL[enumName]?.[value];
  if (override) return override;

  return value
    .split('_')
    .map((word, i) => {
      if (ACRONYMS.has(word)) return word;
      const lower = word.toLowerCase();
      return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(' ');
}

/** Resolve a tone. Unknown values fall back to neutral rather than guessing. */
export function resolveTone(value: string, enumName?: string): StatusTone {
  if (enumName) {
    const override = ENUM_TONE[enumName]?.[value];
    if (override) return override;
  }
  return DEFAULT_TONE[value] ?? 'neutral';
}
