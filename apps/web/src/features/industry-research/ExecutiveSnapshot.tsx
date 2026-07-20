'use client';

import type { StructuredReport } from '@hopwhistle/shared';

import { Meter, ScoreRing } from './ui/charts';
import { SearchHighlight } from './ui/highlight';
import { deriveReasonsAgainst, deriveReasonsFor, deriveRecommendation } from './ui/report-helpers';

function verdictClass(v: string): string {
  return v === 'GO' ? 'ir-verdict-go' : v === 'DO_NOT_ENTER' ? 'ir-verdict-no' : 'ir-verdict-cond';
}

/**
 * A sharp, visual executive snapshot at the very top of the report: the verdict,
 * score, confidence, capital, speed, the single best opportunity, the top reason
 * for and against, and the recommended next action — instantly scannable.
 */
export function ExecutiveSnapshot({
  report,
  maxBudgetUsd,
  query = '',
}: {
  report: StructuredReport;
  maxBudgetUsd: number;
  query?: string;
}) {
  const v = report.executiveVerdict;
  const top = report.rankedOpportunities[0];
  const H = ({ text }: { text: string }) => <SearchHighlight text={text} query={query} />;
  const nextAction = top
    ? `Start with ${v.bestSegment}: ${top.opportunity}.`
    : `Focus on ${v.bestSegment} — ${v.biggestOpportunity}.`;

  return (
    <div className="ir-panel" style={{ padding: 0, overflow: 'hidden' }}>
      <div
        style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 160px', gap: 0 }}
        className="ir-snap-grid"
      >
        {/* Left: verdict + narrative */}
        <div style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span className={`ir-verdict ${verdictClass(v.verdict)}`} style={{ fontSize: 13 }}>
              <H text={v.verdict.replace(/_/g, ' ')} />
            </span>
            <span className="ir-muted" style={{ fontSize: 12 }}>
              {report.reportMetadata.industry} · {report.reportMetadata.geography}
            </span>
          </div>

          <p style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.45, margin: '12px 0 0' }}>
            <H text={v.oneSentenceConclusion || deriveRecommendation(report)} />
          </p>

          {/* Metric tiles */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
              gap: 10,
              marginTop: 16,
            }}
          >
            <Tile label="Capital required" value={v.initialCapital} q={query} />
            <Tile label="Time to revenue" value={v.timeToFirstRevenue} q={query} />
            <Tile
              label="Best opportunity"
              value={top?.opportunity ?? v.biggestOpportunity}
              q={query}
            />
            <Tile label="Max authorized" value={`$${maxBudgetUsd.toFixed(2)}`} q={query} />
          </div>

          {/* Top reason for / against */}
          <div
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 16 }}
            className="ir-snap-reasons"
          >
            <ReasonBlock
              cls="ir-pos"
              title="Top reason to pursue"
              items={deriveReasonsFor(report).slice(0, 1)}
              q={query}
            />
            <ReasonBlock
              cls="ir-neg"
              title="Top reason to avoid"
              items={deriveReasonsAgainst(report).slice(0, 1)}
              q={query}
            />
          </div>

          {/* Recommended next action */}
          <div
            style={{
              marginTop: 16,
              padding: '10px 12px',
              borderRadius: 5,
              background: 'color-mix(in srgb, var(--ir-accent) 8%, transparent)',
              border: '1px solid color-mix(in srgb, var(--ir-accent) 30%, transparent)',
            }}
          >
            <div className="ir-eyebrow" style={{ color: 'var(--ir-accent)' }}>
              Recommended next action
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, marginTop: 3 }}>
              <H text={nextAction} />
            </div>
          </div>
        </div>

        {/* Right: score + confidence */}
        <div
          style={{
            padding: 20,
            borderLeft: '1px solid var(--ir-border)',
            background: 'var(--ir-surface-2)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 14,
            justifyContent: 'center',
          }}
          className="ir-snap-score"
        >
          <ScoreRing score={v.overallScore} size={120} />
          <div style={{ width: '100%' }}>
            <Meter value={v.confidence} label="Confidence" />
          </div>
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, q }: { label: string; value: string; q: string }) {
  return (
    <div style={{ border: '1px solid var(--ir-border)', borderRadius: 4, padding: '8px 10px' }}>
      <div className="ir-strip-label">{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2, lineHeight: 1.3 }}>
        <SearchHighlight text={value} query={q} />
      </div>
    </div>
  );
}

function ReasonBlock({
  cls,
  title,
  items,
  q,
}: {
  cls: string;
  title: string;
  items: string[];
  q: string;
}) {
  return (
    <div>
      <div className={`ir-eyebrow ${cls}`}>{title}</div>
      <p style={{ fontSize: 13, lineHeight: 1.45, marginTop: 4 }}>
        {items[0] ? (
          <SearchHighlight text={items[0]} query={q} />
        ) : (
          <span className="ir-muted">—</span>
        )}
      </p>
    </div>
  );
}
