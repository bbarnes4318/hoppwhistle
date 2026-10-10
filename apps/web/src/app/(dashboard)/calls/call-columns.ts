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
  | 'direction'
  | 'callerId'
  | 'campaignName'
  | 'wentTo'
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
  /*
   * Inbound or outbound. The agency's and the agent's: a buyer or publisher
   * only ever sees inbound traffic, so for them the column says nothing.
   */
  { id: 'direction', label: 'Direction', canSee: v => !v.isBuyer && !v.isPublisher },
  { id: 'callerId', label: 'Caller', canSee: everyone },
  { id: 'campaignName', label: 'Campaign', canSee: everyone },
  /*
   * Where the call went, as an entity badge: one of your agents, a buyer,
   * nobody, or a gate. Agents and buyers told apart at a glance, which the
   * old "Answered by" name alone never did. An agent's list is their own
   * calls, so it is always them.
   */
  { id: 'wentTo', label: 'Went to', canSee: v => !v.isAgent },
  { id: 'answeredBy', label: 'Answered by', canSee: v => !v.isAgent },
  { id: 'publisherName', label: 'Publisher', canSee: v => v.isAdminOrOwner },
  { id: 'buyerName', label: 'Buyer', canSee: v => v.isAdminOrOwner },
  { id: 'did', label: 'DID', canSee: v => !v.isBuyer },
  // Where the call was sent. The API withholds it from an agent, so a column
  // of it would only ever be empty.
  { id: 'toNumber', label: 'Destination', canSee: v => !v.isPublisher && !v.isAgent },
  { id: 'duration', label: 'Duration', align: 'right', canSee: everyone },
  { id: 'connectedDuration', label: 'Connected', align: 'right', canSee: everyone },
  // Carries the return's status as a second chip: there is no Return column.
  { id: 'disposition', label: 'Disposition', canSee: everyone },
  // The agency's own business: not the buyer's or the publisher's to read.
  { id: 'application', label: 'Application', canSee: v => !v.isBuyer && !v.isPublisher },
  { id: 'dispositionNotes', label: 'Notes', canSee: everyone },
  // Whether the buyer is charged for it: the agency's billing, not the agent's.
  { id: 'billable', label: 'Billable', canSee: v => !v.isAgent },
  { id: 'recording', label: 'Recording', align: 'center', canSee: everyone },
  { id: 'revenue', label: 'Revenue', align: 'right', canSee: v => !v.isPublisher && !v.isAgent },
  { id: 'payout', label: 'Payout', align: 'right', canSee: v => !v.isBuyer && !v.isAgent },
  { id: 'cost', label: 'Cost', align: 'right', canSee: v => v.isAdminOrOwner },
  { id: 'profit', label: 'Profit', align: 'right', canSee: v => v.isAdminOrOwner },
  { id: 'margin', label: 'Margin', align: 'right', canSee: v => v.isAdminOrOwner },
  { id: 'status', label: 'Status', align: 'center', canSee: v => !v.isAgent },
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
  'direction',
  'callerId',
  'campaignName',
  'wentTo',
  'duration',
  'disposition',
  'recording',
  'revenue',
  'payout',
  'profit',
];

/**
 * An agent's: their calls, how each ended, the recording of each, and which
 * became an application.
 */
export const AGENT_DEFAULT_COLUMNS: readonly CallColumnId[] = [
  'time',
  'direction',
  'callerId',
  'campaignName',
  'duration',
  'disposition',
  'recording',
  'application',
];

/**
 * Columns a role cannot switch off.
 *
 * An agent's recordings are how they review a call, and how a floor manager
 * expects them to. The column used to be off by default for an agent and
 * toggleable, so most agents never knew their calls were recorded. It is
 * always on for them now: forced over any layout saved in the browser before
 * this, and offered in the picker as checked and disabled. The server narrows
 * which recordings play -- an agent's own answered calls only
 * (`checkRecordingAccess` in apps/api/src/routes/recordings.ts).
 */
export const LOCKED_COLUMNS: Record<CallColumnRole, readonly CallColumnId[]> = {
  owner: [],
  agent: ['recording'],
};

export function defaultVisibleColumns(role: CallColumnRole): Record<CallColumnId, boolean> {
  const on = new Set(role === 'agent' ? AGENT_DEFAULT_COLUMNS : OWNER_DEFAULT_COLUMNS);
  return Object.fromEntries(CALL_COLUMNS.map(col => [col.id, on.has(col.id)])) as Record<
    CallColumnId,
    boolean
  >;
}

/** A visibility map with the role's locked columns forced on. */
export function withLockedColumns(
  role: CallColumnRole,
  visible: Record<string, boolean>
): Record<string, boolean> {
  const locked = LOCKED_COLUMNS[role];
  if (locked.length === 0) return visible;
  return { ...visible, ...Object.fromEntries(locked.map(id => [id, true])) };
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
  // v4: "Direction" joined the defaults for both roles.
  return `hopwhistle_calls_columns:v4:${role}`;
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

/**
 * A call's direction as the Direction column reads it. Null when the row
 * carries none, rendered as a dash rather than a guess.
 */
export function directionOf(call: {
  direction?: string | null;
}): { value: 'INBOUND' | 'OUTBOUND'; label: string } | null {
  const value = call.direction?.toUpperCase();
  if (value === 'INBOUND') return { value, label: 'Inbound' };
  if (value === 'OUTBOUND') return { value, label: 'Outbound' };
  return null;
}

/**
 * Where the call went, for the "Went to" badge: blocked, one of your agents,
 * a buyer, or nobody. The order Today's chart counts them in, so the two
 * never disagree about the same call.
 */
export function wentToOf(call: {
  blocked?: boolean | null;
  answeredByUserId?: string | null;
  agentName?: string | null;
  buyerId?: string | null;
  buyerName?: string | null;
}): { kind: 'agent' | 'buyer' | 'unanswered' | 'blocked'; name: string | null } {
  if (call.blocked) return { kind: 'blocked', name: null };
  if (call.answeredByUserId || call.agentName)
    return { kind: 'agent', name: call.agentName ?? null };
  if (call.buyerId || (call.buyerName && call.buyerName !== 'Masked')) {
    return {
      kind: 'buyer',
      name: call.buyerName && call.buyerName !== 'Masked' ? call.buyerName : null,
    };
  }
  return { kind: 'unanswered', name: null };
}

/**
 * A return, as the small second chip in the Disposition cell: waiting on the
 * agency, accepted (the charge came off) or denied (it stands).
 */
const RETURN_CHIPS: Record<string, Omit<StatusBadge, 'value'>> = {
  DISPUTED: { label: 'Return: waiting', tone: 'ringing' },
  ACCEPTED: { label: 'Return: accepted', tone: 'dropped' },
  DENIED: { label: 'Return: denied', tone: 'neutral' },
};

export function returnChip(status?: string | null): StatusBadge | null {
  if (!status) return null;
  const value = status.toUpperCase();
  const known = RETURN_CHIPS[value];
  return known
    ? { value, ...known }
    : { value, label: `Return: ${formatEnumLabel(value).toLowerCase()}`, tone: resolveTone(value) };
}

/** A disposition's chip tone: a sale is good news, a callback is pending, a dead line failed. */
const DISPOSITION_TONES: Record<string, StatusTone> = {
  APPLICATION_SUBMITTED: 'live',
  VERIFIED: 'live',
  LIVE_TRANSFER: 'live',
  SET_APPOINTMENT: 'ringing',
  SET_CALLBACK: 'ringing',
  FOLLOW_UP: 'ringing',
  NO_ANSWER: 'dropped',
  DISCONNECTED: 'dropped',
  WRONG_NUMBER: 'dropped',
};

export function dispositionTone(value: string): StatusTone {
  return DISPOSITION_TONES[value.toUpperCase()] ?? 'neutral';
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
