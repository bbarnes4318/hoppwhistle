import type { StructuredReport } from '@hopwhistle/shared';

import {
  buildRiskRegister,
  deriveEconomicVerdict,
  deriveReasonsAgainst,
  deriveReasonsFor,
  firstSectionSentence,
} from './report-helpers';

// ---- Narrative helpers (real report data → analyst-grade prose) -----------

export function verdictPhrase(verdict: string): string {
  return verdict === 'GO'
    ? 'a GO'
    : verdict === 'DO_NOT_ENTER'
      ? 'a DO-NOT-ENTER'
      : 'a CONDITIONAL GO';
}

function nextAction(report: StructuredReport): string {
  const v = report.executiveVerdict;
  const top = report.rankedOpportunities[0];
  return top
    ? `focus on ${v.bestSegment} and pursue ${top.opportunity}`
    : `focus on ${v.bestSegment} and validate ${v.biggestOpportunity}`;
}

export type BriefingMode = 'executive' | 'opportunity' | 'risk' | 'execution';

export const BRIEFING_MODES: Array<{ id: BriefingMode; label: string; blurb: string }> = [
  { id: 'executive', label: 'Executive briefing', blurb: 'The decision in 60 seconds' },
  { id: 'opportunity', label: 'Best opportunity', blurb: 'Why the top path stands out' },
  { id: 'risk', label: 'Risk briefing', blurb: 'How this could fail' },
  { id: 'execution', label: 'Execution briefing', blurb: 'What to do first' },
];

/**
 * Build a tight, confident, analyst-tone spoken script for a briefing mode,
 * entirely from the structured report. No filler, no AI disclaimers.
 */
export function buildBriefingScript(report: StructuredReport, mode: BriefingMode): string {
  const v = report.executiveVerdict;
  const meta = report.reportMetadata;
  const reasonsFor = deriveReasonsFor(report);
  const reasonsAgainst = deriveReasonsAgainst(report);
  const top = report.rankedOpportunities[0];
  const risks = buildRiskRegister(report, null);
  const econ = deriveEconomicVerdict(report);

  const s: string[] = [];

  if (mode === 'executive') {
    s.push(
      `Here's the bottom line on ${meta.industry} in ${meta.geography}. The verdict is ${verdictPhrase(v.verdict)}, scoring ${v.overallScore} out of 100 at ${Math.round(v.confidence * 100)} percent confidence.`
    );
    if (reasonsFor[0]) s.push(`The strongest reason to pursue this: ${reasonsFor[0]}.`);
    if (reasonsFor[1]) s.push(`It also helps that ${lower(reasonsFor[1])}.`);
    if (reasonsAgainst[0])
      s.push(`Be clear-eyed about the downside — ${lower(reasonsAgainst[0])}.`);
    if (reasonsAgainst[1]) s.push(`And ${lower(reasonsAgainst[1])}.`);
    s.push(`The single best opportunity is ${v.biggestOpportunity}, aimed at ${v.bestCustomer}.`);
    s.push(`If you move forward, your first action is to ${nextAction(report)}.`);
    if (v.oneSentenceConclusion) s.push(`Net: ${v.oneSentenceConclusion}`);
  }

  if (mode === 'opportunity') {
    if (!top) {
      s.push(
        `The report did not rank a standout entry opportunity for ${meta.industry}, so treat the entry path as unresolved.`
      );
    } else {
      s.push(
        `The strongest way into ${meta.industry} is ${top.opportunity}, ranked number one with an opportunity score of ${top.opportunityScore} out of 100.`
      );
      if (top.customer) s.push(`Your target customer is ${top.customer}.`);
      if (top.revenueModel || top.offer)
        s.push(
          `Revenue comes from ${lower(top.revenueModel ?? top.offer ?? 'the core offer')}${top.price ? `, priced around ${top.price}` : ''}.`
        );
      const speed = top.timeToFirstRevenue ?? v.timeToFirstRevenue;
      const cap = top.startupCost ?? v.initialCapital;
      if (speed || cap)
        s.push(
          `Expect first revenue in about ${speed ?? 'an unestablished window'}, on roughly ${cap ?? 'unestablished'} of startup capital.`
        );
      if (top.salesDifficulty) s.push(`Difficulty is ${lower(top.salesDifficulty)}.`);
      if (v.biggestRisk) s.push(`The main risk to watch is ${lower(v.biggestRisk)}.`);
    }
  }

  if (mode === 'risk') {
    s.push(`Here's how ${meta.industry} could go wrong.`);
    if (v.biggestRisk) s.push(`The biggest single threat is ${lower(v.biggestRisk)}.`);
    const material = risks.filter(rk => rk.impact === 'High').slice(0, 2);
    material.forEach(rk => s.push(`Also watch this: ${lower(rk.risk)}.`));
    if (report.killCriteria[0]) {
      s.push(`Set hard stops. Walk away if ${lower(report.killCriteria[0])}.`);
      if (report.killCriteria[1]) s.push(`Also walk away if ${lower(report.killCriteria[1])}.`);
    }
    s.push(`Economically, the model looks ${lower(econ.label)}. ${econ.sentence}`);
  }

  if (mode === 'execution') {
    s.push(`Here's how to start on ${meta.industry} without overcommitting.`);
    s.push(`First, ${nextAction(report)}.`);
    const validate = firstSectionSentence(report, /validation|first.customer|execution/i);
    if (validate) s.push(`Validate this first: ${lower(validate)}`);
    s.push(
      `In the first 30 days, prove demand with real paying customers before you build fixed costs.`
    );
    s.push(`By day 60, turn what works into a repeatable sales motion.`);
    s.push(
      `By day 90, scale only what has already proven out — and hold the line on your kill criteria.`
    );
  }

  return s.join(' ').replace(/\s+/g, ' ').trim();
}

function lower(t: string): string {
  return t ? t.charAt(0).toLowerCase() + t.slice(1).replace(/\.$/, '') : t;
}

// ---- Chart-data derivations (only when the data supports it) ---------------

export interface BarDatum {
  label: string;
  value: number;
  display?: string;
}

/** Opportunity scores, ranked — for a comparison bar chart. Empty when <2 opps. */
export function opportunityBars(report: StructuredReport): BarDatum[] {
  if (report.rankedOpportunities.length < 2) return [];
  return report.rankedOpportunities.slice(0, 6).map(o => ({
    label: o.opportunity,
    value: o.opportunityScore,
    display: String(o.opportunityScore),
  }));
}

/** Capital vs speed-to-revenue per opportunity (parsed) — omitted when unparseable. */
export interface CapitalSpeedDatum {
  label: string;
  capital: number;
  months: number;
}
export function capitalVsSpeed(report: StructuredReport): CapitalSpeedDatum[] {
  const num = (s?: string) => {
    if (!s) return null;
    const m = s.replace(/,/g, '').match(/(\d+(\.\d+)?)\s*([kKmM]?)/);
    if (!m) return null;
    let n = parseFloat(m[1]);
    if (/k/i.test(m[3])) n *= 1000;
    if (/m/i.test(m[3])) n *= 1_000_000;
    return n;
  };
  const months = (s?: string) => {
    if (!s) return null;
    const n = parseFloat(s.replace(/,/g, ''));
    if (Number.isNaN(n)) return null;
    if (/week/i.test(s)) return n / 4.3;
    if (/day/i.test(s)) return n / 30;
    if (/year/i.test(s)) return n * 12;
    return n;
  };
  const out: CapitalSpeedDatum[] = [];
  for (const o of report.rankedOpportunities.slice(0, 6)) {
    const capital = num(o.startupCost);
    const m = months(o.timeToFirstRevenue);
    if (capital != null && m != null) out.push({ label: o.opportunity, capital, months: m });
  }
  return out.length >= 2 ? out : [];
}

/** Risk register cells for a probability × impact matrix. */
export interface RiskCell {
  risk: string;
  probability: string;
  impact: string;
}
export function riskMatrixCells(
  report: StructuredReport,
  adversarial: Parameters<typeof buildRiskRegister>[1]
): RiskCell[] {
  return buildRiskRegister(report, adversarial).map(r => ({
    risk: r.risk,
    probability: r.probability,
    impact: r.impact,
  }));
}
