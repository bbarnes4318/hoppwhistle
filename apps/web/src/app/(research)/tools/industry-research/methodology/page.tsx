export const metadata = { title: 'Methodology — Industry Research' };

const STEPS: Array<{ n: string; h: string; b: string }> = [
  {
    n: '01',
    h: 'Independent primary and corroborating research',
    b: 'Two research engines investigate the market separately — one broad primary investigation and one independent corroboration that never sees the first — to surface conflicting data, gaps, and overstated claims.',
  },
  {
    n: '02',
    h: 'Operator and customer intelligence',
    b: 'A third stream gathers what operators, customers, and employees actually say across the open web and social platforms, capturing recurring themes rather than cherry-picked anecdotes.',
  },
  {
    n: '03',
    h: 'Adjudicated synthesis',
    b: 'The evidence is reconciled into a single decision report: duplication removed, weak claims challenged, conflicts resolved, primary sources preferred, and key estimates recomputed with the math shown.',
  },
  {
    n: '04',
    h: 'Independent verification',
    b: 'Two independent reviewers audit the draft — one for factual accuracy and citations, one adversarially trying to disprove the recommendation. A third adjudicates any material conflict.',
  },
  {
    n: '05',
    h: 'Validation, repair, and publication',
    b: 'The report passes deterministic checks. If a reviewer finds a fixable defect, a single targeted repair pass corrects only the affected sections and is re-verified — always within the authorized budget — before publication.',
  },
];

export default function Page() {
  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div className="ir-eyebrow">Methodology</div>
      <h1 className="ir-h1" style={{ marginTop: 4 }}>
        How every investigation is produced
      </h1>
      <p className="ir-muted" style={{ marginTop: 6, fontSize: 14, lineHeight: 1.6 }}>
        Every conclusion is traceable to a real, cited source. Multiple independent engines agree
        only when their evidence is independent — agreement raises confidence, it does not
        manufacture it. No substitute or fabricated data is ever used; if a stage cannot complete,
        the investigation stops rather than guessing.
      </p>
      <div style={{ marginTop: 24 }}>
        {STEPS.map(s => (
          <div
            key={s.n}
            style={{
              display: 'flex',
              gap: 16,
              padding: '18px 0',
              borderTop: '1px solid var(--ir-border)',
            }}
          >
            <div className="ir-section-no" style={{ width: 28, flexShrink: 0 }}>
              {s.n}
            </div>
            <div>
              <div className="ir-h3">{s.h}</div>
              <p className="ir-muted" style={{ marginTop: 4, fontSize: 14, lineHeight: 1.6 }}>
                {s.b}
              </p>
            </div>
          </div>
        ))}
      </div>
      <p className="ir-muted" style={{ marginTop: 24, fontSize: 12 }}>
        The specific research providers, models, source counts, verification details, and full cost
        provenance for any individual investigation are available in that report’s{' '}
        <strong>Methodology &amp; audit trail</strong> section.
      </p>
    </div>
  );
}
