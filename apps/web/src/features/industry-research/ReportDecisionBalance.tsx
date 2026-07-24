'use client';

import type { StructuredReport } from '@hopwhistle/shared';

import { HL } from './report-md';
import { factorsAgainst, factorsFor, type Factor } from './v2-derive';

/**
 * Why it can work / why it can fail — a balanced two-sided decision aid built
 * from the report's biggest opportunity + top ranked paths (for) and biggest
 * risk + kill criteria (against). Each factor shows a concise title, the full
 * statement, and whether it's a primary or supporting consideration.
 */
export function ReportDecisionBalance({ report, query = '' }: { report: StructuredReport; query?: string }) {
  const forF = factorsFor(report);
  const againstF = factorsAgainst(report);
  return (
    <div className="rv-two-col">
      <Side title="Why this can work" tone="pos" factors={forF} query={query} />
      <Side title="Why this can fail" tone="neg" factors={againstF} query={query} />
    </div>
  );
}

function Side({
  title,
  tone,
  factors,
  query,
}: {
  title: string;
  tone: 'pos' | 'neg';
  factors: Factor[];
  query: string;
}) {
  return (
    <div>
      <div className={`rv-eyebrow rv-${tone}`} style={{ marginBottom: 'var(--rv-3)' }}>
        {title}
      </div>
      <div className="rv-stack-gap">
        {factors.length === 0 && <p className="rv-muted rv-small">Not established.</p>}
        {factors.map((f, i) => (
          <div
            key={i}
            className="rv-card"
            style={{ padding: 'var(--rv-4)', borderLeft: `3px solid var(--rv-${tone})` }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, justifyContent: 'space-between' }}>
              <div className="rv-h3" style={{ minWidth: 0 }}>
                <HL text={f.title} query={query} />
              </div>
              <span className={`rv-chip rv-chip-${tone === 'pos' ? 'pos' : 'neg'}`} style={{ flexShrink: 0 }}>
                {f.weight}
              </span>
            </div>
            <p className="rv-small rv-dim" style={{ marginTop: 6, lineHeight: 1.55 }}>
              <HL text={f.detail} query={query} />
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
