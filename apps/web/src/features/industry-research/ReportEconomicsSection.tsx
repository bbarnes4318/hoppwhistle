'use client';

import type { StructuredReport } from '@hopwhistle/shared';

import { HL, ReportMarkdown } from './report-md';
import { deriveEconomicVerdict } from './ui/report-helpers';
import { findSection, leadValue, NOT_ESTABLISHED } from './v2-derive';

const VERDICT_TONE: Record<string, string> = {
  Attractive: 'pos',
  Conditional: 'warn',
  Unattractive: 'neg',
  'Not established': 'muted',
};

/**
 * Economics. The structured unit-economics scenarios are name-only in real
 * reports, so this presents the capital figure, the economics narrative (which
 * carries the actual per-job and scenario figures as text), the stated
 * assumptions, and an honest label when unit economics were not quantified —
 * never a fabricated scenario table.
 */
export function ReportEconomicsSection({
  report,
  query = '',
  onCite,
}: {
  report: StructuredReport;
  query?: string;
  onCite?: (id: string) => void;
}) {
  const v = report.executiveVerdict;
  const capital = leadValue(v.initialCapital);
  const econ = deriveEconomicVerdict(report);
  const tone = VERDICT_TONE[econ.label] ?? 'muted';
  const prose = findSection(report, /economics/i);
  const quantified = report.unitEconomicsScenarios.some(
    s => s.grossMargin || s.cac || s.paybackPeriod || s.ltv || s.asp
  );

  return (
    <div>
      {/* Headline strip: capital + economic verdict */}
      <div className="rv-two-col" style={{ marginBottom: 'var(--rv-5)' }}>
        <div className="rv-panel" style={{ padding: 'var(--rv-5)' }}>
          <div className="rv-eyebrow">Capital to start</div>
          <div className="rv-display rv-num" style={{ marginTop: 6 }}>
            <HL text={capital.head} query={query} />
          </div>
          {capital.sub && (
            <p className="rv-small rv-dim" style={{ marginTop: 6 }}>
              <HL text={capital.sub} query={query} />
            </p>
          )}
        </div>
        <div className="rv-panel" style={{ padding: 'var(--rv-5)' }}>
          <div className="rv-eyebrow">Economic read</div>
          <div className={`rv-h2 rv-${tone === 'muted' ? 'muted' : tone}`} style={{ marginTop: 6 }}>
            <HL text={econ.label} query={query} />
          </div>
          <p className="rv-small rv-dim" style={{ marginTop: 6 }}>
            <HL text={econ.sentence} query={query} />
          </p>
        </div>
      </div>

      {/* Real figures live in the economics narrative */}
      {prose && (
        <div style={{ marginBottom: 'var(--rv-5)' }}>
          <div className="rv-eyebrow" style={{ marginBottom: 'var(--rv-3)' }}>
            Scenario economics
          </div>
          <ReportMarkdown markdown={prose.markdown} query={query} onCite={onCite} />
        </div>
      )}

      {!quantified && (
        <p className="rv-micro rv-muted" style={{ marginBottom: 'var(--rv-5)' }}>
          Unit economics (gross margin, CAC, payback, LTV) were reported as narrative estimates rather than a
          structured scenario table, so they are shown as text above and marked {NOT_ESTABLISHED} where a precise
          figure was not established.
        </p>
      )}

      {/* Assumptions */}
      {report.assumptions.length > 0 && (
        <div>
          <div className="rv-eyebrow" style={{ marginBottom: 'var(--rv-3)' }}>
            Key economic assumptions
          </div>
          <div className="rv-card" style={{ overflow: 'hidden' }}>
            <div className="rv-mdtable-wrap" style={{ border: 0, borderRadius: 0, margin: 0 }}>
              <table className="rv-table rv-mdtable">
                <thead>
                  <tr>
                    <th style={{ width: '26%' }}>Assumption</th>
                    <th style={{ width: '22%' }}>Value</th>
                    <th>Rationale</th>
                  </tr>
                </thead>
                <tbody>
                  {report.assumptions.map((a, i) => (
                    <tr key={i}>
                      <td data-label="Assumption">
                        <HL text={a.field} query={query} />
                      </td>
                      <td data-label="Value">
                        <HL text={a.value} query={query} />
                      </td>
                      <td data-label="Rationale" className="rv-dim">
                        <HL text={a.rationale} query={query} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
