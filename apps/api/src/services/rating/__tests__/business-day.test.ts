import { describe, it, expect } from 'vitest';

import {
  CONTRACT_PERIODS,
  addBusinessDays,
  businessDayPeriodEnd,
  businessDaysBetween,
  isBusinessDay,
  nextBusinessDay,
  usFederalHolidays,
} from '../business-day.js';

/**
 * The Business Day, which is the contractual unit and NOT the rating window.
 *
 * Every case here is one where reading "business day" as "calendar day" gives a
 * different, always earlier, answer. That is why the term was split: an earlier
 * deadline is not an error message, it is just an earlier date, and nobody
 * would notice the agency losing two days of a right it was granted in writing.
 */
describe('business day', () => {
  describe('which days count', () => {
    it('counts Monday to Friday', () => {
      // 2026-09-07 Mon .. 2026-09-11 Fri
      for (const day of ['2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11']) {
        expect(isBusinessDay(day), `${day} should be a Business Day`).toBe(true);
      }
    });

    it('does not count Saturday or Sunday', () => {
      expect(isBusinessDay('2026-09-05')).toBe(false); // Saturday
      expect(isBusinessDay('2026-09-06')).toBe(false); // Sunday
    });

    it('does not count a federal holiday', () => {
      // 2026-09-07 is Labor Day, the first Monday in September.
      expect(isBusinessDay('2026-09-07')).toBe(false);
      // 2026-01-01 New Year's Day, a Thursday.
      expect(isBusinessDay('2026-01-01')).toBe(false);
      // 2026-11-26 Thanksgiving, the fourth Thursday in November.
      expect(isBusinessDay('2026-11-26')).toBe(false);
    });

    it('honours the observed day when a fixed-date holiday falls at a weekend', () => {
      // 5 U.S.C. 6103(b). Independence Day 2026 is a Saturday, so the offices
      // are shut on Friday the 3rd. Without the observed rule the 3rd counts as
      // a working day and the deadline lands on a day nobody is at work.
      expect(usFederalHolidays(2026).has('2026-07-03')).toBe(true);
      expect(isBusinessDay('2026-07-03')).toBe(false);
      // The 4th itself is a Saturday and not a Business Day either way.
      expect(isBusinessDay('2026-07-04')).toBe(false);

      // Christmas Day 2027 is a Saturday -> observed Friday the 24th.
      expect(usFederalHolidays(2027).has('2027-12-24')).toBe(true);
      // New Year's Day 2028 is a Saturday -> observed Friday 31 Dec 2027, which
      // belongs to the 2028 holiday set while falling in 2027. `isBusinessDay`
      // checks both years for exactly this.
      expect(usFederalHolidays(2028).has('2027-12-31')).toBe(true);
      expect(isBusinessDay('2027-12-31')).toBe(false);
    });

    it('honours the observed day when a fixed-date holiday falls on a Sunday', () => {
      // Juneteenth 2027 is a Saturday; 2021's was a Saturday too. Veterans Day
      // 2029 is a Sunday -> observed Monday the 12th.
      expect(usFederalHolidays(2029).has('2029-11-12')).toBe(true);
      expect(isBusinessDay('2029-11-12')).toBe(false);
      expect(isBusinessDay('2029-11-13')).toBe(true);
    });

    it('computes all eleven federal holidays for a year', () => {
      const holidays = usFederalHolidays(2026);
      expect(holidays.size).toBe(11);
      expect([...holidays].sort()).toEqual([
        '2026-01-01', // New Year's Day
        '2026-01-19', // MLK Day, 3rd Monday in January
        '2026-02-16', // Washington's Birthday, 3rd Monday in February
        '2026-05-25', // Memorial Day, last Monday in May
        '2026-06-19', // Juneteenth (a Friday)
        '2026-07-03', // Independence Day observed (the 4th is a Saturday)
        '2026-09-07', // Labor Day, 1st Monday in September
        '2026-10-12', // Columbus Day, 2nd Monday in October
        '2026-11-11', // Veterans Day (a Wednesday)
        '2026-11-26', // Thanksgiving, 4th Thursday in November
        '2026-12-25', // Christmas Day (a Friday)
      ]);
    });

    it('is computed, not tabulated, so it does not expire', () => {
      // A year far outside anything anyone would have typed into a list.
      const holidays = usFederalHolidays(2041);
      expect(holidays.size).toBe(11);
      // 2041-01-21 is the third Monday in January.
      expect(holidays.has('2041-01-21')).toBe(true);
    });
  });

  describe('counting periods', () => {
    it('ends a five Business Day period starting Thursday on the following Wednesday', () => {
      // The case the whole split exists for. 2026-09-10 is a Thursday.
      // Business days: Thu 10, Fri 11, Mon 14, Tue 15, Wed 16.
      expect(businessDayPeriodEnd('2026-09-10', 5)).toBe('2026-09-16');

      // Read as calendar days it would be Monday the 14th -- two days early,
      // and silently.
      expect(businessDayPeriodEnd('2026-09-10', 5)).not.toBe('2026-09-14');
    });

    it('extends a period by one day for a federal holiday inside it', () => {
      // 2026-11-23 is a Monday. Five Business Days would be Mon 23, Tue 24,
      // Wed 25, Thu 26, Fri 27 -- except Thursday the 26th is Thanksgiving, so
      // the period runs on to Monday the 30th.
      expect(isBusinessDay('2026-11-26')).toBe(false);
      expect(businessDayPeriodEnd('2026-11-23', 5)).toBe('2026-11-30');

      // A holiday-free week ends on the Friday. The week of 2026-10-19 is one:
      // Columbus Day was the 12th.
      expect(businessDayPeriodEnd('2026-10-19', 5)).toBe('2026-10-23');

      // And the week of the 9th is NOT holiday-free -- Veterans Day is
      // Wednesday the 11th -- so it runs to the Monday. Pinned because it is
      // the mistake a reader of this test is most likely to make.
      expect(isBusinessDay('2026-11-11')).toBe(false);
      expect(businessDayPeriodEnd('2026-11-09', 5)).toBe('2026-11-16');
    });

    it('counts the start day as day one', () => {
      // A one Business Day period starting on a Business Day is that day.
      expect(businessDayPeriodEnd('2026-09-10', 1)).toBe('2026-09-10');
    });

    it('starts a period on the next Business Day when it opens at a weekend', () => {
      // Notice served on Saturday the 5th: the period cannot start on a day
      // nobody is at work, and the 7th is Labor Day, so it starts Tuesday.
      expect(businessDayPeriodEnd('2026-09-05', 1)).toBe('2026-09-08');
    });

    it('distinguishes "within N business days of" from "an N business day period"', () => {
      // Thursday the 10th. Five days AFTER it is the following Thursday;
      // a five-day period BEGINNING on it ends the Wednesday. Both readings
      // appear in commercial writing, which is why they are two functions.
      expect(addBusinessDays('2026-09-10', 5)).toBe('2026-09-17');
      expect(businessDayPeriodEnd('2026-09-10', 5)).toBe('2026-09-16');
    });

    it('treats zero added days as the day itself', () => {
      expect(addBusinessDays('2026-09-10', 0)).toBe('2026-09-10');
    });

    it('skips a weekend when stepping to the next Business Day', () => {
      expect(nextBusinessDay('2026-09-11')).toBe('2026-09-14'); // Fri -> Mon
      expect(nextBusinessDay('2026-09-04')).toBe('2026-09-08'); // Fri -> Tue (Labor Day Mon)
    });

    it('lists the Business Days in a range, excluding weekends and holidays', () => {
      // 2026-09-04 Fri .. 2026-09-09 Wed, over Labor Day weekend.
      expect(businessDaysBetween('2026-09-04', '2026-09-09')).toEqual([
        '2026-09-04',
        '2026-09-08',
        '2026-09-09',
      ]);
    });

    it('returns nothing for an inverted range rather than looping', () => {
      expect(businessDaysBetween('2026-09-09', '2026-09-04')).toEqual([]);
    });

    it('refuses a nonsensical period length rather than guessing', () => {
      expect(() => businessDayPeriodEnd('2026-09-10', 0)).toThrow(/at least one day/);
      expect(() => addBusinessDays('2026-09-10', -1)).toThrow(/non-negative/);
      expect(() => addBusinessDays('2026-09-10', 2.5)).toThrow(/non-negative/);
    });
  });

  describe('the contractual periods', () => {
    it('names the three periods the agreement counts in Business Days', () => {
      expect(CONTRACT_PERIODS.SETTLEMENT_DISPUTE_BUSINESS_DAYS).toBe(5);
      expect(CONTRACT_PERIODS.DELIVERY_BUSINESS_DAYS).toBe(30);
      expect(CONTRACT_PERIODS.SETTLEMENT_GRACE_BUSINESS_DAYS).toBe(5);
    });

    it('runs the 30 Business Day delivery window well past 30 calendar days', () => {
      // Thursday 2026-09-10 plus 30 Business Days. Six weekends and Columbus
      // Day fall inside it, so the calendar-day answer (2026-10-09) is more
      // than a fortnight short.
      const end = businessDayPeriodEnd('2026-09-10', 30);
      expect(end).toBe('2026-10-22');
      expect(end > '2026-10-09').toBe(true);
    });
  });
});
