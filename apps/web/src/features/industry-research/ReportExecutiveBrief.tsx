'use client';

import type { StructuredReport } from '@hopwhistle/shared';

import { ScoreGauge, Meter } from './charts-v2';
import { HL } from './report-md';
import { factorsAgainst, factorsFor, leadValue, NOT_ESTABLISHED } from './v2-derive';

const VERDICT: Record<string, { key: 'go' | 'cond' | 'no'; label: string }> = {
  GO: { key: 'go', label: 'Go' },
  CONDITIONAL_GO: { key: 'cond', label: 'Conditional Go' },
  DO_NOT_ENTER: { key: 'no', label: 'Do not enter' },
};

/**
 * Executive Decision Brief — the first viewport. One dominant conclusion (verdict
 * + score) with a small set of clearly subordinate facts. Answers "what is the
 * decision and what do I do" in ~5 seconds.
 */
export function ReportExecutiveBrief({ report, query = '' }: { report: StructuredReport; query?: string }) {
  const v = report.executiveVerdict;
  const meta = report.reportMetadata;
  const vd = VERDICT[v.verdict] ?? { key: 'cond' as const, label: v.verdict.replace(/_/g, ' ') };
  const capital = leadValue(v.initialCapital);
  const time = leadValue(v.timeToFirstRevenue);
  const forFactor = factorsFor(report)[0];
  const againstFactor = factorsAgainst(report)[0];
  const top = report.rankedOpportunities[0];
  const nextAction = top
    ? `Start with ${leadValue(v.bestSegment).head} — pursue ${top.opportunity}.`
    : `Focus on ${leadValue(v.bestSegment).head} and validate ${v.biggestOpportunity}.`;

  const facts: Array<{ label: string; value: string; sub?: string }> = [
    { label: 'Initial capital', value: capital.head, sub: capital.sub },
    { label: 'Time to first revenue', value: time.head, sub: time.sub },
    { label: 'Best opportunity', value: v.biggestOpportunity },
    { label: 'Target customer', value: leadValue(v.bestCustomer).head, sub: leadValue(v.bestCustomer).sub },
  ];

  return (
    <div className="rv-card" style={{ padding: 'var(--rv-6)' }}>
      {/* Top: gauge + verdict + conclusion */}
      <div className="rv-brief-top">
        <div className="rv-brief-gauge">
          <ScoreGauge score={v.overallScore} verdictKey={vd.key} verdictLabel={vd.label} />
          <div style={{ marginTop: 'var(--rv-3)' }}>
            <Meter value={v.confidence} label="Analyst confidence" />
          </div>
        </div>
        <div className="rv-brief-headline">
          <div className="rv-eyebrow">Decision · {meta.mode.replace(/_/g, ' ')}</div>
          <div className={`rv-display rv-${vd.key}`} style={{ marginTop: 6 }}>
            {vd.label}
          </div>
          <p className="rv-lead" style={{ marginTop: 'var(--rv-3)' }}>
            <HL text={v.oneSentenceConclusion} query={query} />
          </p>
        </div>
      </div>

      <hr className="rv-hair" />

      {/* Subordinate facts */}
      <div className="rv-facts">
        {facts.map(f => (
          <div className="rv-fact" key={f.label}>
            <div className="rv-fact-label">{f.label}</div>
            <div className="rv-fact-value">
              <HL text={f.value || NOT_ESTABLISHED} query={query} />
            </div>
            {f.sub && (
              <div className="rv-fact-sub rv-clamp-2" title={f.sub}>
                <HL text={f.sub} query={query} />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* For / against teaser */}
      <div className="rv-brief-balance">
        <div className="rv-brief-side">
          <div className="rv-eyebrow rv-pos">Strongest reason to enter</div>
          <p className="rv-small" style={{ marginTop: 5 }}>
            <HL text={forFactor?.detail ?? NOT_ESTABLISHED} query={query} />
          </p>
        </div>
        <div className="rv-brief-side">
          <div className="rv-eyebrow rv-neg">Strongest reason not to</div>
          <p className="rv-small" style={{ marginTop: 5 }}>
            <HL text={againstFactor?.detail ?? NOT_ESTABLISHED} query={query} />
          </p>
        </div>
      </div>

      {/* Next action */}
      <div className="rv-callout rv-callout-accent" style={{ marginTop: 'var(--rv-5)' }}>
        <span className="rv-eyebrow rv-accent" style={{ flexShrink: 0, paddingTop: 2 }}>
          Next&nbsp;action
        </span>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 500, lineHeight: 1.5 }}>
          <HL text={nextAction} query={query} />
        </p>
      </div>
    </div>
  );
}
