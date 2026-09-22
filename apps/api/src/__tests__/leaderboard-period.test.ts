/**
 * The periods the leaderboard is read over.
 *
 * ── What is being protected ──────────────────────────────────────────────────
 *
 * Two things, and both of them are the kind that fail silently.
 *
 *   1. THE CLOCK. Every other range picker in this product computes its dates
 *      in the browser's timezone. An agent in Los Angeles opening the board at
 *      21:30 is already on tomorrow in New York, and a board that resolved
 *      "Today" locally would ask the server for a day the server does not think
 *      is today -- and get a correct, empty answer. So these assertions pin the
 *      resolution to `PLATFORM_TIME_ZONE` by driving it with instants either
 *      side of midnight in New York.
 *
 *   2. THE UNIT. The previous period of a month is the month before, not "the
 *      same number of days, immediately before". The 28 days before a 31-day
 *      March are February minus its last day, and a month-on-month comparison
 *      that quietly drops days is one nobody can check.
 */

import { describe, expect, it } from 'vitest';

import {
  daysBetween,
  previousPeriodOf,
  resolvePeriod,
  PeriodError,
} from '../services/leaderboard/period.js';

/** 2026-09-22 is a Tuesday. 16:00 UTC is 12:00 in New York (EDT). */
const TUESDAY_MIDDAY = new Date('2026-09-22T16:00:00.000Z');

describe('the platform clock, not the browser one', () => {
  it('resolves TODAY in New York, not UTC', () => {
    /*
     * 01:30 UTC on the 23rd is 21:30 on the 22nd in New York. UTC says the
     * 23rd; the platform says the 22nd, and the platform is what every figure
     * on the board is attributed by.
     */
    const lateEvening = new Date('2026-09-23T01:30:00.000Z');
    const period = resolvePeriod('TODAY', { now: lateEvening });

    expect(period.from).toBe('2026-09-22');
    expect(period.to).toBe('2026-09-22');
  });

  it('spans one day from its first instant to the next day s first instant', () => {
    const period = resolvePeriod('TODAY', { now: TUESDAY_MIDDAY });

    // Midnight in New York on an EDT date is 04:00 UTC.
    expect(period.start.toISOString()).toBe('2026-09-22T04:00:00.000Z');
    expect(period.endExclusive.toISOString()).toBe('2026-09-23T04:00:00.000Z');
  });
});

describe('the named periods', () => {
  it('YESTERDAY is the single day before today', () => {
    const period = resolvePeriod('YESTERDAY', { now: TUESDAY_MIDDAY });
    expect([period.from, period.to, period.days]).toEqual(['2026-09-21', '2026-09-21', 1]);
  });

  it('THIS_WEEK starts on Sunday and ends TODAY, never on Saturday', () => {
    const period = resolvePeriod('THIS_WEEK', { now: TUESDAY_MIDDAY });

    // Sunday the 20th through Tuesday the 22nd: three days, not seven. Running
    // the week to its own last day would put four days that have not happened
    // into every per-day figure derived from the span.
    expect([period.from, period.to, period.days]).toEqual(['2026-09-20', '2026-09-22', 3]);
  });

  it('LAST_WEEK is the whole Sunday-to-Saturday week before it', () => {
    const period = resolvePeriod('LAST_WEEK', { now: TUESDAY_MIDDAY });
    expect([period.from, period.to, period.days]).toEqual(['2026-09-13', '2026-09-19', 7]);
  });

  it('THIS_MONTH runs from the 1st to today', () => {
    const period = resolvePeriod('THIS_MONTH', { now: TUESDAY_MIDDAY });
    expect([period.from, period.to, period.days]).toEqual(['2026-09-01', '2026-09-22', 22]);
  });

  it('LAST_MONTH is the whole previous month, to its own last day', () => {
    const period = resolvePeriod('LAST_MONTH', { now: TUESDAY_MIDDAY });
    expect([period.from, period.to, period.days]).toEqual(['2026-08-01', '2026-08-31', 31]);
  });

  it('knows how long February is, in a leap year and out of one', () => {
    const march2028 = resolvePeriod('LAST_MONTH', { now: new Date('2028-03-15T16:00:00.000Z') });
    expect(march2028.to).toBe('2028-02-29');

    const march2027 = resolvePeriod('LAST_MONTH', { now: new Date('2027-03-15T16:00:00.000Z') });
    expect(march2027.to).toBe('2027-02-28');
  });

  it('THIS_YEAR runs from January 1st to today', () => {
    const period = resolvePeriod('THIS_YEAR', { now: TUESDAY_MIDDAY });
    expect([period.from, period.to]).toEqual(['2026-01-01', '2026-09-22']);
  });

  it('LAST_YEAR is the whole previous year', () => {
    const period = resolvePeriod('LAST_YEAR', { now: TUESDAY_MIDDAY });
    expect([period.from, period.to, period.days]).toEqual(['2025-01-01', '2025-12-31', 365]);
  });
});

describe('the custom range', () => {
  it('takes the days it is given', () => {
    const period = resolvePeriod('CUSTOM', {
      now: TUESDAY_MIDDAY,
      from: '2026-03-01',
      to: '2026-03-31',
    });
    expect([period.from, period.to, period.days]).toEqual(['2026-03-01', '2026-03-31', 31]);
  });

  it('refuses a reversed range rather than swapping it', () => {
    // Quietly answering for the days they did not ask for hides a caller bug,
    // on a screen people compare each other's numbers on.
    expect(() =>
      resolvePeriod('CUSTOM', { now: TUESDAY_MIDDAY, from: '2026-03-31', to: '2026-03-01' })
    ).toThrow(PeriodError);
  });

  it('refuses anything that is not a calendar day key', () => {
    expect(() =>
      resolvePeriod('CUSTOM', { now: TUESDAY_MIDDAY, from: 'last tuesday', to: '2026-03-01' })
    ).toThrow(PeriodError);
    expect(() => resolvePeriod('CUSTOM', { now: TUESDAY_MIDDAY, from: '2026-03-01' })).toThrow(
      PeriodError
    );
  });
});

describe('open and closed', () => {
  /*
   * The whole board branches on this. A period still running is compared
   * against a whole one, so a signed change in totals always reads as a fall
   * -- a number that is arithmetically correct and says nothing but what time
   * it is. Rank survives the comparison; totals do not.
   */
  it('marks a period still running as open', () => {
    expect(resolvePeriod('TODAY', { now: TUESDAY_MIDDAY }).complete).toBe(false);
    expect(resolvePeriod('THIS_WEEK', { now: TUESDAY_MIDDAY }).complete).toBe(false);
    expect(resolvePeriod('THIS_MONTH', { now: TUESDAY_MIDDAY }).complete).toBe(false);
    expect(resolvePeriod('THIS_YEAR', { now: TUESDAY_MIDDAY }).complete).toBe(false);
  });

  it('marks a period whose last day is behind us as closed', () => {
    expect(resolvePeriod('YESTERDAY', { now: TUESDAY_MIDDAY }).complete).toBe(true);
    expect(resolvePeriod('LAST_WEEK', { now: TUESDAY_MIDDAY }).complete).toBe(true);
    expect(resolvePeriod('LAST_MONTH', { now: TUESDAY_MIDDAY }).complete).toBe(true);
    expect(resolvePeriod('LAST_YEAR', { now: TUESDAY_MIDDAY }).complete).toBe(true);
  });

  it('marks a custom range ending today or later as open', () => {
    const throughToday = resolvePeriod('CUSTOM', {
      now: TUESDAY_MIDDAY,
      from: '2026-09-01',
      to: '2026-09-22',
    });
    expect(throughToday.complete).toBe(false);

    const past = resolvePeriod('CUSTOM', {
      now: TUESDAY_MIDDAY,
      from: '2026-09-01',
      to: '2026-09-21',
    });
    expect(past.complete).toBe(true);
  });
});

describe('the period it is read against', () => {
  it('steps back by the unit, not by the day count', () => {
    const now = TUESDAY_MIDDAY;

    // THIS_WEEK covers three days here; its previous period is a whole week.
    const week = previousPeriodOf(resolvePeriod('THIS_WEEK', { now }), { now });
    expect([week.from, week.to]).toEqual(['2026-09-13', '2026-09-19']);

    // THIS_MONTH covers 22 days; its previous period is the whole of August,
    // which is 31 -- NOT the 22 days before September 1st.
    const month = previousPeriodOf(resolvePeriod('THIS_MONTH', { now }), { now });
    expect([month.from, month.to]).toEqual(['2026-08-01', '2026-08-31']);

    const year = previousPeriodOf(resolvePeriod('THIS_YEAR', { now }), { now });
    expect([year.from, year.to]).toEqual(['2025-01-01', '2025-12-31']);
  });

  it('steps a closed period back by its own unit too', () => {
    const now = TUESDAY_MIDDAY;

    expect(previousPeriodOf(resolvePeriod('YESTERDAY', { now }), { now }).from).toBe('2026-09-20');

    const beforeLastWeek = previousPeriodOf(resolvePeriod('LAST_WEEK', { now }), { now });
    expect([beforeLastWeek.from, beforeLastWeek.to]).toEqual(['2026-09-06', '2026-09-12']);

    const beforeLastMonth = previousPeriodOf(resolvePeriod('LAST_MONTH', { now }), { now });
    expect([beforeLastMonth.from, beforeLastMonth.to]).toEqual(['2026-07-01', '2026-07-31']);

    const beforeLastYear = previousPeriodOf(resolvePeriod('LAST_YEAR', { now }), { now });
    expect([beforeLastYear.from, beforeLastYear.to]).toEqual(['2024-01-01', '2024-12-31']);
  });

  it('gives a custom range the equal-length span ending the day before it', () => {
    const now = TUESDAY_MIDDAY;
    const custom = resolvePeriod('CUSTOM', { now, from: '2026-09-15', to: '2026-09-21' });
    const previous = previousPeriodOf(custom, { now });

    // Seven days, immediately before, because a custom range has no unit to
    // step back by.
    expect([previous.from, previous.to, previous.days]).toEqual(['2026-09-08', '2026-09-14', 7]);
  });
});

describe('daysBetween', () => {
  it('counts inclusively and survives a DST transition', () => {
    expect(daysBetween('2026-09-22', '2026-09-22')).toBe(1);
    expect(daysBetween('2026-09-20', '2026-09-26')).toBe(7);

    // US DST ends on 2026-11-01. A day count derived from instants rather than
    // from the labels would report 7.04 days here and round wrong.
    expect(daysBetween('2026-10-29', '2026-11-04')).toBe(7);
  });
});
