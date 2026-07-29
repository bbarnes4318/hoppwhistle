'use client';

import type { ResearchRunSummary } from '@hopwhistle/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { researchApi } from './api';

function modeLabel(m: string): string {
  return m === 'rapid_scan' ? 'Rapid Scan' : m === 'forensic_max' ? 'Forensic' : 'Full DD';
}

function verdictClass(v?: string | null): string {
  return v === 'GO' ? 'ir-verdict-go' : v === 'DO_NOT_ENTER' ? 'ir-verdict-no' : 'ir-verdict-cond';
}

function statusDot(s: string): string {
  if (s === 'completed') return 'ir-dot-pos';
  if (s === 'failed' || s === 'budget_exceeded') return 'ir-dot-neg';
  if (['queued', 'planning', 'running', 'waiting'].includes(s)) return 'ir-dot-warn';
  return 'ir-dot-muted';
}

function statusLabel(s: string): string {
  const map: Record<string, string> = {
    completed: 'Completed',
    failed: 'Failed',
    budget_exceeded: 'Paused — budget',
    running: 'In progress',
    queued: 'Queued',
    planning: 'Planning',
    waiting: 'Waiting',
    canceled: 'Canceled',
  };
  return map[s] ?? s;
}

export function InvestigationHistory() {
  const [runs, setRuns] = useState<ResearchRunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    researchApi
      .listRuns()
      .then(setRuns)
      .catch(e => setError(String(e?.message ?? e)));
  }, []);

  const forbidden = !!error && /forbidden|admin|401|403|not enabled/i.test(error);

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          marginBottom: 18,
        }}
      >
        <div>
          <div className="ir-eyebrow">Market-entry due diligence</div>
          <h1 className="ir-h1" style={{ marginTop: 4 }}>
            Investigations
          </h1>
        </div>
        <Link href="/tools/industry-research/new" className="ir-btn ir-btn-primary">
          New investigation
        </Link>
      </div>

      {forbidden ? (
        <div className="ir-panel" style={{ padding: 32, textAlign: 'center' }}>
          <div className="ir-h3">Owner or Admin access required</div>
          <p className="ir-muted" style={{ marginTop: 6, fontSize: 14 }}>
            If you have an Owner or Admin role and still see this, sign out and back in to refresh
            your session.
          </p>
        </div>
      ) : error ? (
        <div className="ir-panel" style={{ padding: 24, fontSize: 14 }}>
          <span className="ir-neg">Couldn’t load investigations.</span>{' '}
          <span className="ir-muted">{error}</span>
        </div>
      ) : runs === null ? (
        <div className="ir-panel" style={{ padding: 0 }}>
          {[0, 1, 2, 3].map(i => (
            <div
              key={i}
              style={{
                height: 46,
                borderTop: i ? '1px solid var(--ir-border)' : 0,
                background: 'linear-gradient(90deg, transparent, var(--ir-surface-2), transparent)',
                opacity: 0.6,
              }}
            />
          ))}
        </div>
      ) : runs.length === 0 ? (
        <div className="ir-panel" style={{ padding: 40, textAlign: 'center' }}>
          <div className="ir-h3">No investigations yet</div>
          <p className="ir-muted" style={{ margin: '6px auto 16px', maxWidth: 420, fontSize: 14 }}>
            Choose a market and depth, and we’ll build the evidence and the decision for you.
          </p>
          <Link href="/tools/industry-research/new" className="ir-btn ir-btn-primary">
            Start your first investigation
          </Link>
        </div>
      ) : (
        <div className="ir-panel" style={{ overflowX: 'auto' }}>
          <table className="ir-table">
            <thead>
              <tr>
                <th>Industry</th>
                <th>Market</th>
                <th>Depth</th>
                <th>Status</th>
                <th>Verdict</th>
                <th className="ir-num">Score</th>
                <th className="ir-num">Cost</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {runs.map(r => (
                <tr
                  key={r.id}
                  className="ir-clickable"
                  onClick={() => {
                    window.location.href = `/tools/industry-research/${r.id}`;
                  }}
                >
                  <td>
                    <Link
                      href={`/tools/industry-research/${r.id}`}
                      style={{ color: 'var(--ir-text)', fontWeight: 600, textDecoration: 'none' }}
                      onClick={e => e.stopPropagation()}
                    >
                      {r.industry}
                    </Link>
                    {r.provenance && r.provenance.executionType !== 'fresh' && (
                      <span className="ir-eyebrow" style={{ marginLeft: 8 }}>
                        {r.provenance.executionType === 'replay'
                          ? 'Replay'
                          : r.provenance.executionType.replace(/_/g, ' ')}
                      </span>
                    )}
                  </td>
                  <td className="ir-muted">{r.geography}</td>
                  <td>{modeLabel(r.mode)}</td>
                  <td>
                    <span className="ir-status">
                      <span className={`ir-dot ${statusDot(r.status)}`} />
                      {statusLabel(r.status)}
                    </span>
                  </td>
                  <td>
                    {r.verdict ? (
                      <span className={`ir-verdict ${verdictClass(r.verdict)}`}>
                        {r.verdict.replace(/_/g, ' ')}
                      </span>
                    ) : (
                      <span className="ir-muted">—</span>
                    )}
                  </td>
                  <td className="ir-num" style={{ fontWeight: 600 }}>
                    {r.overallScore != null ? r.overallScore : '—'}
                  </td>
                  <td className="ir-num ir-muted">${(r.accruedCostUsd ?? 0).toFixed(2)}</td>
                  <td className="ir-muted">
                    {new Date(r.createdAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="ir-muted" style={{ marginTop: 14, fontSize: 12 }}>
        Every claim in a report is traceable to a real source. Multiple engines agreeing raises
        confidence only when their evidence is independent.
      </p>
    </div>
  );
}
