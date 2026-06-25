// ============================================================================
// Contractor Call Intelligence — Shared Constants
// ============================================================================
// Canonical disposition values, display labels, call sources, and follow-up statuses.
// Used by both API routes and frontend components.
// ============================================================================

// ─── Dispositions ─────────────────────────────────────────────────────────────

export const DISPOSITIONS = [
  'SET_APPOINTMENT',
  'SET_CALLBACK',
  'FOLLOW_UP',
  'NOT_INTERESTED',
  'NOT_QUALIFIED',
  'NO_ANSWER',
  'WRONG_NUMBER',
  'DISCONNECTED',
  'APPLICATION_SUBMITTED',
  'VERIFIED',
  'NO_MEMORY_CONFUSED',
  'DENIES_APPLICATION',
  'PAYMENT_ISSUE',
  'POLICY_DETAILS_WRONG',
  'POSSIBLE_PRESSURE_COACHING',
  'NO_CONTACT',
  'LIVE_TRANSFER',
] as const;

export type DispositionValue = (typeof DISPOSITIONS)[number];

/** Map canonical disposition values to user-facing display labels */
export const DISPOSITION_LABELS: Record<DispositionValue, string> = {
  SET_APPOINTMENT: 'Set Appointment',
  SET_CALLBACK: 'Set Callback',
  FOLLOW_UP: 'Follow-Up',
  NOT_INTERESTED: 'Not Interested',
  NOT_QUALIFIED: 'Not Qualified',
  NO_ANSWER: 'No Answer',
  WRONG_NUMBER: 'Wrong Number',
  DISCONNECTED: 'Disconnected',
  APPLICATION_SUBMITTED: 'Application Submitted',
  VERIFIED: 'Verified',
  NO_MEMORY_CONFUSED: 'No Memory / Confused',
  DENIES_APPLICATION: 'Denies Application',
  PAYMENT_ISSUE: 'Payment Issue',
  POLICY_DETAILS_WRONG: 'Policy Details Wrong',
  POSSIBLE_PRESSURE_COACHING: 'Possible Pressure / Coaching',
  NO_CONTACT: 'No Contact',
  LIVE_TRANSFER: 'Live Transfer',
};

/** Dispositions that require or strongly prompt for a follow-up date/time */
export const FOLLOW_UP_DISPOSITIONS: DispositionValue[] = [
  'SET_APPOINTMENT',
  'SET_CALLBACK',
  'FOLLOW_UP',
];

/** Dispositions that count as "connected" conversations (for appointment rate) */
export const CONNECTED_DISPOSITIONS: DispositionValue[] = [
  'SET_APPOINTMENT',
  'SET_CALLBACK',
  'FOLLOW_UP',
  'NOT_INTERESTED',
  'NOT_QUALIFIED',
  'APPLICATION_SUBMITTED',
  'VERIFIED',
  'NO_MEMORY_CONFUSED',
  'DENIES_APPLICATION',
  'PAYMENT_ISSUE',
  'POLICY_DETAILS_WRONG',
  'POSSIBLE_PRESSURE_COACHING',
  'LIVE_TRANSFER',
];

/** Dispositions that count as non-conversation (excluded from connected count) */
export const NON_CONNECTED_DISPOSITIONS: DispositionValue[] = [
  'NO_ANSWER',
  'WRONG_NUMBER',
  'DISCONNECTED',
  'NO_CONTACT',
];

/** Badge color classes for each disposition */
export const DISPOSITION_COLORS: Record<DispositionValue, string> = {
  SET_APPOINTMENT: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  SET_CALLBACK: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
  FOLLOW_UP: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  NOT_INTERESTED: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  NOT_QUALIFIED: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
  NO_ANSWER: 'bg-slate-500/10 text-slate-400 border-slate-500/30',
  WRONG_NUMBER: 'bg-red-500/10 text-red-400 border-red-500/30',
  DISCONNECTED: 'bg-red-500/10 text-red-300 border-red-500/20',
  APPLICATION_SUBMITTED: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  VERIFIED: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  NO_MEMORY_CONFUSED: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  DENIES_APPLICATION: 'bg-red-500/10 text-red-400 border-red-500/30',
  PAYMENT_ISSUE: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
  POLICY_DETAILS_WRONG: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
  POSSIBLE_PRESSURE_COACHING: 'bg-red-500/10 text-red-400 border-red-500/30',
  NO_CONTACT: 'bg-slate-500/10 text-slate-400 border-slate-500/30',
  LIVE_TRANSFER: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
};

// ─── Call Sources ─────────────────────────────────────────────────────────────

export const CALL_SOURCES = [
  'CALL_CENTER',
  'SOFTPHONE',
  'AI_VOICE',
] as const;

export type CallSourceValue = (typeof CALL_SOURCES)[number];

export const CALL_SOURCE_LABELS: Record<CallSourceValue, string> = {
  CALL_CENTER: 'Call Center',
  SOFTPHONE: 'Softphone',
  AI_VOICE: 'AI Voice',
};

// ─── Follow-Up Statuses ───────────────────────────────────────────────────────

export const FOLLOW_UP_STATUSES = [
  'PENDING',
  'COMPLETED',
  'CANCELLED',
] as const;

export type FollowUpStatusValue = (typeof FOLLOW_UP_STATUSES)[number];

export const FOLLOW_UP_STATUS_LABELS: Record<FollowUpStatusValue, string> = {
  PENDING: 'Pending',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

// ─── AI Voice Contractor Categories ───────────────────────────────────────────

export const CONTRACTOR_CATEGORIES = [
  { key: 'roofing', label: 'Roofing' },
  { key: 'storm-damage', label: 'Storm Damage' },
  { key: 'gutters-siding', label: 'Gutters & Siding' },
  { key: 'windows-exterior', label: 'Windows & Exterior' },
  { key: 'solar', label: 'Solar' },
  { key: 'custom', label: 'Custom' },
] as const;

export type ContractorCategoryKey = (typeof CONTRACTOR_CATEGORIES)[number]['key'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Validate that a string is a valid canonical disposition value */
export function isValidDisposition(value: string): value is DispositionValue {
  return (DISPOSITIONS as readonly string[]).includes(value);
}

/** Validate that a string is a valid call source */
export function isValidCallSource(value: string): value is CallSourceValue {
  return (CALL_SOURCES as readonly string[]).includes(value);
}

/** Validate that a string is a valid follow-up status */
export function isValidFollowUpStatus(value: string): value is FollowUpStatusValue {
  return (FOLLOW_UP_STATUSES as readonly string[]).includes(value);
}

/** Get display label for a disposition, fallback to the raw value */
export function getDispositionLabel(value: string): string {
  if (isValidDisposition(value)) {
    return DISPOSITION_LABELS[value];
  }
  return value;
}

/** Check if a disposition requires/prompts for a follow-up date */
export function dispositionRequiresFollowUp(value: string): boolean {
  return (FOLLOW_UP_DISPOSITIONS as readonly string[]).includes(value);
}
