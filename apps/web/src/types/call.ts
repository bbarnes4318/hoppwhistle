/**
 * Project Cortex | Call Record Types
 *
 * Master schema for call records with full data fields.
 * Used by the Call Log DataGrid with column visibility controls.
 */

// ============================================================================
// CALL RECORD — MASTER SCHEMA
// ============================================================================

export type CallStatus =
  | 'ringing'
  | 'connected'
  | 'buffering'
  | 'billable'
  | 'completed'
  | 'failed'
  | 'missed'
  | 'no_answer';

export interface CallRecord {
  // Core ID
  id: string;

  // -------------------------------------------------------------------------
  // IDs — Entity References
  // -------------------------------------------------------------------------
  campaignId: string;
  campaignName: string;
  publisherId: string;
  publisherName: string;
  targetId: string;
  targetName: string;
  buyerId: string;
  buyerName: string;

  // -------------------------------------------------------------------------
  // Times — Call Lifecycle
  // -------------------------------------------------------------------------
  callDate: Date; // When call was initiated
  connectedTime: Date | null; // When call was answered
  completeTime: Date | null; // When call ended

  // -------------------------------------------------------------------------
  // Duration & Thresholds
  // -------------------------------------------------------------------------
  duration: number; // In seconds
  bufferThreshold: number; // Seconds required for billable

  // -------------------------------------------------------------------------
  // Phone Numbers
  // -------------------------------------------------------------------------
  callerId: string; // Caller's phone number
  callerName?: string; // Caller name if available
  targetNumber: string; // Target/buyer number dialed
  inboundDid: string; // DID that received the call

  // -------------------------------------------------------------------------
  // Vertical / Category
  // -------------------------------------------------------------------------
  vertical: string;
  verticalCategory?: string;

  // -------------------------------------------------------------------------
  // Finance — Money Fields
  // -------------------------------------------------------------------------
  revenue: number; // What buyer pays (gross revenue)
  payout: number; // What publisher earns (cost to us)
  profit: number; // revenue - payout (net yield)
  cost: number; // Additional costs (carrier, etc.)

  // -------------------------------------------------------------------------
  // Logic Flags
  // -------------------------------------------------------------------------
  converted: boolean; // CPA conversion occurred
  missedCall: boolean; // Call was missed/unanswered
  isDuplicate: boolean; // Duplicate caller detected
  blocked: boolean; // Call was blocked by filters

  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------
  status: CallStatus;
  isBillable: boolean; // duration >= bufferThreshold
  isLive: boolean; // Call currently active

  // -------------------------------------------------------------------------
  // Meta — Reasons & URLs
  // -------------------------------------------------------------------------
  noPayoutReason: string | null; // Why payout was denied
  blockReason: string | null; // Why call was blocked
  recordingUrl: string | null; // URL to call recording

  // -------------------------------------------------------------------------
  // Timestamps (ISO strings for display)
  // -------------------------------------------------------------------------
  timestamp: string; // Display timestamp (HH:mm:ss)
  createdAt: string; // ISO date string
  updatedAt: string; // ISO date string
}

// ============================================================================
// COLUMN DEFINITIONS — For DataGrid
// ============================================================================

export interface ColumnDefinition {
  key: keyof CallRecord;
  label: string;
  category: 'default' | 'ids' | 'times' | 'finance' | 'logic' | 'meta';
  defaultVisible: boolean;
  width?: number;
  align?: 'left' | 'center' | 'right';
  format?: 'text' | 'number' | 'currency' | 'date' | 'time' | 'boolean' | 'phone' | 'url';
}

/**
 * ALL available columns for the Call Log DataGrid.
 * Organized by category for the column picker.
 */
export const CALL_LOG_COLUMNS: ColumnDefinition[] = [
  // DEFAULT VIEW (10 columns)
  { key: 'callDate', label: 'Date', category: 'default', defaultVisible: true, format: 'date' },
  { key: 'campaignName', label: 'Campaign', category: 'default', defaultVisible: true },
  { key: 'buyerName', label: 'Buyer', category: 'default', defaultVisible: true },
  { key: 'publisherName', label: 'Pub', category: 'default', defaultVisible: true },
  { key: 'targetName', label: 'Target', category: 'default', defaultVisible: true },
  {
    key: 'callerId',
    label: 'CallerID',
    category: 'default',
    defaultVisible: true,
    format: 'phone',
  },
  {
    key: 'duration',
    label: 'Duration',
    category: 'default',
    defaultVisible: true,
    format: 'time',
    align: 'right',
  },
  {
    key: 'revenue',
    label: 'Rev',
    category: 'default',
    defaultVisible: true,
    format: 'currency',
    align: 'right',
  },
  {
    key: 'payout',
    label: 'Payout',
    category: 'default',
    defaultVisible: true,
    format: 'currency',
    align: 'right',
  },
  {
    key: 'recordingUrl',
    label: 'Recording',
    category: 'default',
    defaultVisible: true,
    format: 'url',
    align: 'center',
  },

  // IDs (hidden by default)
  { key: 'id', label: 'Call ID', category: 'ids', defaultVisible: false },
  { key: 'campaignId', label: 'Campaign ID', category: 'ids', defaultVisible: false },
  { key: 'publisherId', label: 'Publisher ID', category: 'ids', defaultVisible: false },
  { key: 'targetId', label: 'Target ID', category: 'ids', defaultVisible: false },
  { key: 'buyerId', label: 'Buyer ID', category: 'ids', defaultVisible: false },

  // TIMES (hidden by default)
  {
    key: 'connectedTime',
    label: 'Connected Time',
    category: 'times',
    defaultVisible: false,
    format: 'time',
  },
  {
    key: 'completeTime',
    label: 'Complete Time',
    category: 'times',
    defaultVisible: false,
    format: 'time',
  },
  { key: 'timestamp', label: 'Time', category: 'times', defaultVisible: false },

  // FINANCE (hidden by default except defaults above)
  {
    key: 'profit',
    label: 'Profit',
    category: 'finance',
    defaultVisible: false,
    format: 'currency',
    align: 'right',
  },
  {
    key: 'cost',
    label: 'Cost',
    category: 'finance',
    defaultVisible: false,
    format: 'currency',
    align: 'right',
  },

  // LOGIC FLAGS (hidden by default)
  {
    key: 'converted',
    label: 'Converted',
    category: 'logic',
    defaultVisible: false,
    format: 'boolean',
    align: 'center',
  },
  {
    key: 'missedCall',
    label: 'Missed',
    category: 'logic',
    defaultVisible: false,
    format: 'boolean',
    align: 'center',
  },
  {
    key: 'isDuplicate',
    label: 'Duplicate',
    category: 'logic',
    defaultVisible: false,
    format: 'boolean',
    align: 'center',
  },
  {
    key: 'blocked',
    label: 'Blocked',
    category: 'logic',
    defaultVisible: false,
    format: 'boolean',
    align: 'center',
  },
  {
    key: 'isBillable',
    label: 'Billable',
    category: 'logic',
    defaultVisible: false,
    format: 'boolean',
    align: 'center',
  },

  // META (hidden by default)
  { key: 'status', label: 'Status', category: 'meta', defaultVisible: false },
  { key: 'vertical', label: 'Vertical', category: 'meta', defaultVisible: false },
  { key: 'noPayoutReason', label: 'No Payout Reason', category: 'meta', defaultVisible: false },
  { key: 'blockReason', label: 'Block Reason', category: 'meta', defaultVisible: false },
  {
    key: 'inboundDid',
    label: 'Inbound DID',
    category: 'meta',
    defaultVisible: false,
    format: 'phone',
  },
  {
    key: 'targetNumber',
    label: 'Target Number',
    category: 'meta',
    defaultVisible: false,
    format: 'phone',
  },
];

/**
 * Get default visible columns
 */
export function getDefaultVisibleColumns(): string[] {
  return CALL_LOG_COLUMNS.filter(col => col.defaultVisible).map(col => col.key);
}

/**
 * Get columns by category
 */
export function getColumnsByCategory(category: ColumnDefinition['category']): ColumnDefinition[] {
  return CALL_LOG_COLUMNS.filter(col => col.category === category);
}

// ============================================================================
// LOCALSTORAGE KEY
// ============================================================================

export const CALL_LOG_COLUMNS_STORAGE_KEY = 'hopwhistle_call_log_columns';
