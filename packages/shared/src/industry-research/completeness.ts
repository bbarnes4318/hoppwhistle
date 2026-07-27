import type { StructuredReport } from './types';

/**
 * Structured-completeness scoring.
 *
 * Every detail field on `rankedOpportunities`, `unitEconomicsScenarios` and
 * `competitors` is optional in the schema, so a report whose structured object
 * is little more than a list of names validates perfectly while the figures the
 * research actually produced stay trapped in prose. This scores how much of
 * that structured detail is genuinely present, so the gap is measurable rather
 * than something you only notice when the UI renders "Not established".
 *
 * A value counts as present when it is a non-empty string. An explicit
 * "unknown - reason" counts as present (it is a real answer, and the synthesis
 * contract asks for it) but is tracked separately so an all-unknown report
 * cannot masquerade as a complete one.
 */

const OPPORTUNITY_FIELDS = [
  'customer',
  'offer',
  'revenueModel',
  'price',
  'startupCost',
  'timeToMvp',
  'timeToFirstRevenue',
  'grossMarginRange',
  'salesDifficulty',
  'regulatoryRisk',
  'defensibility',
] as const;

const SCENARIO_FIELDS = ['asp', 'grossMargin', 'cac', 'paybackPeriod', 'ltv', 'notes'] as const;

const COMPETITOR_FIELDS = [
  'targetCustomer',
  'offer',
  'pricing',
  'strengths',
  'weaknesses',
  'vulnerability',
] as const;

export type CompletenessGroup = 'rankedOpportunities' | 'unitEconomicsScenarios' | 'competitors';

export interface GroupCompleteness {
  items: number;
  filled: number;
  total: number;
  unknowns: number;
}

export interface CompletenessReport {
  /** Fraction of required detail fields that carry a value (0..1). */
  score: number;
  filled: number;
  total: number;
  /** Of the filled fields, how many are explicit "unknown - ..." answers. */
  unknowns: number;
  /** Dotted paths of every absent field, e.g. `rankedOpportunities[1].price`. */
  missing: string[];
  byGroup: Record<CompletenessGroup, GroupCompleteness>;
}

const isUnknown = (v: string) => /^\s*unknown\b/i.test(v);

function present(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function scoreGroup(
  rows: ReadonlyArray<Record<string, unknown>>,
  fields: ReadonlyArray<string>,
  label: string,
  missing: string[]
): GroupCompleteness {
  let filled = 0;
  let unknowns = 0;
  rows.forEach((row, i) => {
    for (const f of fields) {
      const v = row?.[f];
      if (present(v)) {
        filled += 1;
        if (isUnknown(v)) unknowns += 1;
      } else {
        missing.push(`${label}[${i}].${f}`);
      }
    }
  });
  return { items: rows.length, filled, total: rows.length * fields.length, unknowns };
}

/** Measure how much of the structured detail a report actually carries. */
export function scoreStructuredCompleteness(report: StructuredReport): CompletenessReport {
  const missing: string[] = [];
  const byGroup: Record<CompletenessGroup, GroupCompleteness> = {
    rankedOpportunities: scoreGroup(
      (report.rankedOpportunities ?? []) as unknown as Array<Record<string, unknown>>,
      OPPORTUNITY_FIELDS,
      'rankedOpportunities',
      missing
    ),
    unitEconomicsScenarios: scoreGroup(
      (report.unitEconomicsScenarios ?? []) as unknown as Array<Record<string, unknown>>,
      SCENARIO_FIELDS,
      'unitEconomicsScenarios',
      missing
    ),
    competitors: scoreGroup(
      (report.competitors ?? []) as unknown as Array<Record<string, unknown>>,
      COMPETITOR_FIELDS,
      'competitors',
      missing
    ),
  };

  const filled = Object.values(byGroup).reduce((a, g) => a + g.filled, 0);
  const total = Object.values(byGroup).reduce((a, g) => a + g.total, 0);
  const unknowns = Object.values(byGroup).reduce((a, g) => a + g.unknowns, 0);

  return { score: total ? filled / total : 0, filled, total, unknowns, missing, byGroup };
}

/** One-line summary for logs: `structured completeness 78% (129/165, 12 unknown)`. */
export function formatCompleteness(c: CompletenessReport): string {
  const pct = Math.round(c.score * 100);
  return `structured completeness ${pct}% (${c.filled}/${c.total} fields, ${c.unknowns} explicit unknown) — opportunities ${c.byGroup.rankedOpportunities.filled}/${c.byGroup.rankedOpportunities.total}, economics ${c.byGroup.unitEconomicsScenarios.filled}/${c.byGroup.unitEconomicsScenarios.total}, competitors ${c.byGroup.competitors.filled}/${c.byGroup.competitors.total}`;
}
