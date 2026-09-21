/**
 * Whether an agent is inside their working hours right now.
 *
 * ── The gap this fills ───────────────────────────────────────────────────────
 *
 * `AgencyProfile` carries delivery days and hours for the WHOLE agency, and
 * routing knew nothing about hours at all: it gated on licence, SIP
 * registration and concurrency and nothing else. An agency running two shifts
 * could not express it, so an agent who finished at 2pm kept being rung at 7pm
 * -- the call reached a phone nobody was sitting at, and was not offered to the
 * agent who was.
 *
 * ── Absence is not a constraint ──────────────────────────────────────────────
 *
 * `isWithinSchedule` answers `true` for an agent with NO schedule. Every agent
 * starts without one, and answering `false` would take an entire platform off
 * the queue the moment this shipped. The same posture the licence gate takes,
 * for the same reason: enforce what you have been told, never invent a
 * constraint from the absence of data.
 *
 * An EMPTY `days` list is different and does restrict: it is an agent on leave,
 * which somebody typed deliberately.
 *
 * ── One clock, and it is the agency's ────────────────────────────────────────
 *
 * Times are `HH:MM` in the agency's `deliveryTimeZone`, exactly as the agency's
 * own window is stored. "Is it Tuesday at 14:30 for this agency" is asked once,
 * through `Intl`, and every agent in that agency is evaluated against the same
 * answer -- so a shift cannot land on a different day for two agents in one
 * agency, and DST is handled by the platform rather than by arithmetic here.
 */

import { logger } from '../../lib/logger.js';

/** `MON`..`SUN`, indexed by `Intl`'s short weekday name. */
const DAY_KEYS: Record<string, string> = {
  Mon: 'MON',
  Tue: 'TUE',
  Wed: 'WED',
  Thu: 'THU',
  Fri: 'FRI',
  Sat: 'SAT',
  Sun: 'SUN',
};

export interface AgentScheduleWindow {
  days: string[];
  startTime: string;
  endTime: string;
}

/** The agency's local day key and minute-of-day, at one instant. */
export interface LocalClock {
  /** `MON`..`SUN`. */
  day: string;
  /** Minutes since local midnight. */
  minutes: number;
}

/** `HH:MM` to minutes since midnight, or null when it is not a time. */
export function parseTime(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * What day and time it is for an agency.
 *
 * Asked once per routing decision and shared by every agent in it. Returns null
 * when the zone cannot be resolved, which callers must read as "cannot tell"
 * and therefore "do not filter".
 */
export function agencyClock(timeZone: string, now: Date = new Date()): LocalClock | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);

    const weekday = parts.find(p => p.type === 'weekday')?.value ?? '';
    const hour = parts.find(p => p.type === 'hour')?.value ?? '';
    const minute = parts.find(p => p.type === 'minute')?.value ?? '';

    const day = DAY_KEYS[weekday];
    if (!day) return null;

    /*
     * `hour12: false` yields '24' for midnight in some ICU versions rather than
     * '00'. Left unhandled that is 1440 minutes -- past every end time -- and
     * an agency's whole night shift would read as off-hours for one hour a day.
     */
    const hours = Number(hour) % 24;
    const minutes = Number(minute);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;

    return { day, minutes: hours * 60 + minutes };
  } catch (error) {
    logger.warn({
      msg: 'Agent-schedule: could not resolve the agency time zone; not enforcing hours',
      timeZone,
      error: (error as Error).message,
    });
    return null;
  }
}

/** The day key before a given one, for reading into an overnight shift. */
const PREVIOUS_DAY: Record<string, string> = {
  MON: 'SUN',
  TUE: 'MON',
  WED: 'TUE',
  THU: 'WED',
  FRI: 'THU',
  SAT: 'FRI',
  SUN: 'SAT',
};

/**
 * Is this agent working, at this agency-local moment?
 *
 * @param schedule The agent's schedule, or null when they have none.
 * @param clock    The agency's local day and time, or null when unresolved.
 */
export function isWithinSchedule(
  schedule: AgentScheduleWindow | null | undefined,
  clock: LocalClock | null
): boolean {
  // No schedule: not restricted. See the header.
  if (!schedule) return true;

  // Cannot tell what time it is: not restricted, for the same reason.
  if (!clock) return true;

  const start = parseTime(schedule.startTime);
  const end = parseTime(schedule.endTime);

  /*
   * A malformed schedule does not restrict. A row that cannot be read is a
   * data fault, and silencing an agent over one would be an outage caused by
   * a typo somebody made in a form weeks ago.
   */
  if (start === null || end === null) {
    logger.warn({
      msg: 'Agent-schedule: unreadable times; not enforcing this schedule',
      startTime: schedule.startTime,
      endTime: schedule.endTime,
    });
    return true;
  }

  const days = new Set(schedule.days.map(d => d.trim().toUpperCase()));

  /*
   * A same-day window: on one of their days, between start and end.
   *
   * `end` is EXCLUSIVE. A shift stored as 09:00-17:00 ends at 17:00, and an
   * inclusive end would keep ringing an agent for the minute after they
   * finished -- which is the small version of the exact defect this gate
   * exists to close.
   */
  if (start < end) {
    return days.has(clock.day) && clock.minutes >= start && clock.minutes < end;
  }

  /*
   * An overnight window, stored with start after end: 21:00 to 05:00.
   *
   * It spans two calendar days, and `days` names the day the shift STARTS on.
   * So an agent is working either late on one of their days, or early on the
   * day after one of their days -- and the second half is the one a naive
   * implementation drops, silencing every night-shift agent between midnight
   * and their end time.
   *
   * `start === end` falls here too and is treated as a 24-hour day, which is
   * the only sensible reading of a window whose ends meet.
   */
  if (start === end) return days.has(clock.day);

  const lateOnAWorkingDay = days.has(clock.day) && clock.minutes >= start;
  const earlyAfterAWorkingDay = days.has(PREVIOUS_DAY[clock.day] ?? '') && clock.minutes < end;

  return lateOnAWorkingDay || earlyAfterAWorkingDay;
}
