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

const SCENARIOS = ['conservative', 'base', 'aggressive'] as const;
const ECON_ROWS: Array<{ key: 'asp' | 'grossMargin' | 'cac' | 'paybackPeriod' | 'ltv'; label: string }> = [
  { key: 'asp', label: 'Average ticket' },
  { key: 'grossMargin', label: 'Gross margin' },
  { key: 'cac', label: 'Customer acquisition cost' },
  { key: 'paybackPeriod', label: 'CAC payback' },
  { key: 'ltv', label: 'Lifetime value' },
];

/**
 * Economics. Leads with the downside/base/upside comparison when the synthesis
 * quantified it, then the capital figure, the economics narrative and the
 * stated assumptions. Reports produced before the structured-output contract
 * carry no scenario figures at all — those fall back to the narrative and are
 * labelled honestly rather than shown as an empty grid.
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

      {/* Downside / base / upside comparison, when the synthesis quantified it */}
      {quantified && (
        <div style={{ marginBottom: 'var(--rv-5)' }}>
          <div className="rv-eyebrow" style={{ marginBottom: 'var(--rv-3)' }}>
            Downside · base · upside
          </div>
          <div className="rv-card" style={{ overflow: 'hidden' }}>
            <div className="rv-mdtable-wrap" style={{ border: 0, borderRadius: 0, margin: 0 }}>
              <table className="rv-table rv-mdtable">
                <thead>
                  <tr>
                    <th style={{ width: '30%' }}>Metric</th>
                    {SCENARIOS.map(n => (
                      <th key={n} className="rv-num" style={{ textTransform: 'capitalize' }}>
                        {n}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ECON_ROWS.map(row => (
                    <tr key={row.key}>
                      <td data-label="Metric">{row.label}</td>
                      {SCENARIOS.map(n => {
                        const s = report.unitEconomicsScenarios.find(x => x.name === n);
                        const val = s?.[row.key];
                        return (
                          <td key={n} data-label={n} className="rv-num">
                            {val ? (
                              <HL text={val} query={query} />
                            ) : (
                              <span className="rv-muted">{NOT_ESTABLISHED}</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {/* Assumption + what breaks each case */}
          <div className="rv-three-col" style={{ marginTop: 'var(--rv-3)' }}>
            {SCENARIOS.map(n => {
              const s = report.unitEconomicsScenarios.find(x => x.name === n);
              if (!s?.notes) return null;
              return (
                <div className="rv-panel" style={{ padding: 'var(--rv-3)' }} key={n}>
                  <div className="rv-eyebrow" style={{ textTransform: 'capitalize' }}>
                    {n}
                  </div>
                  <p className="rv-micro rv-dim" style={{ marginTop: 4, lineHeight: 1.5 }}>
                    <HL text={s.notes} query={query} />
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
