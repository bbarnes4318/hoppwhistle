import { describe, expect, it } from 'vitest';

import { addDays, lastNewYorkDays, newYorkDayKey } from '../new-york-day';

describe('newYorkDayKey', () => {
  it('names the New York day, not the UTC one, in the evening', () => {
    // 02:30 UTC on the 28th is 22:30 on the 27th in New York (EDT).
    expect(newYorkDayKey(new Date('2026-09-28T02:30:00Z'))).toBe('2026-09-27');
  });

  it('agrees with UTC in the middle of the day', () => {
    expect(newYorkDayKey(new Date('2026-09-27T16:00:00Z'))).toBe('2026-09-27');
  });

  it('handles standard time too', () => {
    // 04:30 UTC on 15 January is 23:30 on the 14th in New York (EST).
    expect(newYorkDayKey(new Date('2026-01-15T04:30:00Z'))).toBe('2026-01-14');
  });
});

describe('addDays', () => {
  it('moves across month and year ends', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('moves across a DST change by whole days', () => {
    expect(addDays('2026-11-02', -1)).toBe('2026-11-01');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
  });
});

describe('lastNewYorkDays', () => {
  it('is thirty days ending on today in New York', () => {
    expect(lastNewYorkDays(30, new Date('2026-09-28T02:30:00Z'))).toEqual({
      from: '2026-08-29',
      to: '2026-09-27',
    });
  });
});
