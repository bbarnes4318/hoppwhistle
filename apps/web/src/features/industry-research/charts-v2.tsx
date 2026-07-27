'use client';

/**
 * Report V2 visualizations — dependency-free, honest, and driven only by fields
 * that exist in the structured report. Every chart answers one documented
 * question (see REPORT_V2_PLAN.md §4) and renders nothing when the data does
 * not support it. Colours come from the `--rv-*` tokens so the whole report
 * reads as one system.
 *
 * SVG is used only where geometry matters (gauge, scatter); everything else is
 * CSS so text stays crisp and responsive at every width.
 */

const SEMANTIC: Record<string, string> = {
  go: 'var(--rv-go)',
  cond: 'var(--rv-cond)',
  no: 'var(--rv-no)',
};

function polar(cx: number, cy: number, r: number, deg: number) {
  const a = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}
function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const s = polar(cx, cy, r, endDeg);
  const e = polar(cx, cy, r, startDeg);
  const large = endDeg - startDeg <= 180 ? '0' : '1';
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 0 ${e.x} ${e.y}`;
}

/** Q: How strong is the overall case? — overallScore (0–100), verdict → colour. */
export function ScoreGauge({
  score,
  verdictKey,
  verdictLabel,
}: {
  score: number;
  verdictKey: 'go' | 'cond' | 'no';
  verdictLabel: string;
}) {
  const START = -135;
  const END = 135;
  const clamped = Math.max(0, Math.min(100, score));
  const valueDeg = START + (END - START) * (clamped / 100);
  const color = SEMANTIC[verdictKey];
  return (
    <svg
      className="rv-svg-chart"
      viewBox="0 0 200 176"
      width="100%"
      style={{ maxWidth: 200 }}
      role="img"
      aria-label={`Overall score ${clamped} out of 100 — ${verdictLabel}`}
    >
      <path d={arcPath(100, 100, 78, START, END)} fill="none" stroke="var(--rv-line-strong)" strokeWidth="12" strokeLinecap="round" />
      <path d={arcPath(100, 100, 78, START, valueDeg)} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round" />
      <text x="100" y="96" textAnchor="middle" fontSize="46" fontWeight="700" fill="var(--rv-ink)" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {clamped}
      </text>
      <text x="100" y="116" textAnchor="middle" fontSize="12" fill="var(--rv-ink-3)" fontWeight="600" letterSpacing="0.06em">
        / 100
      </text>
      <text x="100" y="150" textAnchor="middle" fontSize="13" fontWeight="700" fill={color} letterSpacing="0.03em">
        {verdictLabel.toUpperCase()}
      </text>
    </svg>
  );
}

/** A slim labelled meter (0–1) — e.g. analyst confidence. */
export function Meter({
  value,
  label,
  color = 'var(--rv-accent)',
}: {
  value: number;
  label: string;
  color?: string;
}) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
        <span className="rv-eyebrow">{label}</span>
        <span className="rv-num" style={{ fontSize: 13, fontWeight: 700 }}>
          {pct}%
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: 'var(--rv-surface-3)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 999 }} />
      </div>
    </div>
  );
}

/** Q: Which entry paths rank highest, and by how much? — rank/name/score. */
export function OpportunityRanking({
  data,
  onSelect,
}: {
  data: Array<{ rank: number; label: string; score: number }>;
  onSelect?: (rank: number) => void;
}) {
  if (data.length < 2) return null;
  const max = Math.max(...data.map(d => d.score), 100);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {data.map(d => {
        const pct = Math.round((d.score / max) * 100);
        const top = d.rank === 1;
        const rowStyle = {
          display: 'block',
          width: '100%',
          textAlign: 'left' as const,
          padding: 0,
          border: 0,
          background: 'transparent',
          cursor: onSelect ? 'pointer' : 'default',
          font: 'inherit',
          color: 'inherit',
        };
        const inner = (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
              <span
                className="rv-num"
                style={{
                  flexShrink: 0,
                  width: 18,
                  fontSize: 11,
                  fontWeight: 700,
                  color: top ? 'var(--rv-accent)' : 'var(--rv-ink-3)',
                }}
              >
                {d.rank}
              </span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: top ? 650 : 500, lineHeight: 1.35 }}>
                {d.label}
              </span>
              <span className="rv-num" style={{ flexShrink: 0, fontSize: 13, fontWeight: 700 }}>
                {d.score}
              </span>
            </div>
            <div style={{ height: 7, borderRadius: 999, background: 'var(--rv-surface-3)', marginLeft: 26, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  borderRadius: 999,
                  background: top ? 'var(--rv-accent)' : 'color-mix(in srgb, var(--rv-accent) 45%, var(--rv-line-strong))',
                }}
              />
            </div>
          </>
        );
        return onSelect ? (
          <button
            key={d.rank}
            onClick={() => onSelect(d.rank)}
            aria-label={`Opportunity ${d.rank}: ${d.label}, score ${d.score} of 100`}
            style={rowStyle}
          >
            {inner}
          </button>
        ) : (
          <div key={d.rank} style={rowStyle}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}

/** Q: How solid is the evidence base? — claim classification composition. */
const CLASS_META: Record<string, { label: string; color: string }> = {
  verified_fact: { label: 'Verified fact', color: 'var(--rv-pos)' },
  reported_experience: { label: 'Reported experience', color: 'var(--rv-info)' },
  estimate: { label: 'Estimate', color: 'var(--rv-warn)' },
  unverified_industry_claim: { label: 'Unverified claim', color: 'var(--rv-neg)' },
  contested: { label: 'Contested', color: 'var(--rv-ink-3)' },
};
export function ClassificationBar({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts).filter(([, n]) => n > 0);
  const total = entries.reduce((a, [, n]) => a + n, 0);
  if (!total) return null;
  return (
    <div>
      <div style={{ display: 'flex', height: 12, borderRadius: 999, overflow: 'hidden', border: '1px solid var(--rv-line)' }}>
        {entries.map(([k, n]) => {
          const m = CLASS_META[k] ?? { label: k, color: 'var(--rv-ink-3)' };
          return <div key={k} title={`${m.label}: ${n}`} style={{ width: `${(n / total) * 100}%`, background: m.color }} />;
        })}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 10 }}>
        {entries.map(([k, n]) => {
          const m = CLASS_META[k] ?? { label: k, color: 'var(--rv-ink-3)' };
          return (
            <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: m.color }} />
              <span className="rv-dim">{m.label}</span>
              <span className="rv-num" style={{ fontWeight: 700 }}>
                {n}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** Q: Are the high-stakes claims well supported? — confidence × materiality. */
export function ConfidenceMaterialityPlot({
  points,
}: {
  points: Array<{ confidence: number; materiality: number; classification: string }>;
}) {
  if (points.length < 3) return null;
  const W = 320;
  const H = 240;
  const pad = 34;
  const x = (c: number) => pad + c * (W - pad - 12);
  const y = (m: number) => H - pad - m * (H - pad - 12);
  return (
    <div>
      <svg className="rv-svg-chart" viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
        aria-label="Scatter plot of evidence claims by confidence and materiality">
        {/* quadrant guide at 0.5 */}
        <line x1={x(0.5)} y1={12} x2={x(0.5)} y2={H - pad} stroke="var(--rv-line)" strokeDasharray="3 3" />
        <line x1={pad} y1={y(0.5)} x2={W - 12} y2={y(0.5)} stroke="var(--rv-line)" strokeDasharray="3 3" />
        {/* axes */}
        <line x1={pad} y1={H - pad} x2={W - 12} y2={H - pad} stroke="var(--rv-line-strong)" />
        <line x1={pad} y1={12} x2={pad} y2={H - pad} stroke="var(--rv-line-strong)" />
        {/* "watch" zone label: high materiality, low confidence (top-left) */}
        <text x={pad + 6} y={24} fontSize="9.5" fill="var(--rv-neg)" fontWeight="600">
          High stakes · low confidence
        </text>
        {points.map((p, i) => {
          const m = CLASS_META[p.classification] ?? { color: 'var(--rv-ink-3)' };
          return <circle key={i} cx={x(p.confidence)} cy={y(p.materiality)} r="5" fill={m.color} fillOpacity="0.78"
            stroke="var(--rv-surface)" strokeWidth="1" />;
        })}
        <text x={(W + pad) / 2} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--rv-ink-3)" fontWeight="600">
          Confidence →
        </text>
        <text x={12} y={(H - pad) / 2} textAnchor="middle" fontSize="10" fill="var(--rv-ink-3)" fontWeight="600"
          transform={`rotate(-90 12 ${(H - pad) / 2})`}>
          Materiality →
        </text>
      </svg>
    </div>
  );
}

/** Q: Where is the research concentrated or thin? — claim category counts. */
export function CategoryCoverage({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  if (!entries.length) return null;
  const max = Math.max(...entries.map(([, n]) => n));
  const pretty = (k: string) => k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {entries.map(([k, n]) => (
        <div key={k} style={{ display: 'grid', gridTemplateColumns: '128px 1fr 22px', gap: 8, alignItems: 'center' }}>
          <span className="rv-small rv-dim" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {pretty(k)}
          </span>
          <span style={{ height: 8, borderRadius: 999, background: 'var(--rv-surface-3)', overflow: 'hidden' }}>
            <span style={{ display: 'block', width: `${(n / max) * 100}%`, height: '100%', borderRadius: 999, background: 'var(--rv-accent)' }} />
          </span>
          <span className="rv-num rv-small" style={{ textAlign: 'right', fontWeight: 700 }}>
            {n}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Q: Who found the evidence, and how much is validated? — provider + validated. */
const PROVIDER_LABEL: Record<string, string> = {
  google: 'Google',
  perplexity: 'Perplexity',
  xai: 'xAI',
  anthropic: 'Anthropic',
};
const PROVIDER_COLOR: Record<string, string> = {
  google: 'var(--rv-info)',
  perplexity: 'var(--rv-accent)',
  xai: 'var(--rv-ink-2)',
  anthropic: 'var(--rv-warn)',
};
export function SourceProvenance({
  byProvider,
  validated,
  total,
}: {
  byProvider: Record<string, number>;
  validated: number;
  total: number;
}) {
  const entries = Object.entries(byProvider).filter(([, n]) => n > 0);
  if (!total) return null;
  const validPct = Math.round((validated / total) * 100);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={{ display: 'flex', height: 12, borderRadius: 999, overflow: 'hidden', border: '1px solid var(--rv-line)' }}>
          {entries.map(([k, n]) => (
            <div key={k} title={`${PROVIDER_LABEL[k] ?? k}: ${n}`} style={{ width: `${(n / total) * 100}%`, background: PROVIDER_COLOR[k] ?? 'var(--rv-ink-3)' }} />
          ))}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 10 }}>
          {entries.map(([k, n]) => (
            <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: PROVIDER_COLOR[k] ?? 'var(--rv-ink-3)' }} />
              <span className="rv-dim">{PROVIDER_LABEL[k] ?? k}</span>
              <span className="rv-num" style={{ fontWeight: 700 }}>
                {n}
              </span>
            </span>
          ))}
        </div>
      </div>
      <div>
        <Meter value={validated / total} label={`Sources URL-validated (${validated} of ${total})`} color="var(--rv-pos)" />
        {validPct < 100 && (
          <p className="rv-micro rv-muted" style={{ marginTop: 6 }}>
            Validation confirms the source URL resolves; it does not certify the claim.
          </p>
        )}
      </div>
    </div>
  );
}
