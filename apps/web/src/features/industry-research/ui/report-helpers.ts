import type { AdversarialVerification, EvidenceSource, StructuredReport } from '@hopwhistle/shared';

export const NOT_ESTABLISHED = 'Not established';

// ---- Source preview (only available factual metadata) ---------------------

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0] ?? url;
  }
}

export interface SourcePreview {
  title: string;
  domain: string;
  publishedDate: string;
  sourceType: string;
  validation: string;
  provider: string;
  /** The schema carries no excerpt/description → null (UI shows a clear notice). */
  previewText: string | null;
}

/** Build a source preview from ONLY available metadata; missing fields become
 *  `Not established` and there is never invented excerpt text. */
export function buildSourcePreview(s: EvidenceSource): SourcePreview {
  return {
    title: s.title ?? NOT_ESTABLISHED,
    domain: s.publisher ?? domainOf(s.url),
    publishedDate: s.publishedDate ?? NOT_ESTABLISHED,
    sourceType: s.sourceType ?? NOT_ESTABLISHED,
    validation: s.validated
      ? `Validated${s.validationNote ? ` — ${s.validationNote}` : ''}`
      : 'Unverified',
    provider: s.provider,
    previewText: null,
  };
}

// ---- Risk register (deterministic mapping from existing evidence) ---------

export interface RiskRow {
  risk: string;
  probability: string;
  impact: string;
  ability: string;
  mitigation: string;
  trigger: string;
}

const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'their',
  'which',
  'these',
  'those',
  'have',
  'will',
  'more',
  'than',
  'into',
  'over',
  'when',
  'they',
  'them',
  'your',
  'about',
  'could',
  'would',
  'should',
  'because',
]);

function distinctiveWords(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(w => w.length > 4 && !STOPWORDS.has(w))
    )
  );
}

function overlaps(a: string, b: string): boolean {
  const wa = new Set(distinctiveWords(a));
  return distinctiveWords(b).some(w => wa.has(w));
}

function overlapCount(a: string, b: string): number {
  const wa = new Set(distinctiveWords(a));
  return distinctiveWords(b).filter(w => wa.has(w)).length;
}

// A shared two-word phrase of distinctive words (a "highly specific shared phrase").
function sharedPhrase(a: string, b: string): boolean {
  const bigrams = (s: string) => {
    const w = s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(x => x.length > 4 && !STOPWORDS.has(x));
    const out = new Set<string>();
    for (let i = 0; i + 1 < w.length; i++) out.add(`${w[i]} ${w[i + 1]}`);
    return out;
  };
  const ba = bigrams(a);
  return Array.from(bigrams(b)).some(g => ba.has(g));
}

// Explicit action / mitigation language — a sentence only qualifies as a
// mitigation if it actually proposes doing something about the risk.
const MITIGATION_ACTION =
  /\b(mitigat\w*|reduc\w*|prevent\w*|address\w*|manag\w*|control\w*|requir\w*|implement\w*|establish\w*|monitor\w*|limit\w*|avoid\w*|ensur\w*|maintain\w*|negotiat\w*|enforc\w*|use|using)\b/i;

/** Only surface a mitigation when a section sentence both (a) uses explicit
 *  action/mitigation language and (b) is clearly about this risk (≥2 shared
 *  distinctive terms OR a specific shared phrase). Otherwise Not established. */
function findMitigation(report: StructuredReport, risk: string): string | null {
  const sectionRe = /entry|execution|thesis|regulat|operation|distribution|sales|risk|mitigat/i;
  for (const s of report.sections) {
    if (!sectionRe.test(s.title) && !sectionRe.test(s.key)) continue;
    const sentences = s.markdown
      .replace(/[#*_`>]/g, '')
      .split(/(?<=[.!?])\s+/)
      .map(x => x.trim())
      .filter(x => x.length > 15 && x.length < 240);
    for (const sen of sentences) {
      if (!MITIGATION_ACTION.test(sen)) continue;
      if (overlapCount(risk, sen) >= 2 || sharedPhrase(risk, sen)) return sen;
    }
  }
  return null;
}

/** Derive a displayed probability classification ONLY from explicit language in
 *  the risk statement. When the evidence does not establish it → Not established. */
export function deriveProbability(text: string): string {
  const t = text.toLowerCase();
  if (
    /\b(likely|common|frequent(ly)?|recurring|often|widespread|persistent|chronic|prevalent|routinely)\b/.test(
      t
    )
  )
    return 'Likely';
  if (/\b(occasional(ly)?|periodic|seasonal|intermittent|sometimes)\b/.test(t)) return 'Possible';
  if (/\b(rare(ly)?|unlikely|uncommon|isolated)\b/.test(t)) return 'Low';
  return NOT_ESTABLISHED;
}

/**
 * Build the six-field institutional risk register deterministically from the
 * structured report + adversarial verification. Every field is either grounded
 * in existing evidence or shown as `Not established` — nothing is invented.
 */
export function buildRiskRegister(
  report: StructuredReport,
  adversarial?: AdversarialVerification | null
): RiskRow[] {
  const v = report.executiveVerdict;
  const kill = report.killCriteria;

  const sources: Array<{ text: string; impact: string }> = [];
  if (v.biggestRisk) sources.push({ text: v.biggestRisk, impact: 'High' });
  const push = (arr: string[] | undefined, impact: string) =>
    (arr ?? []).slice(0, 3).forEach(text => sources.push({ text, impact }));
  // Material weaknesses → High impact; softer warnings → impact Not established.
  push(adversarial?.economicWeaknesses, 'High');
  push(adversarial?.regulatoryWeaknesses, 'High');
  push(adversarial?.blockingDefects, 'High');
  push(adversarial?.operatorWarnings, NOT_ESTABLISHED);
  push(adversarial?.customerWarnings, NOT_ESTABLISHED);

  const seen = new Set<string>();
  const rows: RiskRow[] = [];
  for (const src of sources) {
    const text = src.text.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    const trigger = kill.find(k => overlaps(text, k)) ?? NOT_ESTABLISHED;
    const mitigation = findMitigation(report, text) ?? NOT_ESTABLISHED;
    rows.push({
      risk: text,
      probability: deriveProbability(text),
      impact: src.impact,
      ability: NOT_ESTABLISHED,
      mitigation,
      trigger,
    });
    if (rows.length >= 8) break;
  }
  return rows;
}

/** First readable sentence from the first section whose title/key matches. */
export function firstSectionSentence(report: StructuredReport, sectionRe: RegExp): string | null {
  for (const s of report.sections) {
    if (!sectionRe.test(s.title) && !sectionRe.test(s.key)) continue;
    const sentence = s.markdown
      .replace(/[#*_`>-]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .split(/(?<=[.!?])\s+/)
      .find(x => x.trim().length > 15);
    if (sentence) return sentence.trim();
  }
  return null;
}

// ---- Economic verdict -----------------------------------------------------

export interface EconomicVerdict {
  label: 'Attractive' | 'Conditional' | 'Unattractive' | 'Not established';
  cls: string;
  sentence: string;
}

function firstNumber(s?: string): number | null {
  if (!s) return null;
  const m = s.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}
function parseMonths(s?: string): number | null {
  const n = firstNumber(s);
  if (n == null) return null;
  return /year/i.test(s ?? '') ? n * 12 : n;
}

/**
 * Judge the ECONOMICS from economic evidence (gross margin, payback, LTV/CAC,
 * startup capital, base-scenario notes) — NOT from the overall report verdict.
 * When too few economic signals are available, returns `Not established`.
 * This is deliberately distinct from the overall GO / DO-NOT-ENTER recommendation.
 */
export function deriveEconomicVerdict(report: StructuredReport): EconomicVerdict {
  const base = report.unitEconomicsScenarios.find(s => s.name === 'base');
  const margin = firstNumber(base?.grossMargin); // %
  const payback = parseMonths(base?.paybackPeriod); // months
  const cac = firstNumber(base?.cac);
  const ltv = firstNumber(base?.ltv);
  const notes = base?.notes?.trim();
  const quant = [margin, payback, cac, ltv].filter(x => x != null).length;

  if (quant < 2 && !notes) {
    return {
      label: 'Not established',
      cls: 'ir-muted',
      sentence:
        'The available evidence does not establish the unit economics; too few economic signals were reported.',
    };
  }

  let score = 0;
  if (margin != null) score += margin >= 40 ? 1 : margin < 25 ? -1 : 0;
  if (payback != null) score += payback <= 6 ? 1 : payback > 12 ? -1 : 0;
  if (ltv != null && cac != null && cac > 0) {
    const ratio = ltv / cac;
    score += ratio >= 3 ? 1 : ratio < 1 ? -1 : 0;
  }
  const n = (notes ?? '').toLowerCase();
  const conditionalNote = /only if|conditional|depends|unless|provided that|contingent/.test(n);
  if (/attractive|strong|healthy|robust|compelling|favou?rable/.test(n)) score += 1;
  if (/thin|weak|challenging|difficult|unattractive|marginal|tight|poor/.test(n)) score -= 1;

  let label: EconomicVerdict['label'];
  if (conditionalNote) label = 'Conditional';
  else if (score >= 2) label = 'Attractive';
  else if (score <= -2) label = 'Unattractive';
  else label = 'Conditional';
  const cls = label === 'Attractive' ? 'ir-pos' : label === 'Unattractive' ? 'ir-neg' : 'ir-warn';

  const sentence =
    notes ||
    `Base-case gross margin ${base?.grossMargin ?? NOT_ESTABLISHED.toLowerCase()}, payback ${base?.paybackPeriod ?? NOT_ESTABLISHED.toLowerCase()}${
      ltv != null && cac != null ? `, LTV/CAC ${(ltv / cac).toFixed(1)}×` : ''
    } on ${report.executiveVerdict.initialCapital} of startup capital.`;
  return { label, cls, sentence };
}

// ---- Shared report derivations (single source of truth) -------------------

export function reportFirstSentences(md: string, max = 2): string {
  const plain = md
    .replace(/[#*_`>-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain
    .split(/(?<=[.!?])\s+/)
    .slice(0, max)
    .join(' ');
}

export function deriveRecommendation(report: StructuredReport): string {
  const v = report.executiveVerdict;
  const thesis = report.sections.find(s => /thesis|recommend/i.test(s.title));
  if (thesis) return reportFirstSentences(thesis.markdown, 2);
  return `${v.biggestOpportunity} — targeting ${v.bestCustomer} with ${v.bestBusinessModel}, beginning in ${report.reportMetadata.geography}.`;
}

export function deriveReasonsFor(report: StructuredReport): string[] {
  const v = report.executiveVerdict;
  return [v.biggestOpportunity, ...report.rankedOpportunities.slice(0, 2).map(o => o.opportunity)]
    .filter(Boolean)
    .slice(0, 3);
}
export function deriveReasonsAgainst(report: StructuredReport): string[] {
  return [report.executiveVerdict.biggestRisk, ...report.killCriteria.slice(0, 2)]
    .filter(Boolean)
    .slice(0, 3);
}

// ---- Comprehensive search model ------------------------------------------

export interface SearchRegion {
  region: 'decision' | 'economics' | 'opportunity' | 'risk' | 'review' | 'kill' | 'rail';
  text: string;
}

/**
 * Every discrete user-visible textual value in the report, tagged by region.
 * The component renders each of these through the shared SearchHighlight, so a
 * match found here is a match highlighted (and navigable) in the UI. The long
 * Markdown analysis is highlighted separately via the markdown component set.
 */
export function collectSearchableRegions(
  report: StructuredReport,
  adversarial?: AdversarialVerification | null
): SearchRegion[] {
  const v = report.executiveVerdict;
  const out: SearchRegion[] = [];
  const add = (region: SearchRegion['region'], text?: string | number | null) => {
    if (text == null) return;
    const s = String(text).trim();
    if (s) out.push({ region, text: s });
  };

  // Decision summary + recommendation + reasons
  add('decision', v.verdict.replace(/_/g, ' '));
  add('decision', `${v.overallScore} / 100`);
  add('decision', v.timeToFirstRevenue);
  add('decision', v.initialCapital);
  add('decision', deriveRecommendation(report));
  deriveReasonsFor(report).forEach(t => add('decision', t));
  deriveReasonsAgainst(report).forEach(t => add('decision', t));

  // Economics
  const ev = deriveEconomicVerdict(report);
  add('economics', v.initialCapital);
  for (const sc of report.unitEconomicsScenarios) {
    [sc.asp, sc.grossMargin, sc.cac, sc.paybackPeriod, sc.ltv, sc.notes].forEach(x =>
      add('economics', x)
    );
  }
  add('economics', ev.label);
  add('economics', ev.sentence);

  // Opportunities
  for (const o of report.rankedOpportunities) {
    [
      o.opportunity,
      o.customer,
      o.offer,
      o.revenueModel,
      o.startupCost,
      o.timeToFirstRevenue,
      o.salesDifficulty,
    ].forEach(x => add('opportunity', x));
    add('opportunity', o.opportunityScore);
  }

  // Risk register + kill criteria
  for (const rk of buildRiskRegister(report, adversarial)) {
    [rk.risk, rk.probability, rk.impact, rk.ability, rk.mitigation, rk.trigger].forEach(x =>
      add('risk', x)
    );
  }
  report.killCriteria.forEach(k => add('kill', k));

  return out;
}

/** Matches of a query across the searchable regions, in render order (one entry
 *  per occurrence) — drives comprehensive count + Previous/Next navigation. */
export function regionMatches(regions: SearchRegion[], query: string): SearchRegion[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: SearchRegion[] = [];
  for (const r of regions) {
    const lower = r.text.toLowerCase();
    let i = 0;
    for (;;) {
      const idx = lower.indexOf(q, i);
      if (idx < 0) break;
      out.push(r);
      i = idx + q.length;
    }
  }
  return out;
}

/** Wrap-around index step for match navigation (Previous/Next). */
export function stepIndex(total: number, current: number, delta: number): number {
  return total ? (current + delta + total) % total : -1;
}

// ---- Safe text highlighting ----------------------------------------------

export type HLPart = { text: string; mark: boolean };

/** Split text into plain + matching parts for safe React highlighting (no HTML
 *  injection). Case-insensitive; empty query returns a single plain part. */
export function splitHighlight(text: string, query: string): HLPart[] {
  const q = query.trim().toLowerCase();
  if (!q) return [{ text, mark: false }];
  const parts: HLPart[] = [];
  const lower = text.toLowerCase();
  let i = 0;
  for (;;) {
    const idx = lower.indexOf(q, i);
    if (idx < 0) {
      if (i < text.length) parts.push({ text: text.slice(i), mark: false });
      break;
    }
    if (idx > i) parts.push({ text: text.slice(i, idx), mark: false });
    parts.push({ text: text.slice(idx, idx + q.length), mark: true });
    i = idx + q.length;
  }
  return parts;
}
