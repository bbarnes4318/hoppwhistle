/**
 * The call ledger's pure pieces: which columns exist, who may see each and
 * which are on by default, how a billing or return status reads, when a row
 * has a recording to play, and what an export is called.
 *
 * Kept out of `page.tsx` so each can be tested without mounting the page, and
 * so the header, the cells and the column picker read one list instead of
 * repeating a role check three times per column.
 */
import { formatEnumLabel, resolveTone, type StatusTone } from '@/components/domain/status-tones';

// ── Columns ──────────────────────────────────────────────────────────────────

export type CallColumnId =
  | 'time'
  | 'callerId'
  | 'campaignName'
  | 'answeredBy'
  | 'publisherName'
  | 'buyerName'
  | 'did'
  | 'toNumber'
  | 'duration'
  | 'connectedDuration'
  | 'disposition'
  | 'application'
  | 'dispositionNotes'
  | 'billable'
  | 'revenue'
  | 'payout'
  | 'cost'
  | 'profit'
  | 'margin'
  | 'status'
  | 'dispute'
  | 'recording';

/** Who is looking, as far as the ledger's columns care. */
export interface CallsViewer {
  isAgent: boolean;
  isAdminOrOwner: boolean;
  isBuyer: boolean;
  isPublisher: boolean;
}

export interface CallColumn {
  id: CallColumnId;
  label: string;
  align?: 'right' | 'center';
  canSee: (viewer: CallsViewer) => boolean;
}

const everyone = () => true;

/** Every column, in the order the table shows them. */
export const CALL_COLUMNS: readonly CallColumn[] = [
  { id: 'time', label: 'Time', canSee: everyone },
  { id: 'callerId', label: 'Caller', canSee: everyone },
  { id: 'campaignName', label: 'Campaign', canSee: everyone },
  // An agent's list is their own calls, so "who answered" is always them.
  { id: 'answeredBy', label: 'Answered by', canSee: v => !v.isAgent },
  { id: 'publisherName', label: 'Publisher', canSee: v => v.isAdminOrOwner },
  { id: 'buyerName', label: 'Buyer', canSee: v => v.isAdminOrOwner },
  { id: 'did', label: 'DID', canSee: v => !v.isBuyer },
  { id: 'toNumber', label: 'Destination', canSee: v => !v.isPublisher },
  { id: 'duration', label: 'Duration', canSee: everyone },
  { id: 'connectedDuration', label: 'Connected', canSee: everyone },
  { id: 'disposition', label: 'Disposition', canSee: everyone },
  // The agency's own business: not the buyer's or the publisher's to read.
  { id: 'application', label: 'Application', canSee: v => !v.isBuyer && !v.isPublisher },
  { id: 'dispositionNotes', label: 'Notes', canSee: everyone },
  { id: 'billable', label: 'Billable', canSee: everyone },
  { id: 'revenue', label: 'Revenue', align: 'right', canSee: v => !v.isPublisher && !v.isAgent },
  { id: 'payout', label: 'Payout', align: 'right', canSee: v => !v.isBuyer && !v.isAgent },
  { id: 'cost', label: 'Cost', align: 'right', canSee: v => v.isAdminOrOwner },
  { id: 'profit', label: 'Profit', align: 'right', canSee: v => v.isAdminOrOwner },
  { id: 'margin', label: 'Margin', align: 'right', canSee: v => v.isAdminOrOwner },
  { id: 'status', label: 'Status', align: 'center', canSee: v => !v.isAgent },
  { id: 'dispute', label: 'Return', canSee: v => !v.isAgent },
  { id: 'recording', label: 'Recording', align: 'center', canSee: everyone },
];

/**
 * Which set of defaults a viewer starts from. An agent reads the ledger as
 * their own day's calls; everyone else reads it as the agency's book.
 */
export type CallColumnRole = 'owner' | 'agent';

export function columnRoleOf(viewer: CallsViewer): CallColumnRole {
  return viewer.isAgent && !viewer.isAdminOrOwner ? 'agent' : 'owner';
}

/**
 * The owner's first read of a call: when, who called, on what, who took it,
 * how long, how it ended, what it made and paid, and whether it was returned.
 * Everything else is in the column picker, off until asked for.
 */
export const OWNER_DEFAULT_COLUMNS: readonly CallColumnId[] = [
  'time',
  'callerId',
  'campaignName',
  'answeredBy',
  'duration',
  'disposition',
  'revenue',
  'payout',
  'dispute',
];

/** An agent's: their calls, how each ended, and which became an application. */
export const AGENT_DEFAULT_COLUMNS: readonly CallColumnId[] = [
  'time',
  'callerId',
  'campaignName',
  'duration',
  'disposition',
  'application',
];

export function defaultVisibleColumns(role: CallColumnRole): Record<CallColumnId, boolean> {
  const on = new Set(role === 'agent' ? AGENT_DEFAULT_COLUMNS : OWNER_DEFAULT_COLUMNS);
  return Object.fromEntries(CALL_COLUMNS.map(col => [col.id, on.has(col.id)])) as Record<
    CallColumnId,
    boolean
  >;
}

/** The columns a viewer may choose from, in table order. */
export function visibleColumnsFor(viewer: CallsViewer): CallColumn[] {
  return CALL_COLUMNS.filter(col => col.canSee(viewer));
}

/**
 * Where a viewer's column choices are kept. Per role, and versioned: the
 * defaults changed when the ledger was reshaped around the columns above, and
 * a choice stored against the old column set (under the old unversioned key)
 * would otherwise keep a returning owner on the old table indefinitely.
 */
export function columnStorageKey(role: CallColumnRole): string {
  return `hopwhistle_calls_columns:v2:${role}`;
}

// ── Status badges ────────────────────────────────────────────────────────────

/** A status as a chip reads it: the words, and the tone from the status-tone system. */
export interface StatusBadge {
  value: string;
  label: string;
  tone: StatusTone;
}

/** An unknown value still renders, humanised, on its by-name tone. */
function fallbackBadge(value: string): StatusBadge {
  return { value, label: formatEnumLabel(value), tone: resolveTone(value) };
}

/**
 * A buyer return, as the ledger names it. `disputeStatus` is the column the
 * returns flow writes: DISPUTED while the buyer's request is open, then
 * ACCEPTED or DENIED once the agency decides (`apps/api/src/lib/dispute-status.ts`).
 */
const DISPUTE_BADGES: Record<string, Omit<StatusBadge, 'value'>> = {
  // Waiting on the agency's decision.
  DISPUTED: { label: 'Return requested', tone: 'ringing' },
  // The charge came back off the call.
  ACCEPTED: { label: 'Return accepted', tone: 'dropped' },
  // Decided, and the charge stands.
  DENIED: { label: 'Return denied', tone: 'neutral' },
};

export function disputeBadge(status?: string | null): StatusBadge | null {
  if (!status) return null;
  const value = status.toUpperCase();
  const known = DISPUTE_BADGES[value];
  return known ? { value, ...known } : fallbackBadge(value);
}

/** What the buyer was charged for the call. */
const CHARGE_BADGES: Record<string, Omit<StatusBadge, 'value'>> = {
  PENDING: { label: 'Pending', tone: 'ringing' },
  INVOICED: { label: 'Invoiced', tone: 'ringing' },
  CHARGED: { label: 'Charged', tone: 'money' },
  // A return accepted after the charge: the money went back.
  REFUNDED: { label: 'Refunded', tone: 'dropped' },
  // Let go on purpose. A decision, not a failure.
  WAIVED: { label: 'Waived', tone: 'neutral' },
  NOT_BILLABLE: { label: 'Not billable', tone: 'neutral' },
};

/** Null for a call with no charge status: nothing is rendered, not "Pending". */
export function chargeStatusBadge(status?: string | null): StatusBadge | null {
  if (!status) return null;
  const value = status.toUpperCase();
  const known = CHARGE_BADGES[value];
  return known ? { value, ...known } : fallbackBadge(value);
}

/** What the publisher is owed for the call. */
const PAYOUT_BADGES: Record<string, Omit<StatusBadge, 'value'>> = {
  PENDING: { label: 'Pending', tone: 'ringing' },
  PAYABLE: { label: 'Payable', tone: 'ringing' },
  PAID: { label: 'Paid', tone: 'money' },
  HELD: { label: 'Held', tone: 'blocked' },
  NOT_PAYABLE: { label: 'Not payable', tone: 'neutral' },
  // Returned after it was paid, and deducted from the publisher's next payment.
  CLAWED_BACK: { label: 'Clawed back', tone: resolveTone('CLAWED_BACK') },
};

/** Null for a call with no payout status: nothing is rendered, not "Pending". */
export function payoutStatusBadge(status?: string | null): StatusBadge | null {
  if (!status) return null;
  const value = status.toUpperCase();
  const known = PAYOUT_BADGES[value];
  return known ? { value, ...known } : fallbackBadge(value);
}

// ── Filters ──────────────────────────────────────────────────────────────────

/** The select's "no filter" value; Radix Select cannot hold an empty string. */
export const ALL_RETURNS = 'all';

/**
 * The Returns filter, as `GET /api/v1/calls` reads `disputeStatus`: NONE is
 * no return ever requested, DISPUTED the open ones, ACCEPTED and DENIED the
 * decided ones, and ANY every call a return was ever requested on.
 */
export const DISPUTE_FILTER_OPTIONS: readonly { value: string; label: string }[] = [
  { value: 'NONE', label: 'None' },
  { value: 'DISPUTED', label: 'Open' },
  { value: 'ACCEPTED', label: 'Accepted' },
  { value: 'DENIED', label: 'Denied' },
  { value: 'ANY', label: 'Any' },
];

// ── Rows ─────────────────────────────────────────────────────────────────────

/**
 * The recording a row's play and download buttons act on, or null for none.
 *
 * Only `primaryRecordingId`. A call id is not a recording id, and falling
 * back to one sent `/recordings/<call id>/url` to the server, which answered
 * with an error the operator read as a broken recording.
 */
export function recordingIdOf(call: { primaryRecordingId?: string | null }): string | null {
  return call.primaryRecordingId || null;
}

/**
 * Who took the call: the agent who answered it, or else the buyer it was
 * sold to. Null when neither is recorded.
 */
export function answeredByOf(call: {
  agentName?: string | null;
  buyerName?: string | null;
}): { name: string; kind: 'agent' | 'buyer' } | null {
  if (call.agentName) return { name: call.agentName, kind: 'agent' };
  // "Masked" is the API withholding the buyer's name, not a name.
  if (call.buyerName && call.buyerName !== 'Masked') return { name: call.buyerName, kind: 'buyer' };
  return null;
}

// ── Dates and export ─────────────────────────────────────────────────────────

/** A local calendar date as `YYYY-MM-DD`, without the UTC shift of toISOString. */
export function localDayKey(at: Date): string {
  const month = String(at.getMonth() + 1).padStart(2, '0');
  const day = String(at.getDate()).padStart(2, '0');
  return `${at.getFullYear()}-${month}-${day}`;
}

/**
 * The export's file name, from the date range the ledger is showing:
 * `calls-<from>-<to>.csv`. All time is `calls-all.csv`; an open end of a
 * custom range reads `start` or `end`.
 */
export function exportFilename(range: { from: string; to: string }): string {
  if (!range.from && !range.to) return 'calls-all.csv';
  return `calls-${range.from || 'start'}-${range.to || 'end'}.csv`;
}
