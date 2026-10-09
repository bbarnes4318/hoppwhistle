import { describe, expect, it } from 'vitest';

import {
  FEEDBACK_MAIN_PATH,
  feedbackProgress,
  feedbackTargetLabel,
  normaliseTargetDate,
  quarterStart,
  weekStart,
} from '../product-feedback.js';

// Friday 9 October 2026.
const TODAY = '2026-10-09';

describe('feedback targets', () => {
  it('stores the first day of the period, whatever day inside it was picked', () => {
    expect(weekStart('2026-10-09')).toBe('2026-10-05');
    expect(weekStart('2026-10-05')).toBe('2026-10-05');
    expect(weekStart('2026-10-11')).toBe('2026-10-05');
    expect(quarterStart('2026-11-20')).toBe('2026-10-01');
    expect(normaliseTargetDate('MONTH', '2027-01-17')).toBe('2027-01-01');
    expect(normaliseTargetDate('DATE', '2026-10-21')).toBe('2026-10-21');
    expect(normaliseTargetDate('NONE', '2026-10-21')).toBeNull();
    expect(normaliseTargetDate('DATE', '2026-02-30')).toBeNull();
  });

  it('reads relative to the reader’s day, so a stored target never goes stale', () => {
    expect(feedbackTargetLabel('WEEK', '2026-10-05', TODAY)).toBe('This week');
    expect(feedbackTargetLabel('WEEK', '2026-10-12', TODAY)).toBe('Next week');
    expect(feedbackTargetLabel('WEEK', '2026-10-12', '2026-10-14')).toBe('This week');
    expect(feedbackTargetLabel('WEEK', '2026-10-12', '2026-11-02')).toBe('Week of Oct 12');
    expect(feedbackTargetLabel('MONTH', '2026-10-01', TODAY)).toBe('This month');
    expect(feedbackTargetLabel('MONTH', '2026-11-01', TODAY)).toBe('Next month');
    expect(feedbackTargetLabel('MONTH', '2027-01-01', TODAY)).toBe('January 2027');
    expect(feedbackTargetLabel('QUARTER', '2026-10-01', TODAY)).toBe('Q4 2026');
    expect(feedbackTargetLabel('DATE', '2026-10-21', TODAY)).toBe('Oct 21');
    expect(feedbackTargetLabel('DATE', '2027-03-02', TODAY)).toBe('Mar 2, 2027');
  });

  it('says there is no timeline rather than inventing one', () => {
    expect(feedbackTargetLabel('NONE', null, TODAY)).toBe('No timeline yet');
    expect(feedbackTargetLabel(null, null, TODAY)).toBe('No timeline yet');
    expect(feedbackTargetLabel('WEEK', 'not-a-date', TODAY)).toBe('No timeline yet');
  });
});

describe('feedback progress', () => {
  it('runs from submitted to shipped along the main path', () => {
    expect(feedbackProgress('NEW')).toBe(0);
    expect(feedbackProgress('SHIPPED')).toBe(1);
    expect(feedbackProgress('IN_PROGRESS')).toBe(3 / (FEEDBACK_MAIN_PATH.length - 1));
  });

  it('draws no bar for a request that is off the path', () => {
    expect(feedbackProgress('NEEDS_INFO')).toBeNull();
    expect(feedbackProgress('NOT_PLANNED')).toBeNull();
    expect(feedbackProgress('MERGED')).toBeNull();
  });
});
