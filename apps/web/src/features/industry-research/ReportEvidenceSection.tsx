'use client';

import type { StructuredReport } from '@hopwhistle/shared';
import { useState } from 'react';

import { CategoryCoverage, ClassificationBar, ConfidenceMaterialityPlot, SourceProvenance } from './charts-v2';
import { HL, Inline } from './report-md';
import { buildSourcePreview } from './ui/report-helpers';
import { evidenceStats, sourceStats } from './v2-derive';

const CAUSE_LABEL: Record<string, string> = {
  definition: 'Definition',
  date: 'Date',
  geography: 'Geography',
  segment: 'Segment',
  methodology: 'Methodology',
  vendor_bias: 'Vendor bias',
  sample_bias: 'Sample bias',
  genuine_uncertainty: 'Genuine uncertainty',
};

/**
 * Evidence & Sources — near the end (progressive disclosure). An evidence
 * profile built from the claim ledger + source list, the confidence assessment,
 * reconciled contradictions, open questions, and a scannable source workspace
 * whose rows are anchor targets for the inline `[…-src-N]` citations.
 */
export function ReportEvidenceSection({
  report,
  query = '',
  onCite,
}: {
  report: StructuredReport;
  query?: string;
  onCite?: (id: string) => void;
}) {
  const ev = evidenceStats(report);
  const src = sourceStats(report);
  const [showAll, setShowAll] = useState(false);
  const sources = showAll ? report.sources : report.sources.slice(0, 12);

  return (
    <div>
      {/* Evidence profile */}
      <div className="rv-eyebrow" style={{ marginBottom: 'var(--rv-3)' }}>
        Evidence profile · {ev.total} claims · {src.total} sources
      </div>
      <div className="rv-evidence-grid">
        {Object.keys(ev.classificationCounts).length > 0 && (
          <div className="rv-card" style={{ padding: 'var(--rv-4)' }}>
            <div className="rv-h3" style={{ marginBottom: 4 }}>How solid is the evidence?</div>
            <p className="rv-micro rv-muted" style={{ marginBottom: 'var(--rv-3)' }}>Claims by classification</p>
            <ClassificationBar counts={ev.classificationCounts} />
          </div>
        )}
        {ev.points.length >= 3 && (
          <div className="rv-card" style={{ padding: 'var(--rv-4)' }}>
            <div className="rv-h3" style={{ marginBottom: 4 }}>Are high-stakes claims supported?</div>
            <p className="rv-micro rv-muted" style={{ marginBottom: 'var(--rv-2)' }}>
              Each claim by confidence × materiality
            </p>
            <ConfidenceMaterialityPlot points={ev.points} />
          </div>
        )}
        {Object.keys(ev.categoryCounts).length > 0 && (
          <div className="rv-card" style={{ padding: 'var(--rv-4)' }}>
            <div className="rv-h3" style={{ marginBottom: 4 }}>Where is the research focused?</div>
            <p className="rv-micro rv-muted" style={{ marginBottom: 'var(--rv-3)' }}>Claims by topic</p>
            <CategoryCoverage counts={ev.categoryCounts} />
          </div>
        )}
        {src.total > 0 && (
          <div className="rv-card" style={{ padding: 'var(--rv-4)' }}>
            <div className="rv-h3" style={{ marginBottom: 4 }}>Who sourced the evidence?</div>
            <p className="rv-micro rv-muted" style={{ marginBottom: 'var(--rv-3)' }}>Sources by research provider</p>
            <SourceProvenance byProvider={src.byProvider} validated={src.validated} total={src.total} />
          </div>
        )}
      </div>

      {report.confidenceAssessment && (
        <div className="rv-callout" style={{ marginTop: 'var(--rv-5)' }}>
          <span className="rv-eyebrow" style={{ flexShrink: 0, paddingTop: 2 }}>Confidence</span>
          <p className="rv-small" style={{ margin: 0, lineHeight: 1.6 }}>
            <HL text={report.confidenceAssessment} query={query} />
          </p>
        </div>
      )}

      {/* Contradictions + Unknowns */}
      {(report.contradictions.length > 0 || report.unknowns.length > 0) && (
        <div className="rv-two-col" style={{ marginTop: 'var(--rv-6)' }}>
          {report.contradictions.length > 0 && (
            <div>
              <div className="rv-eyebrow" style={{ marginBottom: 'var(--rv-3)' }}>Reconciled conflicts</div>
              <div className="rv-stack-gap">
                {report.contradictions.map((c, i) => (
                  <div className="rv-card" style={{ padding: 'var(--rv-4)' }} key={i}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                      <div className="rv-h3" style={{ minWidth: 0 }}><HL text={c.topic} query={query} /></div>
                      <span className="rv-chip" style={{ flexShrink: 0 }}>{CAUSE_LABEL[c.cause] ?? c.cause}</span>
                    </div>
                    <p className="rv-micro rv-dim" style={{ marginTop: 6 }}><strong>A:</strong> <Inline text={c.positionA} query={query} onCite={onCite} /></p>
                    <p className="rv-micro rv-dim" style={{ marginTop: 3 }}><strong>B:</strong> <Inline text={c.positionB} query={query} onCite={onCite} /></p>
                    {c.resolution && <p className="rv-micro" style={{ marginTop: 6, color: 'var(--rv-ink)' }}><strong className="rv-accent">Resolved:</strong> <Inline text={c.resolution} query={query} onCite={onCite} /></p>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {report.unknowns.length > 0 && (
            <div>
              <div className="rv-eyebrow" style={{ marginBottom: 'var(--rv-3)' }}>Open questions to close</div>
              <div className="rv-stack-gap">
                {report.unknowns.map((u, i) => (
                  <div className="rv-card" style={{ padding: 'var(--rv-4)' }} key={i}>
                    <div className="rv-h3"><HL text={u.topic} query={query} /></div>
                    <p className="rv-micro rv-dim" style={{ marginTop: 5 }}><Inline text={u.whyItMatters} query={query} onCite={onCite} /></p>
                    <p className="rv-micro" style={{ marginTop: 5, color: 'var(--rv-ink-2)' }}><strong>How to close:</strong> <Inline text={u.howToObtain} query={query} onCite={onCite} /></p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Source workspace */}
      <div style={{ marginTop: 'var(--rv-6)' }}>
        <div className="rv-eyebrow" style={{ marginBottom: 'var(--rv-3)' }}>
          Sources ({report.sources.length})
        </div>
        <div className="rv-card" style={{ overflow: 'hidden' }}>
          <div className="rv-mdtable-wrap" style={{ border: 0, borderRadius: 0, margin: 0 }}>
            <table className="rv-table rv-mdtable">
              <thead>
                <tr>
                  <th style={{ width: 30 }}>#</th>
                  <th>Source</th>
                  <th>Provider</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s, i) => {
                  const p = buildSourcePreview(s);
                  return (
                    <tr key={s.sourceId} id={`rv-source-${s.sourceId}`}>
                      <td data-label="#" className="rv-num rv-muted">{i + 1}</td>
                      <td data-label="Source" style={{ minWidth: 220 }}>
                        <a href={s.url} target="_blank" rel="noreferrer noopener" style={{ color: 'var(--rv-ink)', fontWeight: 550, textDecoration: 'none' }}>
                          <HL text={p.domain} query={query} />
                        </a>
                        {p.title && p.title !== 'Not established' && !/^\d+$/.test(p.title) && (
                          <div className="rv-micro rv-muted rv-clamp-2"><HL text={p.title} query={query} /></div>
                        )}
                      </td>
                      <td data-label="Provider"><span className="rv-chip">{p.provider}</span></td>
                      <td data-label="Status">
                        <span className={s.validated ? 'rv-pos' : 'rv-muted'} style={{ fontSize: 12, fontWeight: 550 }}>
                          {s.validated ? 'Validated' : 'Unverified'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        {report.sources.length > 12 && (
          <button className="rv-btn rv-btn-ghost rv-noprint" style={{ marginTop: 'var(--rv-3)' }} onClick={() => setShowAll(s => !s)}>
            {showAll ? 'Show fewer' : `Show all ${report.sources.length} sources`}
          </button>
        )}
      </div>
    </div>
  );
}
