/**
 * How the quoter's results are cut for the screen: which category each
 * carrier is in, which survive the agent's filters and search, and in what
 * order. Pure, so the list an agent sees is tested without a browser.
 *
 * Categories (each carrier is in exactly one):
 *   qualified    -- appointed, eligible, health questions loaded
 *   priceOnly    -- appointed, eligible, health questions NOT loaded
 *   notAppointed -- eligible, but the agency is not appointed
 *   declined     -- not eligible (an appointed carrier's, or any when the
 *                   agent includes carriers they are not appointed with)
 *
 * "Needs review" is not a category but a cut of the qualified: a referral,
 * or a medication whose use is still unconfirmed.
 */

import type { FexResult } from './api';

export type SortKey = 'price' | 'face' | 'carrier';
export type BenefitFilter = 'any' | 'level' | 'graded' | 'gi';
export type ResultCategory = 'qualified' | 'review' | 'declined' | 'notAppointed';

export interface ResultFilters {
  benefit: BenefitFilter;
  /** Hide carriers whose rate book is older than current. */
  hideStale: boolean;
  /** Include carriers the agency is not appointed with. */
  showNotAppointed: boolean;
  /** Free text against carrier and product. */
  search: string;
}

export const DEFAULT_FILTERS: ResultFilters = {
  benefit: 'any',
  hideStale: false,
  showNotAppointed: false,
  search: '',
};

export const BENEFIT_FILTER_LABEL: Record<BenefitFilter, string> = {
  any: 'Any benefit',
  level: 'Level only',
  graded: 'Graded / modified',
  gi: 'Guaranteed issue',
};

function benefitMatches(r: FexResult, filter: BenefitFilter): boolean {
  if (filter === 'any') return true;
  const b = r.best?.benefit;
  if (filter === 'level') return b === 'LEVEL';
  if (filter === 'graded') return b === 'GRADED' || b === 'MODIFIED' || b === 'ROP';
  return b === 'GUARANTEED_ISSUE' || b === 'GI';
}

/** A rate book the carrier marks as needing a check before submitting. */
export function rateNeedsVerify(r: FexResult): boolean {
  const tone = r.facts?.ratesStatus.tone;
  return r.ratesStatus === 'STALE_VERIFY' || tone === 'warn' || tone === 'mod' || tone === 'bad';
}

/** A qualified carrier the agent should look at before applying. */
export function needsReview(r: FexResult): boolean {
  return r.eligible && (r.refer || r.needsIndication.length > 0);
}

export function matchesSearch(r: FexResult, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return [r.family, r.product, r.carrier].some(s => s?.toLowerCase().includes(q));
}

export function sortResults(list: FexResult[], sort: SortKey | null): FexResult[] {
  // null: the order the API sent, which is already the mode's natural order.
  if (sort === null) return list;
  return [...list].sort((a, b) => {
    if (sort === 'carrier')
      return `${a.family} ${a.product}`.localeCompare(`${b.family} ${b.product}`);
    if (sort === 'face') return (b.best?.face ?? 0) - (a.best?.face ?? 0);
    return (a.best?.premium ?? Infinity) - (b.best?.premium ?? Infinity);
  });
}

export interface ResultGroups {
  qualified: FexResult[];
  priceOnly: FexResult[];
  notAppointed: FexResult[];
  declined: FexResult[];
  /** The qualified (and price-only) that need a look: a subset, not a category. */
  review: FexResult[];
  /** The best premium among the qualified, and among the qualified Level. */
  lowestAny: number | null;
  lowestLevel: number | null;
  /** How many carriers the filters (not the search) hid. */
  hiddenByFilters: number;
}

export function groupResults(
  results: readonly FexResult[],
  filters: ResultFilters,
  sort: SortKey | null
): ResultGroups {
  const keep = (r: FexResult) =>
    benefitMatches(r, filters.benefit) && (!filters.hideStale || !rateNeedsVerify(r));
  const eligible = results.filter(r => r.eligible);
  const kept = eligible.filter(keep);
  const found = (r: FexResult) => matchesSearch(r, filters.search);

  const qualifiedAll = kept.filter(r => r.appointed && r.uwLoaded);
  const priceOnlyAll = kept.filter(r => r.appointed && !r.uwLoaded);

  const min = (list: FexResult[]) =>
    list
      .map(r => r.best?.premium)
      .filter((p): p is number => p != null)
      .reduce<number | null>((m, p) => (m === null ? p : Math.min(m, p)), null);

  return {
    qualified: sortResults(qualifiedAll.filter(found), sort),
    priceOnly: sortResults(priceOnlyAll.filter(found), sort),
    notAppointed: filters.showNotAppointed
      ? sortResults(
          kept.filter(r => !r.appointed && found(r)),
          sort
        )
      : [],
    declined: results.filter(
      r => !r.eligible && (r.appointed || filters.showNotAppointed) && found(r)
    ),
    review: sortResults([...qualifiedAll, ...priceOnlyAll].filter(needsReview).filter(found), sort),
    lowestAny: min(qualifiedAll),
    lowestLevel: min(qualifiedAll.filter(r => r.best?.benefit === 'LEVEL')),
    hiddenByFilters:
      eligible.filter(r => r.appointed || filters.showNotAppointed).length -
      kept.filter(r => r.appointed || filters.showNotAppointed).length,
  };
}

/** The applied filters as chips the agent can remove one at a time. */
export function activeFilterChips(
  filters: ResultFilters
): Array<{ key: keyof ResultFilters; label: string }> {
  const chips: Array<{ key: keyof ResultFilters; label: string }> = [];
  if (filters.benefit !== 'any')
    chips.push({ key: 'benefit', label: BENEFIT_FILTER_LABEL[filters.benefit] });
  if (filters.hideStale) chips.push({ key: 'hideStale', label: 'Current rates only' });
  if (filters.showNotAppointed)
    chips.push({ key: 'showNotAppointed', label: 'Including not appointed' });
  if (filters.search.trim()) chips.push({ key: 'search', label: `“${filters.search.trim()}”` });
  return chips;
}
