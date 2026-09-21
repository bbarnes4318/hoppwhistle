/**
 * Whether an agent is inside their working hours.
 *
 * ── The gap ──────────────────────────────────────────────────────────────────
 *
 * `AgencyProfile` carried delivery days and hours for the WHOLE agency, and
 * routing knew nothing about hours at all. An agency running two shifts could
 * not express it, so an agent who finished at 2pm kept being rung at 7pm: the
 * call reached a phone nobody was sitting at and was not offered to the agent
 * who was.
 *
 * ── The two properties that must not break ───────────────────────────────────
 *
 *   1. ABSENCE IS NOT A CONSTRAINT. Every agent starts with no schedule, and
 *      answering "not working" for them would take the whole platform off the
 *      queue the moment this shipped. No schedule, an unresolvable timezone, a
 *      malformed time: all "working". Only a schedule that positively excludes
 *      the current moment excludes an agent.
 *
 *   2. OVERNIGHT SHIFTS WORK. A window stored 21:00-05:00 spans two calendar
 *      days, and `days` names the day it STARTS on. The half a naive
 *      implementation drops is the early-hours half, which silences every
 *      night-shift agent between midnight and their end time.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { agencyClock, isWithinSchedule, parseTime } from '../services/telephony/agent-schedule.js';

const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI'];

/* ── Parsing ───────────────────────────────────────────────────────────────── */

describe('parseTime', () => {
  it('reads a 24-hour time as minutes since midnight', () => {
    expect(parseTime('00:00')).toBe(0);
    expect(parseTime('09:30')).toBe(570);
    expect(parseTime('23:59')).toBe(1439);
    expect(parseTime('9:05')).toBe(545);
  });

  it('refuses anything that is not a time', () => {
    expect(parseTime('24:00')).toBeNull();
    expect(parseTime('09:60')).toBeNull();
    expect(parseTime('9am')).toBeNull();
    expect(parseTime('')).toBeNull();
  });
});

/* ── The agency clock ──────────────────────────────────────────────────────── */

describe('agencyClock', () => {
  it('reports the agencys local day and time, not UTC', () => {
    // 01:30 UTC on Tuesday is 21:30 MONDAY in New York. An implementation that
    // read UTC would put this agent on the wrong day entirely.
    const clock = agencyClock('America/New_York', new Date('2026-09-22T01:30:00Z'));
    expect(clock).toEqual({ day: 'MON', minutes: 21 * 60 + 30 });
  });

  it('follows daylight saving rather than a fixed offset', () => {
    // Same wall-clock hour, opposite sides of the DST boundary: 14:00 UTC is
    // 10:00 EDT in September and 09:00 EST in January.
    const summer = agencyClock('America/New_York', new Date('2026-09-21T14:00:00Z'));
    const winter = agencyClock('America/New_York', new Date('2026-01-21T14:00:00Z'));
    expect(summer?.minutes).toBe(10 * 60);
    expect(winter?.minutes).toBe(9 * 60);
  });

  it('reads local midnight as 0, not 1440', () => {
    /*
     * `hour12: false` yields '24' for midnight in some ICU versions. Unhandled
     * that is 1440 minutes — past every end time — and an agency's whole night
     * shift reads as off-hours for one hour a day.
     */
    const clock = agencyClock('America/New_York', new Date('2026-09-21T04:00:00Z'));
    expect(clock?.minutes).toBe(0);
    expect(clock?.day).toBe('MON');
  });

  it('answers null for a zone it cannot resolve', () => {
    // Which callers read as "cannot tell", and therefore "do not filter".
    expect(agencyClock('Not/AZone', new Date())).toBeNull();
  });
});

/* ── Absence is not a constraint ───────────────────────────────────────────── */

describe('an agent with no schedule', () => {
  it('is working', () => {
    /*
     * THE property. Every agent starts here, and answering false would silence
     * an entire platform the moment this shipped.
     */
    expect(isWithinSchedule(null, { day: 'SUN', minutes: 3 * 60 })).toBe(true);
    expect(isWithinSchedule(undefined, { day: 'SUN', minutes: 3 * 60 })).toBe(true);
  });
});

describe('when the moment cannot be established', () => {
  it('is working', () => {
    const nine2five = { days: WEEKDAYS, startTime: '09:00', endTime: '17:00' };
    // An unresolvable agency timezone must not silence its agents.
    expect(isWithinSchedule(nine2five, null)).toBe(true);
  });
});

describe('an unreadable schedule', () => {
  it('does not restrict', () => {
    // A typo in a form weeks ago must not read as an outage today.
    expect(
      isWithinSchedule(
        { days: WEEKDAYS, startTime: 'nine', endTime: '17:00' },
        { day: 'WED', minutes: 20 * 60 }
      )
    ).toBe(true);
  });
});

/* ── An ordinary day shift ─────────────────────────────────────────────────── */

describe('a 09:00-17:00 weekday shift', () => {
  const shift = { days: WEEKDAYS, startTime: '09:00', endTime: '17:00' };

  it('is working inside the window on a working day', () => {
    expect(isWithinSchedule(shift, { day: 'WED', minutes: 9 * 60 })).toBe(true);
    expect(isWithinSchedule(shift, { day: 'WED', minutes: 13 * 60 })).toBe(true);
    expect(isWithinSchedule(shift, { day: 'WED', minutes: 16 * 60 + 59 })).toBe(true);
  });

  it('is not working before it starts or after it ends', () => {
    expect(isWithinSchedule(shift, { day: 'WED', minutes: 8 * 60 + 59 })).toBe(false);
    // This is the defect: an agent who finished at 17:00 being rung at 19:00.
    expect(isWithinSchedule(shift, { day: 'WED', minutes: 19 * 60 })).toBe(false);
  });

  it('treats the end as exclusive', () => {
    // An inclusive end keeps ringing an agent for the minute after they
    // finished — the small version of the defect this gate exists to close.
    expect(isWithinSchedule(shift, { day: 'WED', minutes: 17 * 60 })).toBe(false);
  });

  it('is not working on a day they do not work', () => {
    expect(isWithinSchedule(shift, { day: 'SAT', minutes: 13 * 60 })).toBe(false);
    expect(isWithinSchedule(shift, { day: 'SUN', minutes: 13 * 60 })).toBe(false);
  });
});

/* ── Two shifts, which is the point ────────────────────────────────────────── */

describe('two shifts on one agency', () => {
  const morning = { days: WEEKDAYS, startTime: '06:00', endTime: '14:00' };
  const evening = { days: WEEKDAYS, startTime: '14:00', endTime: '22:00' };

  it('puts a 19:00 call on the evening agent and not the morning one', () => {
    const at7pm = { day: 'TUE', minutes: 19 * 60 };
    expect(isWithinSchedule(morning, at7pm)).toBe(false);
    expect(isWithinSchedule(evening, at7pm)).toBe(true);
  });

  it('hands over cleanly at the boundary, with no overlap and no gap', () => {
    const at2pm = { day: 'TUE', minutes: 14 * 60 };
    // Exactly one of them is on: an exclusive end and an inclusive start.
    expect(isWithinSchedule(morning, at2pm)).toBe(false);
    expect(isWithinSchedule(evening, at2pm)).toBe(true);
  });
});

/* ── Overnight ─────────────────────────────────────────────────────────────── */

describe('an overnight 21:00-05:00 shift', () => {
  // `days` names the day the shift STARTS on.
  const nights = { days: ['FRI', 'SAT'], startTime: '21:00', endTime: '05:00' };

  it('is working late on a day they start', () => {
    expect(isWithinSchedule(nights, { day: 'FRI', minutes: 22 * 60 })).toBe(true);
  });

  it('is working in the early hours of the day AFTER one they start', () => {
    /*
     * The half a naive implementation drops. Without it every night-shift agent
     * is silenced between midnight and their end time — the busiest part of
     * their shift.
     */
    expect(isWithinSchedule(nights, { day: 'SAT', minutes: 2 * 60 })).toBe(true);
    expect(isWithinSchedule(nights, { day: 'SUN', minutes: 2 * 60 })).toBe(true);
  });

  it('is not working in the middle of the day', () => {
    expect(isWithinSchedule(nights, { day: 'SAT', minutes: 13 * 60 })).toBe(false);
  });

  it('is not working after the shift ends', () => {
    expect(isWithinSchedule(nights, { day: 'SAT', minutes: 5 * 60 })).toBe(false);
    expect(isWithinSchedule(nights, { day: 'SAT', minutes: 8 * 60 })).toBe(false);
  });

  it('is not working on a night they do not start', () => {
    // Monday night is not theirs, nor is Tuesday morning.
    expect(isWithinSchedule(nights, { day: 'MON', minutes: 22 * 60 })).toBe(false);
    expect(isWithinSchedule(nights, { day: 'TUE', minutes: 2 * 60 })).toBe(false);
  });

  it('wraps from Sunday night into Monday morning', () => {
    const sundayNights = { days: ['SUN'], startTime: '21:00', endTime: '05:00' };
    // The week boundary, where an off-by-one in the day table would show.
    expect(isWithinSchedule(sundayNights, { day: 'MON', minutes: 2 * 60 })).toBe(true);
    expect(isWithinSchedule(sundayNights, { day: 'SAT', minutes: 2 * 60 })).toBe(false);
  });
});

/* ── Leave, and round-the-clock ────────────────────────────────────────────── */

describe('an empty day list', () => {
  it('is NOT working, unlike having no schedule at all', () => {
    /*
     * An agent on leave. Somebody typed this deliberately, so unlike an absent
     * row it does restrict — the two are different facts and the gate treats
     * them differently.
     */
    const onLeave = { days: [], startTime: '09:00', endTime: '17:00' };
    expect(isWithinSchedule(onLeave, { day: 'WED', minutes: 13 * 60 })).toBe(false);
  });
});

describe('a window whose ends meet', () => {
  it('is a 24-hour day on the days it names', () => {
    const allDay = { days: ['SAT'], startTime: '00:00', endTime: '00:00' };
    expect(isWithinSchedule(allDay, { day: 'SAT', minutes: 3 * 60 })).toBe(true);
    expect(isWithinSchedule(allDay, { day: 'SAT', minutes: 23 * 60 })).toBe(true);
    expect(isWithinSchedule(allDay, { day: 'SUN', minutes: 12 * 60 })).toBe(false);
  });
});

describe('day keys', () => {
  it('are read case- and whitespace-insensitively', () => {
    const shift = { days: [' mon ', 'Tue'], startTime: '09:00', endTime: '17:00' };
    expect(isWithinSchedule(shift, { day: 'MON', minutes: 10 * 60 })).toBe(true);
    expect(isWithinSchedule(shift, { day: 'TUE', minutes: 10 * 60 })).toBe(true);
    expect(isWithinSchedule(shift, { day: 'WED', minutes: 10 * 60 })).toBe(false);
  });
});
