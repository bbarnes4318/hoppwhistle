'use client';

import type { AdversarialVerification, StructuredReport } from '@hopwhistle/shared';

import { HL, ReportMarkdown } from './report-md';
import { buildRiskRegister, NOT_ESTABLISHED } from './ui/report-helpers';
import { findSection } from './v2-derive';

function tone(value: string): string {
  if (value === 'High' || value === 'Likely') return 'neg';
  if (value === 'Possible' || value === 'Moderate') return 'warn';
  if (value === 'Low') return 'info';
  return 'muted';
}

function Classified({ value, query }: { value: string; query: string }) {
  if (value === NOT_ESTABLISHED) return <span className="rv-muted"><HL text={value} query={query} /></span>;
  const t = tone(value);
  return (
    <span className="rv-status">
      <span className="rv-dot" style={{ background: `var(--rv-${t === 'muted' ? 'ink-3' : t})` }} aria-hidden />
      <span className={`rv-${t}`}>
        <HL text={value} query={query} />
      </span>
    </span>
  );
}

/**
 * Risk & Kill Criteria. Leads with the single biggest risk, then the kill
 * criteria as prominent, visually distinct stop conditions (the thing a founder
 * must not miss), then the regulatory narrative, then the structured risk
 * register (which is intentionally sparse when the adversarial review flagged
 * nothing material — we do not pad it).
 */
export function ReportRiskSection({
  report,
  adversarial,
  query = '',
  onCite,
}: {
  report: StructuredReport;
  adversarial?: AdversarialVerification | null;
  query?: string;
  onCite?: (id: string) => void;
}) {
  const v = report.executiveVerdict;
  const kills = report.killCriteria;
  const rows = buildRiskRegister(report, adversarial ?? null);
  const regPr = findSection(report, /regulat|risk/i);

  return (
    <div>
      {v.biggestRisk && (
        <div className="rv-callout rv-callout-neg" style={{ marginBottom: 'var(--rv-5)' }}>
          <span className="rv-eyebrow rv-neg" style={{ flexShrink: 0, paddingTop: 2 }}>
            Biggest&nbsp;risk
          </span>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 500, lineHeight: 1.55 }}>
            <HL text={v.biggestRisk} query={query} />
          </p>
        </div>
      )}

      {/* Kill criteria — the stop conditions */}
      {kills.length > 0 && (
        <div style={{ marginBottom: 'var(--rv-6)' }}>
          <div className="rv-eyebrow rv-neg" style={{ marginBottom: 'var(--rv-3)' }}>
            Stop conditions — walk away if any of these prove true
          </div>
          <div className="rv-kill-grid">
            {kills.map((k, i) => (
              <div className="rv-kill" key={i}>
                <span className="rv-kill-n" aria-hidden>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="rv-kill-t">
                  <HL text={k} query={query} />
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Regulation & risk narrative */}
      {regPr && (
        <div style={{ marginBottom: 'var(--rv-6)' }}>
          <div className="rv-eyebrow" style={{ marginBottom: 'var(--rv-3)' }}>
            Regulatory &amp; liability detail
          </div>
          <ReportMarkdown markdown={regPr.markdown} query={query} onCite={onCite} />
        </div>
      )}

      {/* Risk register */}
      <div>
        <div className="rv-eyebrow" style={{ marginBottom: 'var(--rv-3)' }}>
          Risk register
        </div>
        {rows.length > 0 ? (
          <div className="rv-card" style={{ overflow: 'hidden' }}>
            <div className="rv-mdtable-wrap" style={{ border: 0, borderRadius: 0, margin: 0 }}>
              <table className="rv-table rv-mdtable">
                <thead>
                  <tr>
                    <th>Risk</th>
                    <th>Probability</th>
                    <th>Impact</th>
                    <th>Ability</th>
                    <th>Mitigation</th>
                    <th>Trigger</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td data-label="Risk" style={{ minWidth: 200, fontWeight: 550 }}>
                        <HL text={r.risk} query={query} />
                      </td>
                      <td data-label="Probability"><Classified value={r.probability} query={query} /></td>
                      <td data-label="Impact"><Classified value={r.impact} query={query} /></td>
                      <td data-label="Ability"><Classified value={r.ability} query={query} /></td>
                      <td data-label="Mitigation" className="rv-dim" style={{ minWidth: 180 }}>
                        <HL text={r.mitigation} query={query} />
                      </td>
                      <td data-label="Trigger" className="rv-dim" style={{ minWidth: 160 }}>
                        <HL text={r.trigger} query={query} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="rv-muted rv-small">The adversarial review did not flag additional material risks beyond the above.</p>
        )}
      </div>
    </div>
  );
}
