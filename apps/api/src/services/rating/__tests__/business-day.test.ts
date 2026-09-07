import { describe, it, expect } from 'vitest';

import {
  RATING_TIME_ZONE,
  businessDayBounds,
  businessDayOf,
  lastClosedBusinessDay,
  nextBusinessDay,
  previousBusinessDay,
  trailingWindow,
} from '../business-day.js';

/**
 * The business day is the timezone assumption the whole rating engine rests on,
 * so it is pinned here rather than left to be discovered in a billing dispute.
 *
 * The cases that matter are the ones where a naive implementation is wrong:
 * the evening hours when UTC has already rolled over to tomorrow, and the two
 * days a year the offset changes.
 */
describe('business day', () => {
  it('reckons days in America/New_York, not UTC', () => {
    expect(RATING_TIME_ZONE).toBe('America/New_York');

    // 2026-09-08T02:30:00Z is 22:30 on the 7th in New York (EDT, UTC-4).
    // `toISOString().slice(0,10)` would say the 8th, and would move every
    // application submitted after 8pm Eastern onto the following day.
    expect(businessDayOf(new Date('2026-09-08T02:30:00Z'))).toBe('2026-09-07');
  });

  it('ends the day at 23:59:59.999 Eastern', () => {
    // 03:59:59.999Z on the 8th is 23:59:59.999 on the 7th (EDT).
    expect(businessDayOf(new Date('2026-09-08T03:59:59.999Z'))).toBe('2026-09-07');
    // One millisecond later is the next business day.
    expect(businessDayOf(new Date('2026-09-08T04:00:00.000Z'))).toBe('2026-09-08');
  });

  it('bounds a day as a half-open instant range', () => {
    const { start, endExclusive } = businessDayBounds('2026-09-07');
    expect(start.toISOString()).toBe('2026-09-07T04:00:00.000Z');
    expect(endExclusive.toISOString()).toBe('2026-09-08T04:00:00.000Z');
  });

  it('bounds a winter day at the standard-time offset', () => {
    // EST is UTC-5, so a January day starts at 05:00Z rather than 04:00Z. A
    // fixed offset would put every winter day four hours out.
    const { start, endExclusive } = businessDayBounds('2027-01-15');
    expect(start.toISOString()).toBe('2027-01-15T05:00:00.000Z');
    expect(endExclusive.toISOString()).toBe('2027-01-16T05:00:00.000Z');
  });

  it('handles the spring-forward day, which is 23 hours long', () => {
    // 2026-03-08: clocks jump 02:00 -> 03:00 EST->EDT.
    const { start, endExclusive } = businessDayBounds('2026-03-08');
    expect(start.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(endExclusive.toISOString()).toBe('2026-03-09T04:00:00.000Z');
    expect(endExclusive.getTime() - start.getTime()).toBe(23 * 60 * 60 * 1000);
  });

  it('handles the fall-back day, which is 25 hours long', () => {
    // 2026-11-01: clocks fall 02:00 -> 01:00 EDT->EST.
    const { start, endExclusive } = businessDayBounds('2026-11-01');
    expect(start.toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(endExclusive.toISOString()).toBe('2026-11-02T05:00:00.000Z');
    expect(endExclusive.getTime() - start.getTime()).toBe(25 * 60 * 60 * 1000);
  });

  it('walks days across a DST boundary without skipping or repeating one', () => {
    expect(nextBusinessDay('2026-03-07')).toBe('2026-03-08');
    expect(nextBusinessDay('2026-03-08')).toBe('2026-03-09');
    expect(previousBusinessDay('2026-11-02')).toBe('2026-11-01');
    expect(previousBusinessDay('2026-11-01')).toBe('2026-10-31');
  });

  it('walks days across a month and a year boundary', () => {
    expect(nextBusinessDay('2026-09-30')).toBe('2026-10-01');
    expect(nextBusinessDay('2026-12-31')).toBe('2027-01-01');
    expect(previousBusinessDay('2027-01-01')).toBe('2026-12-31');
    // 2028 is a leap year.
    expect(nextBusinessDay('2028-02-28')).toBe('2028-02-29');
  });

  it('builds a trailing window of consecutive days, oldest first', () => {
    const window = trailingWindow('2026-09-07', 3);
    expect(window.dayKeys).toEqual(['2026-09-05', '2026-09-06', '2026-09-07']);
    expect(window.start.toISOString()).toBe('2026-09-05T04:00:00.000Z');
    expect(window.endExclusive.toISOString()).toBe('2026-09-08T04:00:00.000Z');
  });

  it('honours a configured window length other than three', () => {
    expect(trailingWindow('2026-09-07', 1).dayKeys).toEqual(['2026-09-07']);
    expect(trailingWindow('2026-09-07', 5).dayKeys).toHaveLength(5);
  });

  it('refuses a nonsensical window length rather than guessing', () => {
    expect(() => trailingWindow('2026-09-07', 0)).toThrow(/positive whole number/);
    expect(() => trailingWindow('2026-09-07', -3)).toThrow(/positive whole number/);
    expect(() => trailingWindow('2026-09-07', 2.5)).toThrow(/positive whole number/);
  });

  it('refuses a malformed day key rather than producing an Invalid Date', () => {
    expect(() => businessDayBounds('2026-9-7')).toThrow(/YYYY-MM-DD/);
    expect(() => businessDayBounds('yesterday')).toThrow(/YYYY-MM-DD/);
  });

  it('closes the day that has actually ended, from the Eastern clock', () => {
    // 00:05 Eastern on the 8th: the 7th has closed.
    expect(lastClosedBusinessDay(new Date('2026-09-08T04:05:00Z'))).toBe('2026-09-07');
    // 23:00 Eastern on the 7th: the 7th is still open, so the 6th is the last
    // closed day. A run scheduled in UTC that fired "at midnight" would
    // otherwise rate a day that still had an hour left in it.
    expect(lastClosedBusinessDay(new Date('2026-09-08T03:00:00Z'))).toBe('2026-09-06');
  });
});
