import type { ReportSection, StructuredReport } from '@hopwhistle/shared';

/**
 * Report V2 derivations — pure, honest, and additive (they never touch the
 * shared `ui/report-helpers.ts` used by the current report). Everything here is
 * grounded in fields that actually exist in the structured report.
 */

export const NOT_ESTABLISHED = 'Not established';

/** Split a prose value like "$25,000 (reserve for insurance…)" or
 *  "14-30 days (realistic; …)" into a bold headline + a quieter qualifier. */
export function leadValue(s?: string | null): { head: string; sub?: string } {
  if (!s) return { head: NOT_ESTABLISHED };
  const t = s.trim();
  const paren = t.match(/^([^(]+?)\s*\(([^]*)\)\s*$/);
  if (paren) return { head: paren[1].trim(), sub: paren[2].trim() };
  // Otherwise take the first clause (up to an em/– dash or first comma if short).
  const dash = t.split(/\s+[—–]\s+/);
  if (dash.length > 1 && dash[0].length <= 42) return { head: dash[0].trim(), sub: dash.slice(1).join(' — ').trim() };
  if (t.length <= 46) return { head: t };
  const firstSentence = t.split(/(?<=[.;])\s+/)[0];
  return firstSentence.length < t.length ? { head: firstSentence.trim(), sub: t.slice(firstSentence.length).trim() } : { head: t };
}

const snake = (k: string) => /^[a-z]+(_[a-z0-9]+)+$/.test(k);
const normTitle = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Deduplicate report sections (the pipeline emits keyed canonical sections plus
 *  shorter title-keyed duplicates). Prefer the snake_cased canonical entry, and
 *  when both exist keep the longer markdown. */
export function canonicalSections(report: StructuredReport): ReportSection[] {
  const byTitle = new Map<string, ReportSection>();
  for (const s of report.sections) {
    const t = normTitle(s.title || s.key);
    const cur = byTitle.get(t);
    if (!cur) {
      byTitle.set(t, s);
      continue;
    }
    const curScore = (snake(cur.key) ? 1000 : 0) + cur.markdown.length;
    const newScore = (snake(s.key) ? 1000 : 0) + s.markdown.length;
    if (newScore > curScore) byTitle.set(t, s);
  }
  // Preserve first-seen order of the canonical entries.
  const seen = new Set<string>();
  const out: ReportSection[] = [];
  for (const s of report.sections) {
    const t = normTitle(s.title || s.key);
    if (seen.has(t)) continue;
    seen.add(t);
    const chosen = byTitle.get(t);
    if (chosen) out.push(chosen);
  }
  return out;
}

/** First canonical section whose key or title matches. */
export function findSection(report: StructuredReport, re: RegExp): ReportSection | undefined {
  return canonicalSections(report).find(s => re.test(s.key) || re.test(s.title));
}
export function findSections(report: StructuredReport, res: RegExp[]): ReportSection[] {
  const all = canonicalSections(report);
  const out: ReportSection[] = [];
  const used = new Set<string>();
  for (const re of res) {
    const hit = all.find(s => !used.has(s.key) && (re.test(s.key) || re.test(s.title)));
    if (hit) {
      out.push(hit);
      used.add(hit.key);
    }
  }
  return out;
}

// ---- Evidence & source statistics ----------------------------------------

export interface EvidenceStats {
  total: number;
  classificationCounts: Record<string, number>;
  categoryCounts: Record<string, number>;
  points: Array<{ confidence: number; materiality: number; classification: string }>;
}
export function evidenceStats(report: StructuredReport): EvidenceStats {
  const classificationCounts: Record<string, number> = {};
  const categoryCounts: Record<string, number> = {};
  const points: EvidenceStats['points'] = [];
  for (const c of report.evidenceLedger) {
    classificationCounts[c.classification] = (classificationCounts[c.classification] ?? 0) + 1;
    if (c.category) categoryCounts[c.category] = (categoryCounts[c.category] ?? 0) + 1;
    if (typeof c.confidence === 'number' && typeof c.materiality === 'number')
      points.push({ confidence: c.confidence, materiality: c.materiality, classification: c.classification });
  }
  return { total: report.evidenceLedger.length, classificationCounts, categoryCounts, points };
}

export interface SourceStats {
  total: number;
  validated: number;
  byProvider: Record<string, number>;
}
export function sourceStats(report: StructuredReport): SourceStats {
  const byProvider: Record<string, number> = {};
  let validated = 0;
  for (const s of report.sources) {
    byProvider[s.provider] = (byProvider[s.provider] ?? 0) + 1;
    if (s.validated) validated += 1;
  }
  return { total: report.sources.length, validated, byProvider };
}

// ---- 90-day timeline parsing ---------------------------------------------

export interface TimelinePhase {
  label: string;
  body: string;
}
/** Parse a "**Days 1-7:** …" style plan into discrete phases. [] if unparseable. */
export function parseTimeline(markdown?: string): TimelinePhase[] {
  if (!markdown) return [];
  const re = /\*\*(Days?\s*[\d–\-+]+[^:*]*)\:?\*\*\s*([^]*?)(?=\*\*Days?\s|\*\*Week|\s*$)/gi;
  const out: TimelinePhase[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown))) {
    const label = m[1].replace(/:$/, '').trim();
    const body = m[2].replace(/\s+/g, ' ').trim();
    if (body) out.push({ label, body });
  }
  return out;
}

// ---- Decision factors (why it can work / can fail) ------------------------

export interface Factor {
  title: string;
  detail: string;
  weight: 'Primary' | 'Supporting';
}
function toFactor(text: string, weight: Factor['weight']): Factor {
  const clean = text.trim().replace(/\.$/, '');
  // Title = leading clause up to the first strong break; detail = the whole thing.
  const m = clean.match(/^(.{12,74}?)(?:[—–:,]|\s\(|\.\s)/);
  const title = (m ? m[1] : clean.split(/\s+/).slice(0, 10).join(' ')).trim();
  return { title: title.replace(/[—–:,]$/, '').trim(), detail: clean, weight };
}
export function factorsFor(report: StructuredReport): Factor[] {
  const v = report.executiveVerdict;
  const items = [v.biggestOpportunity, ...report.rankedOpportunities.slice(0, 2).map(o => o.opportunity)].filter(Boolean);
  return items.map((t, i) => toFactor(t, i === 0 ? 'Primary' : 'Supporting')).slice(0, 3);
}
export function factorsAgainst(report: StructuredReport): Factor[] {
  const items = [report.executiveVerdict.biggestRisk, ...report.killCriteria.slice(0, 2)].filter(Boolean);
  return items.map((t, i) => toFactor(t, i === 0 ? 'Primary' : 'Supporting')).slice(0, 3);
}
