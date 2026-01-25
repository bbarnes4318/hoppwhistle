'use client';

/**
 * Project Cortex | Dayparting Indicator
 *
 * Shows hours of operation with green/red dot for open/closed status.
 */

import { Clock } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { HoursOfOperation } from '@/types/target';

interface DaypartingIndicatorProps {
  hoursOfOperation: HoursOfOperation;
  timezone: string;
  isOpen: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayNamesShort = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function DaypartingIndicator({
  hoursOfOperation,
  timezone,
  isOpen,
  size = 'md',
  className,
}: DaypartingIndicatorProps) {
  const { daysOfWeek, startTime, endTime } = hoursOfOperation;

  // Format time for display
  const formatTime = (time: string) => {
    const [hour, min] = time.split(':').map(Number);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    return `${hour12}:${min.toString().padStart(2, '0')} ${ampm}`;
  };

  // Get timezone abbreviation
  const tzAbbr = timezone.includes('New_York')
    ? 'EST'
    : timezone.includes('Los_Angeles')
      ? 'PST'
      : timezone.includes('Chicago')
        ? 'CST'
        : 'UTC';

  // Format day range
  const formatDayRange = () => {
    if (daysOfWeek.length === 7) return 'Every Day';
    if (daysOfWeek.length === 5 && !daysOfWeek.includes(0) && !daysOfWeek.includes(6)) {
      return 'Mon-Fri';
    }
    return daysOfWeek.map(d => dayNames[d]).join(', ');
  };

  return (
    <div className={cn('flex items-center gap-3', className)}>
      {/* Open/Closed Indicator */}
      <div className="flex items-center gap-2">
        <div
          className={cn(
            'w-2 h-2 rounded-full',
            isOpen
              ? 'bg-status-success animate-pulse shadow-[0_0_6px_rgba(0,208,132,0.5)]'
              : 'bg-status-error'
          )}
        />
        <span
          className={cn(
            'font-mono text-xs font-semibold uppercase',
            isOpen ? 'text-status-success' : 'text-status-error'
          )}
        >
          {isOpen ? 'OPEN NOW' : 'CLOSED'}
        </span>
      </div>

      {/* Hours Display */}
      {size === 'md' && (
        <div className="flex items-center gap-2 text-text-muted">
          <Clock className="h-3 w-3" />
          <span className="font-mono text-xs">
            {formatDayRange()} {formatTime(startTime)} - {formatTime(endTime)} {tzAbbr}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Day selector for editing hours
 */
export function DaySelector({
  selected,
  onChange,
  className,
}: {
  selected: number[];
  onChange: (days: number[]) => void;
  className?: string;
}) {
  const toggleDay = (day: number) => {
    if (selected.includes(day)) {
      onChange(selected.filter(d => d !== day));
    } else {
      onChange([...selected, day].sort());
    }
  };

  return (
    <div className={cn('flex items-center gap-1', className)}>
      {dayNamesShort.map((name, index) => (
        <button
          key={index}
          onClick={() => toggleDay(index)}
          className={cn(
            'w-8 h-8 rounded-md font-mono text-xs font-semibold transition-all',
            selected.includes(index)
              ? 'bg-neon-cyan text-void'
              : 'bg-panel border border-white/10 text-text-muted hover:text-text-primary hover:border-white/20'
          )}
        >
          {name}
        </button>
      ))}
    </div>
  );
}

export default DaypartingIndicator;
