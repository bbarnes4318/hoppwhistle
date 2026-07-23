'use client';

import type { BarDatum, CapitalSpeedDatum, RiskCell } from './report-story';

// Lightweight, dependency-free SVG charts. Colours come from the scoped IR
// tokens so they match the institutional palette in light and dark.

const ACCENT = 'var(--ir-accent)';
const POS = 'var(--ir-positive)';
const WARN = 'var(--ir-warning)';
const NEG = 'var(--ir-negative)';
const BORDER = 'var(--ir-border)';
const TEXT2 = 'var(--ir-text-2)';

function scoreColor(score: number): string {
  return score >= 70 ? POS : score >= 45 ? WARN : NEG;
}

/** Radial score ring, 0–100. */
export function ScoreRing({
  score,
  size = 132,
  label = 'Overall score',
}: {
  score: number;
  size?: number;
  label?: string;
}) {
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`${label}: ${score} of 100`}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={BORDER}
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={scoreColor(score)}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text
          x="50%"
          y="47%"
          textAnchor="middle"
          dominantBaseline="central"
          style={{ fontSize: 30, fontWeight: 700, fill: 'var(--ir-text)' }}
        >
          {score}
        </text>
        <text x="50%" y="66%" textAnchor="middle" style={{ fontSize: 11, fill: TEXT2 }}>
          / 100
        </text>
      </svg>
    </div>
  );
}

/** Horizontal confidence/attractiveness meter, 0–1. */
export function Meter({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 11,
          color: TEXT2,
          marginBottom: 4,
        }}
      >
        <span>{label}</span>
        <span className="ir-num">{Math.round(pct)}%</span>
      </div>
      <div
        style={{ height: 8, borderRadius: 4, background: BORDER, overflow: 'hidden' }}
        role="img"
        aria-label={`${label}: ${Math.round(pct)} percent`}
      >
        <div style={{ width: `${pct}%`, height: '100%', background: ACCENT }} />
      </div>
    </div>
  );
}

/** Ranked horizontal bar comparison (e.g. opportunity scores). */
export function BarCompare({ data, max = 100 }: { data: BarDatum[]; max?: number }) {
  if (!data.length) return null;
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {data.map((d, i) => {
        const pct = Math.max(2, Math.min(100, (d.value / max) * 100));
        return (
          <div key={i}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 8,
                fontSize: 12,
                marginBottom: 3,
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {d.label}
              </span>
              <span className="ir-num" style={{ color: TEXT2 }}>
                {d.display ?? d.value}
              </span>
            </div>
            <div
              style={{ height: 10, borderRadius: 3, background: BORDER, overflow: 'hidden' }}
              role="img"
              aria-label={`${d.label}: ${d.display ?? d.value}`}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  background:
                    i === 0 ? ACCENT : 'color-mix(in srgb, var(--ir-accent) 55%, transparent)',
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Capital (x) vs months-to-revenue (y) scatter — lower-left is best. */
export function CapitalSpeedScatter({
  data,
  width = 320,
  height = 200,
}: {
  data: CapitalSpeedDatum[];
  width?: number;
  height?: number;
}) {
  if (data.length < 2) return null;
  const pad = 34;
  const maxCap = Math.max(...data.map(d => d.capital)) * 1.1 || 1;
  const maxMon = Math.max(...data.map(d => d.months)) * 1.1 || 1;
  const x = (c: number) => pad + (c / maxCap) * (width - pad - 12);
  const y = (m: number) => height - pad - (m / maxMon) * (height - pad - 12);
  const fmtCap = (n: number) => (n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`);
  return (
    <svg
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Startup capital versus time to first revenue by opportunity"
    >
      <line x1={pad} y1={height - pad} x2={width - 6} y2={height - pad} stroke={BORDER} />
      <line x1={pad} y1={6} x2={pad} y2={height - pad} stroke={BORDER} />
      <text
        x={width - 6}
        y={height - pad + 16}
        textAnchor="end"
        style={{ fontSize: 10, fill: TEXT2 }}
      >
        capital →
      </text>
      <text x={pad - 6} y={12} textAnchor="end" style={{ fontSize: 10, fill: TEXT2 }}>
        months
      </text>
      {data.map((d, i) => (
        <g key={i}>
          <circle
            cx={x(d.capital)}
            cy={y(d.months)}
            r={6}
            fill={i === 0 ? ACCENT : 'color-mix(in srgb, var(--ir-accent) 45%, transparent)'}
          />
          <text
            x={x(d.capital)}
            y={y(d.months) - 9}
            textAnchor="middle"
            style={{ fontSize: 9, fill: TEXT2 }}
          >
            {fmtCap(d.capital)}·{Math.round(d.months)}mo
          </text>
        </g>
      ))}
    </svg>
  );
}

/** Probability × impact risk matrix. */
export function RiskMatrix({ cells }: { cells: RiskCell[] }) {
  const probOrder = ['Likely', 'Possible', 'Low', 'Not established'];
  const impactOrder = ['High', 'Moderate', 'Not established'];
  const norm = (s: string, order: string[]) => {
    const i = order.indexOf(s);
    return i < 0 ? order.length - 1 : i;
  };
  const counts: Record<string, number> = {};
  for (const c of cells)
    counts[`${norm(c.probability, probOrder)}-${norm(c.impact, impactOrder)}`] =
      (counts[`${norm(c.probability, probOrder)}-${norm(c.impact, impactOrder)}`] ?? 0) + 1;
  if (!cells.length) return null;
  const cellColor = (p: number, im: number) => {
    const sev = probOrder.length - 1 - p + (impactOrder.length - 1 - im);
    return sev >= 4 ? NEG : sev >= 2 ? WARN : 'var(--ir-surface-2)';
  };
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr>
            <th style={{ padding: 4 }} />
            {impactOrder.map(im => (
              <th key={im} style={{ padding: 4, color: TEXT2, fontWeight: 500 }}>
                {im}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {probOrder.map((p, pi) => (
            <tr key={p}>
              <td style={{ padding: 4, color: TEXT2, whiteSpace: 'nowrap' }}>{p}</td>
              {impactOrder.map((im, ii) => {
                const n = counts[`${pi}-${ii}`] ?? 0;
                return (
                  <td key={im} style={{ padding: 0 }}>
                    <div
                      style={{
                        width: 46,
                        height: 34,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: n ? cellColor(pi, ii) : 'transparent',
                        border: `1px solid ${BORDER}`,
                        color: 'var(--ir-text)',
                        fontWeight: 600,
                      }}
                      title={`${p} probability · ${im} impact: ${n} risk(s)`}
                    >
                      {n || ''}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Simple 30/60/90 execution timeline. */
export function Timeline({ phases }: { phases: Array<{ label: string; detail: string }> }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${phases.length}, 1fr)`,
        gap: 0,
        position: 'relative',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 7,
          left: '8%',
          right: '8%',
          height: 2,
          background: BORDER,
        }}
      />
      {phases.map((p, i) => (
        <div key={i} style={{ position: 'relative', textAlign: 'center', padding: '0 6px' }}>
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: '50%',
              background: ACCENT,
              margin: '0 auto 8px',
              position: 'relative',
              zIndex: 1,
            }}
          />
          <div style={{ fontSize: 12, fontWeight: 600 }}>{p.label}</div>
          <div style={{ fontSize: 11, color: TEXT2, marginTop: 2, lineHeight: 1.4 }}>
            {p.detail}
          </div>
        </div>
      ))}
    </div>
  );
}
