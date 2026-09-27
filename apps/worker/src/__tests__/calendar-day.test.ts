import { describe, expect, it } from 'vitest';

import { calendarDayOf, ledgerPeriodDate } from '../lib/calendar-day.js';

/**
 * The worker dates its accrual-ledger rows by the New York calendar day, the
 * day every report reads them on -- not the server's midnight, which in UTC
 * names tomorrow for five hours every evening.
 */
describe('ledger period date', () => {
  it('is the New York day, stored as that day label', () => {
    // 01:30 UTC on 3 September is 21:30 on 2 September in New York.
    const evening = new Date('2026-09-03T01:30:00Z');
    expect(calendarDayOf(evening)).toBe('2026-09-02');
    expect(ledgerPeriodDate(evening).toISOString()).toBe('2026-09-02T00:00:00.000Z');
  });

  it('holds across the autumn clock change', () => {
    // 04:30 UTC on 2 November 2026 is 23:30 on 1 November, New York standard time.
    expect(calendarDayOf(new Date('2026-11-02T04:30:00Z'))).toBe('2026-11-01');
    expect(calendarDayOf(new Date('2026-11-02T05:30:00Z'))).toBe('2026-11-02');
  });
});
