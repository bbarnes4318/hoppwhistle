'use client';

import type { RankedOpportunity, StructuredReport } from '@hopwhistle/shared';

import { OpportunityRanking } from './charts-v2';
import { HL, ReportMarkdown } from './report-md';
import { findSection } from './v2-derive';

/**
 * Opportunity Overview. The real report ranks opportunities by score but does
 * NOT carry per-opportunity customer/offer/capital fields, so the honest
 * comparison is a score ranking (relative gaps visible) plus a spotlight and the
 * ranked-opportunities narrative — never a fabricated matrix. Selecting a bar
 * opens a detail panel with the score context and entry narrative.
 */
export function ReportOpportunitySection({
  report,
  query = '',
  onOpen,
  onCite,
}: {
  report: StructuredReport;
  query?: string;
  onOpen: (o: RankedOpportunity) => void;
  onCite?: (id: string) => void;
}) {
  const opps = report.rankedOpportunities;
  const top = opps[0];
  const narrative = findSection(report, /ranked_opportunities|ranked entry/i);
  // Strip synthesis cross-reference placeholders (e.g. "See rankedOpportunities object.").
  const narrativeText = narrative?.markdown.replace(/\bSee\s+\w+\s+object\.?\s*/gi, '').trim();
  const bars = opps.map(o => ({ rank: o.rank, label: o.opportunity, score: o.opportunityScore }));
  // Reports synthesized before the structured-output contract carry only a name
  // and a score, so the comparison cards render only where detail exists.
  const detailed = opps.filter(o => o.customer || o.offer || o.startupCost || o.grossMarginRange);

  return (
    <div>
      {top && (
        <div className="rv-callout rv-callout-accent" style={{ marginBottom: 'var(--rv-5)', alignItems: 'center' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="rv-eyebrow rv-accent">Top-ranked entry</div>
            <div className="rv-h3" style={{ marginTop: 4 }}>
              <HL text={top.opportunity} query={query} />
            </div>
          </div>
          <button
            className="rv-btn rv-btn-primary rv-noprint"
            style={{ flexShrink: 0 }}
            onClick={() => onOpen(top)}
            aria-label={`Open detail for ${top.opportunity}`}
          >
            {top.opportunityScore} / 100 · Detail
          </button>
        </div>
      )}

      {/* Side-by-side comparison — only when the synthesis filled the detail
          fields. Cards (not a wide table) so it stays readable and never
          scrolls sideways. */}
      {detailed.length > 0 && (
        <div className="rv-opp-grid" style={{ marginBottom: 'var(--rv-5)' }}>
          {detailed.map(o => (
            <button
              key={o.rank}
              type="button"
              className="rv-card rv-opp-card"
              onClick={() => onOpen(o)}
              aria-label={`Open detail for ${o.opportunity}`}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span className="rv-num rv-accent" style={{ fontSize: 11, fontWeight: 700 }}>
                  #{o.rank}
                </span>
                <span className="rv-h3" style={{ flex: 1, minWidth: 0 }}>
                  <HL text={o.opportunity} query={query} />
                </span>
                <span className="rv-num" style={{ fontWeight: 700 }}>
                  {o.opportunityScore}
                </span>
              </div>
              <dl className="rv-opp-facts">
                {[
                  ['Customer', o.customer],
                  ['Offer', o.offer],
                  ['Price', o.price],
                  ['Capital', o.startupCost],
                  ['To revenue', o.timeToFirstRevenue],
                  ['Margin', o.grossMarginRange],
                  ['Difficulty', o.salesDifficulty],
                  ['Defensibility', o.defensibility],
                ].map(([label, val]) =>
                  val ? (
                    <div key={label as string}>
                      <dt>{label}</dt>
                      <dd>
                        <HL text={String(val)} query={query} />
                      </dd>
                    </div>
                  ) : null
                )}
              </dl>
            </button>
          ))}
        </div>
      )}

      <div className="rv-two-col">
        <div className="rv-card" style={{ padding: 'var(--rv-5)' }}>
          <div className="rv-eyebrow" style={{ marginBottom: 'var(--rv-4)' }}>
            Opportunity scores — ranked
          </div>
          <OpportunityRanking data={bars} onSelect={rank => {
            const o = opps.find(x => x.rank === rank);
            if (o) onOpen(o);
          }} />
          <p className="rv-micro rv-muted" style={{ marginTop: 'var(--rv-4)' }}>
            Scores are the report's composite ranking (0–100). Select a bar for the ranking context.
          </p>
        </div>

        {narrativeText && (
          <div style={{ minWidth: 0 }}>
            <div className="rv-eyebrow" style={{ marginBottom: 'var(--rv-3)' }}>
              How the paths compare
            </div>
            <ReportMarkdown markdown={narrativeText} query={query} onCite={onCite} />
          </div>
        )}
      </div>
    </div>
  );
}
