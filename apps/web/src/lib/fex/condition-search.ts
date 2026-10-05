/**
 * Condition typeahead, ranked the way agents expect: a label that STARTS with
 * what was typed, then one with a word starting with it, then anywhere in the
 * label, code or the words prospects actually say (`CONDITION_SYNONYMS`).
 */

import { CONDITION_SYNONYMS } from '@hopwhistle/fex-engine/catalog';

export interface SearchableCondition {
  code: string;
  label: string;
  category: string;
}

export function searchConditions<T extends SearchableCondition>(
  conditions: readonly T[],
  query: string,
  limit = 12
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: Array<{ c: T; score: number }> = [];
  for (const c of conditions) {
    const label = c.label.toLowerCase();
    const code = c.code.toLowerCase().replace(/_/g, ' ');
    const synonyms = (CONDITION_SYNONYMS[c.code] ?? '').toLowerCase();
    const haystack = `${label} ${code} ${synonyms}`;
    let score = -1;
    if (label.startsWith(q) || code.startsWith(q)) score = 0;
    else if (new RegExp(`(^|[\\s/(,-])${escape(q)}`).test(haystack)) score = 1;
    else if (haystack.includes(q)) score = 2;
    if (score >= 0) scored.push({ c, score });
  }
  scored.sort((a, b) => a.score - b.score || a.c.label.length - b.c.label.length);
  return scored.slice(0, limit).map(s => s.c);
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
