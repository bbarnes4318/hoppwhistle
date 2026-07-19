import type { AdversarialVerification, StructuredReport } from '@hopwhistle/shared';

export const NOT_ESTABLISHED = 'Not established';

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

/** Find the first sentence across the given sections that shares a distinctive
 *  word with the risk — used to surface existing mitigation/trigger language. */
function findSentence(report: StructuredReport, sectionRe: RegExp, risk: string): string | null {
  for (const s of report.sections) {
    if (!sectionRe.test(s.title) && !sectionRe.test(s.key)) continue;
    const sentences = s.markdown
      .replace(/[#*_`>]/g, '')
      .split(/(?<=[.!?])\s+/)
      .map(x => x.trim())
      .filter(Boolean);
    const hit = sentences.find(sen => sen.length > 15 && sen.length < 240 && overlaps(risk, sen));
    if (hit) return hit;
  }
  return null;
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
    const mitigation =
      findSentence(report, /entry|execution|thesis|regulat|operation|distribution|sales/i, text) ??
      NOT_ESTABLISHED;
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
  label: 'Attractive' | 'Conditional' | 'Unattractive';
  cls: string;
  sentence: string;
}

export function deriveEconomicVerdict(report: StructuredReport): EconomicVerdict {
  const v = report.executiveVerdict;
  const base = report.unitEconomicsScenarios.find(s => s.name === 'base');
  let label: EconomicVerdict['label'];
  let cls: string;
  if (v.verdict === 'DO_NOT_ENTER') {
    label = 'Unattractive';
    cls = 'ir-neg';
  } else if (v.verdict === 'GO' && v.overallScore >= 65) {
    label = 'Attractive';
    cls = 'ir-pos';
  } else {
    label = 'Conditional';
    cls = 'ir-warn';
  }
  const sentence =
    base?.notes?.trim() ||
    `The economics are ${label.toLowerCase()}: base-case gross margin ${base?.grossMargin ?? NOT_ESTABLISHED.toLowerCase()} and payback ${base?.paybackPeriod ?? NOT_ESTABLISHED.toLowerCase()} on ${v.initialCapital} of startup capital.`;
  return { label, cls, sentence };
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
