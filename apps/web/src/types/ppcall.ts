/**
 * Project Cortex | Pay Per Call Domain Types
 *
 * Core types for the PPCall Arbitrage Platform.
 * The Spread = Buyer Payout - Publisher Cost
 */

// ============================================================================
// VERTICALS
// ============================================================================

export type VerticalCategory = 'insurance' | 'legal' | 'home_services' | 'dme';

export interface Vertical {
  id: string;
  name: string;
  shortName: string;
  category: VerticalCategory;
  color: 'cyan' | 'violet' | 'lime' | 'mint';
  icon: string;
  avgPayout: number;
  avgDuration: number;
}

// ============================================================================
// BUYERS (TARGETS / ADVERTISERS)
// ============================================================================

export interface Buyer {
  id: string;
  name: string;
  verticals: string[];

  // Capacity
  concurrencyCap: number; // Max simultaneous calls
  dailyCap: number; // Max calls per day
  currentConcurrency: number; // Active calls right now

  // Revenue (What buyer pays us)
  payoutCPL: number; // Per billable call (duration met)
  payoutCPA: number; // Per conversion event
  bufferSeconds: number; // Duration threshold for CPL

  // Status
  isActive: boolean;
  isPaused: boolean;

  // Stats
  todayCalls: number;
  todayRevenue: number;
  todayConversions: number;
}

// ============================================================================
// PUBLISHERS (AFFILIATES / TRAFFIC SOURCES)
// ============================================================================

export interface Publisher {
  id: string;
  name: string;
  verticals: string[];

  // Cost (What we pay publisher)
  costCPL: number; // Per billable call
  costCPA: number; // Per conversion

  // Status
  isActive: boolean;

  // Stats
  todayCalls: number;
  todayCost: number;
}

// ============================================================================
// CALL SESSIONS
// ============================================================================

export type CallStatus =
  | 'ringing' // Call initiated, not yet answered
  | 'connected' // Call in progress
  | 'buffering' // Connected, counting down to billable
  | 'billable' // Buffer threshold met - MONEY MADE
  | 'converted' // CPA event received
  | 'completed' // Call ended
  | 'failed' // Call failed
  | 'no_answer'; // No answer

export interface CallSession {
  id: string;

  // Routing
  publisherId: string;
  publisherName: string;
  buyerId: string;
  buyerName: string;
  vertical: string;

  // Phone numbers
  callerNumber: string;
  targetNumber: string;

  // Timing
  startTime: Date;
  answerTime?: Date;
  endTime?: Date;
  duration: number; // Current duration in seconds
  bufferThreshold: number; // Seconds required for billable
  bufferRemaining: number; // Countdown to billable

  // Status
  status: CallStatus;
  isBillable: boolean; // duration >= bufferThreshold
  isConverted: boolean; // CPA event received

  // Financials
  buyerPayout: number; // What buyer pays (revenue)
  publisherCost: number; // What we pay publisher (cost)
  netYield: number; // buyerPayout - publisherCost (profit)

  // Conversion
  conversionType?: 'sale' | 'appointment' | 'qualified' | 'pixel';
  conversionValue?: number;
}

// ============================================================================
// CAMPAIGN / OFFER
// ============================================================================

export interface Campaign {
  id: string;
  name: string;
  vertical: string;

  // Routing
  buyers: string[];
  publishers: string[];

  // Payouts
  defaultPayoutCPL: number;
  defaultPayoutCPA: number;
  defaultCostCPL: number;
  defaultCostCPA: number;
  bufferSeconds: number;

  // Caps
  dailyCap: number;
  hourlyCap: number;
  concurrencyCap: number;

  // Status
  isActive: boolean;

  // Stats
  todayCalls: number;
  todayRevenue: number;
  todayCost: number;
  todayYield: number;
  conversionRate: number;
}

// ============================================================================
// DASHBOARD METRICS
// ============================================================================

export interface DashboardMetrics {
  // Real-time
  activeCalls: number;
  todayCalls: number;

  // Revenue
  grossRevenue: number; // Total from buyers
  publisherCost: number; // Total to publishers
  netYield: number; // Gross - Cost (The Spread)
  marginPercent: number; // (Yield / Gross) * 100

  // Performance
  billableRate: number; // % of calls that became billable
  conversionRate: number; // % of calls that converted
  avgDuration: number;
  avgPayout: number;

  // By Vertical
  byVertical: {
    vertical: string;
    calls: number;
    revenue: number;
    cost: number;
    yield: number;
  }[];
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Calculate net yield (The Spread)
 */
export function calculateYield(buyerPayout: number, publisherCost: number): number {
  return buyerPayout - publisherCost;
}

/**
 * Calculate margin percentage
 */
export function calculateMargin(buyerPayout: number, publisherCost: number): number {
  if (buyerPayout === 0) return 0;
  return ((buyerPayout - publisherCost) / buyerPayout) * 100;
}

/**
 * Check if call is billable based on duration
 */
export function isBillable(duration: number, bufferThreshold: number): boolean {
  return duration >= bufferThreshold;
}

/**
 * Get remaining buffer time
 */
export function getBufferRemaining(duration: number, bufferThreshold: number): number {
  const remaining = bufferThreshold - duration;
  return remaining > 0 ? remaining : 0;
}
