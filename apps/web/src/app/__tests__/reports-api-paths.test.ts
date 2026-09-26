import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Every report path the Reports page asks for is one the API registers.
 *
 * ── The defect this pins ─────────────────────────────────────────────────────
 *
 * The Campaign Profitability tab fetched `/api/v1/reports/profitability`, and
 * its CSV export asked for the same path. The API has never registered it --
 * the route is `/api/v1/reports/campaign-profitability` -- so the tab answered
 * 404 for everybody and showed nothing. The other two exports asked the JSON
 * routes for `format=csv`, which none of them reads, and saved a JSON body
 * under a `.csv` name.
 *
 * Nothing crossed the two packages to notice. This reads both sources: every
 * `/api/v1/reports/...` path the page names, with its query string cut, must
 * be a path `apps/api/src/routes/index.ts` registers, and every export must
 * be one of the `/export.csv` routes.
 */

const WEB_SRC = resolve(__dirname, '../..');
// The Reports view: its body moved out of the page so the Revenue hub can
// render it in a tab, and the page renders it too.
const PAGE = readFileSync(join(WEB_SRC, 'components', 'reports', 'reports-view.tsx'), 'utf8');
const API_ROUTES = readFileSync(resolve(WEB_SRC, '../../api/src/routes/index.ts'), 'utf8');

/** The report paths the API registers, from its `'/api/v1/reports/...'` literals. */
const REGISTERED = new Set(
  [...API_ROUTES.matchAll(/'(\/api\/v1\/reports\/[^'?]+)'/g)].map(match => match[1])
);

/** The report paths the page names, in string or template literals, query cut. */
const REQUESTED = [...PAGE.matchAll(/['`](\/api\/v1\/reports\/[^'`?$]+)/g)].map(match => match[1]);

describe('the Reports page asks only for report routes the API has', () => {
  it('finds the routes on both sides', () => {
    expect(REGISTERED.has('/api/v1/reports/campaign-profitability')).toBe(true);
    expect(REQUESTED.length).toBeGreaterThanOrEqual(6);
  });

  it.each(REQUESTED.map(path => [path]))('%s is registered by the API', path => {
    expect(REGISTERED.has(path), `${path} is not a route in apps/api/src/routes/index.ts`).toBe(
      true
    );
  });

  it('loads Campaign Profitability from its real route', () => {
    expect(PAGE).toContain('/api/v1/reports/campaign-profitability?');
    expect(PAGE).not.toContain('/api/v1/reports/profitability');
  });

  it('exports every tab from its /export.csv route', () => {
    const exportsTable = PAGE.slice(PAGE.indexOf('const EXPORTS'));
    const endpoints = [...exportsTable.matchAll(/endpoint: '([^']+)'/g)].map(match => match[1]);
    expect(endpoints).toEqual([
      '/api/v1/reports/campaign-profitability/export.csv',
      '/api/v1/reports/publisher-revenue/export.csv',
      '/api/v1/reports/buyer-costs/export.csv',
    ]);
  });
});
