import { describe, it, expect } from 'vitest';

import {
  PLATFORM_TIME_ZONE,
  calendarDayBounds,
  calendarDayOf,
  dayOfWeek,
  lastClosedCalendarDay,
  nextCalendarDay,
  previousCalendarDay,
  windowOf,
} from '../calendar-day.js';

/**
 * The calendar day is the timezone assumption everything else rests on -- the
 * rating window, the contractual Business Day, the day an application is
 * attributed to -- so it is pinned here rather than left to be discovered in a
 * billing dispute.
 *
 * The cases that matter are the ones where a naive implementation is wrong: the
 * evening hours when UTC has already rolled over to tomorrow, and the two days
 * a year the offset changes.
 */
describe('calendar day', () => {
  it('reckons days in America/New_York, not UTC', () => {
    expect(PLATFORM_TIME_ZONE).toBe('America/New_York');

    // 2026-09-08T02:30:00Z is 22:30 on the 7th in New York (EDT, UTC-4).
    // `toISOString().slice(0,10)` would say the 8th, and would move every
    // application submitted after 8pm Eastern onto the following day.
    expect(calendarDayOf(new Date('2026-09-08T02:30:00Z'))).toBe('2026-09-07');
  });

  it('ends the day at 23:59:59.999 Eastern', () => {
    // 03:59:59.999Z on the 8th is 23:59:59.999 on the 7th (EDT).
    expect(calendarDayOf(new Date('2026-09-08T03:59:59.999Z'))).toBe('2026-09-07');
    // One millisecond later is the next business day.
    expect(calendarDayOf(new Date('2026-09-08T04:00:00.000Z'))).toBe('2026-09-08');
  });

  it('bounds a day as a half-open instant range', () => {
    const { start, endExclusive } = calendarDayBounds('2026-09-07');
    expect(start.toISOString()).toBe('2026-09-07T04:00:00.000Z');
    expect(endExclusive.toISOString()).toBe('2026-09-08T04:00:00.000Z');
  });

  it('bounds a winter day at the standard-time offset', () => {
    // EST is UTC-5, so a January day starts at 05:00Z rather than 04:00Z. A
    // fixed offset would put every winter day four hours out.
    const { start, endExclusive } = calendarDayBounds('2027-01-15');
    expect(start.toISOString()).toBe('2027-01-15T05:00:00.000Z');
    expect(endExclusive.toISOString()).toBe('2027-01-16T05:00:00.000Z');
  });

  it('handles the spring-forward day, which is 23 hours long', () => {
    // 2026-03-08: clocks jump 02:00 -> 03:00 EST->EDT.
    const { start, endExclusive } = calendarDayBounds('2026-03-08');
    expect(start.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(endExclusive.toISOString()).toBe('2026-03-09T04:00:00.000Z');
    expect(endExclusive.getTime() - start.getTime()).toBe(23 * 60 * 60 * 1000);
  });

  it('handles the fall-back day, which is 25 hours long', () => {
    // 2026-11-01: clocks fall 02:00 -> 01:00 EDT->EST.
    const { start, endExclusive } = calendarDayBounds('2026-11-01');
    expect(start.toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(endExclusive.toISOString()).toBe('2026-11-02T05:00:00.000Z');
    expect(endExclusive.getTime() - start.getTime()).toBe(25 * 60 * 60 * 1000);
  });

  it('walks days across a DST boundary without skipping or repeating one', () => {
    expect(nextCalendarDay('2026-03-07')).toBe('2026-03-08');
    expect(nextCalendarDay('2026-03-08')).toBe('2026-03-09');
    expect(previousCalendarDay('2026-11-02')).toBe('2026-11-01');
    expect(previousCalendarDay('2026-11-01')).toBe('2026-10-31');
  });

  it('walks days across a month and a year boundary', () => {
    expect(nextCalendarDay('2026-09-30')).toBe('2026-10-01');
    expect(nextCalendarDay('2026-12-31')).toBe('2027-01-01');
    expect(previousCalendarDay('2027-01-01')).toBe('2026-12-31');
    // 2028 is a leap year.
    expect(nextCalendarDay('2028-02-28')).toBe('2028-02-29');
  });

  it('bounds a set of days, sorted, oldest first', () => {
    const window = windowOf(['2026-09-07', '2026-09-05', '2026-09-06']);
    expect(window.dayKeys).toEqual(['2026-09-05', '2026-09-06', '2026-09-07']);
    expect(window.start.toISOString()).toBe('2026-09-05T04:00:00.000Z');
    expect(window.endExclusive.toISOString()).toBe('2026-09-08T04:00:00.000Z');
  });

  it('spans the gap in a non-contiguous window, and says so by construction', () => {
    // A Delivery Day window for a weekday-only agency: Thursday, Friday,
    // Monday. The instants span the weekend even though the days do not, which
    // is why anything counting over such a window must count per day and sum.
    const window = windowOf(['2026-09-03', '2026-09-04', '2026-09-07']);
    expect(window.dayKeys).toEqual(['2026-09-03', '2026-09-04', '2026-09-07']);
    expect(window.start.toISOString()).toBe('2026-09-03T04:00:00.000Z');
    expect(window.endExclusive.toISOString()).toBe('2026-09-08T04:00:00.000Z');
    // Five calendar days of span for three days of counts.
    const spanDays =
      (window.endExclusive.getTime() - window.start.getTime()) / (24 * 3600_000);
    expect(spanDays).toBe(5);
  });

  it('refuses an empty window rather than returning a nonsense range', () => {
    expect(() => windowOf([])).toThrow(/at least one day/);
  });

  it('names the weekday of a day, with no timezone in the answer', () => {
    // 2026-09-07 is a Monday; 2026-09-05 a Saturday; 2026-09-06 a Sunday.
    expect(dayOfWeek('2026-09-07')).toBe(1);
    expect(dayOfWeek('2026-09-05')).toBe(6);
    expect(dayOfWeek('2026-09-06')).toBe(0);
    // Across a DST transition, where going via an instant invites an
    // off-by-one: 2026-03-08 is a Sunday, 2026-11-01 a Sunday.
    expect(dayOfWeek('2026-03-08')).toBe(0);
    expect(dayOfWeek('2026-11-01')).toBe(0);
  });

  it('refuses a malformed day key rather than producing an Invalid Date', () => {
    expect(() => calendarDayBounds('2026-9-7')).toThrow(/YYYY-MM-DD/);
    expect(() => calendarDayBounds('yesterday')).toThrow(/YYYY-MM-DD/);
  });

  it('closes the day that has actually ended, from the Eastern clock', () => {
    // 00:05 Eastern on the 8th: the 7th has closed.
    expect(lastClosedCalendarDay(new Date('2026-09-08T04:05:00Z'))).toBe('2026-09-07');
    // 23:00 Eastern on the 7th: the 7th is still open, so the 6th is the last
    // closed day. A run scheduled in UTC that fired "at midnight" would
    // otherwise rate a day that still had an hour left in it.
    expect(lastClosedCalendarDay(new Date('2026-09-08T03:00:00Z'))).toBe('2026-09-06');
  });
});
