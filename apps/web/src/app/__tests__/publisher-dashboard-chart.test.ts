import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The publisher dashboard's trend chart is the publisher's real calls per day.
 *
 * It used to be "Mock chart data": the period's totals divided evenly across
 * the days and bent by `Math.sin`, drawn in hard-coded hex. A publisher read
 * the curve as their traffic. It now plots `GET /api/v1/publishers/:id/daily`
 * in the agency's brand tokens; this keeps the made-up curve from coming back.
 */
const PAGE = join(__dirname, '..', '(dashboard)', 'publisher', 'dashboard', 'page.tsx');
const source = readFileSync(PAGE, 'utf8');

describe('the publisher dashboard chart', () => {
  it('draws no made-up curve', () => {
    expect(source).not.toMatch(/Math\.(sin|cos|random)/);
    expect(source).not.toMatch(/mock chart/i);
  });

  it('reads the daily series', () => {
    expect(source).toContain('/daily?');
  });

  it('takes its colours from tokens, not hex', () => {
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).toContain('var(--brand)');
  });
});
