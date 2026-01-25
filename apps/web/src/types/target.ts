/**
 * Project Cortex | Target Types
 *
 * Data models for Buyer Endpoints (Targets).
 */

export type TargetStatus = 'active' | 'paused' | 'capped';
export type DestinationType = 'sip' | 'pstn';

export interface HoursOfOperation {
  daysOfWeek: number[]; // 0=Sun, 1=Mon, ..., 6=Sat
  startTime: string; // "08:00"
  endTime: string; // "20:00"
}

export interface Target {
  id: string;

  // Identity
  buyerName: string; // "Mutual of Omaha"
  targetName: string; // "Call Center A - FE"
  vertical: string; // "final-expense"

  // Connectivity
  destinationType: DestinationType;
  destinationNumber: string; // "+18005551234" or "sip:user@domain.com"

  // Global Constraints
  concurrencyCap: number; // Max simultaneous calls
  currentConcurrency: number; // Live active calls
  dailyCap: number; // Max conversions per day
  dailyUsed: number; // Today's conversions
  hourlyCap?: number; // Optional hourly limit
  hourlyUsed?: number;

  // Hours of Operation
  timezone: string; // "America/New_York"
  hoursOfOperation: HoursOfOperation;

  // Status
  status: TargetStatus;
  isPaused: boolean;

  // Stats
  todayCalls: number;
  todayRevenue: number;
  avgHandleTime: number;

  // Metadata
  createdAt: string;
  updatedAt: string;
}

/**
 * Check if target is currently open based on hours of operation
 */
export function isTargetOpen(target: Target, currentTime?: Date): boolean {
  const now = currentTime || new Date();

  // Get current day (0-6) and time in target's timezone
  // For simplicity, we'll use local time here
  const currentDay = now.getDay();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const currentTimeMinutes = currentHour * 60 + currentMinute;

  const { daysOfWeek, startTime, endTime } = target.hoursOfOperation;

  // Check if today is an operating day
  if (!daysOfWeek.includes(currentDay)) {
    return false;
  }

  // Parse start/end times
  const [startHour, startMin] = startTime.split(':').map(Number);
  const [endHour, endMin] = endTime.split(':').map(Number);
  const startMinutes = startHour * 60 + startMin;
  const endMinutes = endHour * 60 + endMin;

  return currentTimeMinutes >= startMinutes && currentTimeMinutes < endMinutes;
}

/**
 * Get capacity utilization percentage
 */
export function getCapacityPercent(used: number, cap: number): number {
  if (cap === 0) return 0;
  return Math.min(100, (used / cap) * 100);
}

/**
 * Get capacity status color
 */
export function getCapacityColor(percent: number): 'cyan' | 'lime' | 'error' {
  if (percent >= 100) return 'error';
  if (percent >= 80) return 'lime';
  return 'cyan';
}

/**
 * Format phone number for display
 */
export function formatTargetNumber(number: string): string {
  if (number.startsWith('sip:')) {
    return number;
  }

  // Format PSTN number
  const cleaned = number.replace(/\D/g, '');
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return `+1 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
  }
  return number;
}
