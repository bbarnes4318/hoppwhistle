'use client';

import { useState, type CSSProperties } from 'react';

import type { ReportResponse } from '@/features/industry-research/api';
import { InstitutionalReport } from '@/features/industry-research/InstitutionalReport';
import { InstitutionalReportV2 } from '@/features/industry-research/InstitutionalReportV2';

/**
 * Dev preview shell — a small toggle to compare the current report and V2 from
 * the same fixture. Content is full-bleed (breaks out of the centered research
 * container) so V2 renders at true responsive widths.
 */
export function V2Preview({ report, runId }: { report: ReportResponse; runId: string }) {
  const [view, setView] = useState<'v2' | 'current' | 'embedded'>('v2');

  // "Embedded" reproduces exactly how RunView renders V2 inside the research
  // app shell (no full-bleed break-out) so the in-app layout can be verified.
  if (view === 'embedded') {
    return (
      <>
        <PreviewBar view={view} setView={setView} />
        <InstitutionalReportV2 report={report} runId={runId} embedded />
      </>
    );
  }

  return (
    <div style={{ width: '100vw', marginLeft: 'calc(50% - 50vw)', minHeight: '80vh' }}>
      <PreviewBar view={view} setView={setView} />

      {view === 'v2' ? (
        <InstitutionalReportV2 report={report} runId={runId} />
      ) : (
        <div data-product="industry-research" style={{ height: '100vh' }}>
          <InstitutionalReport report={report} runId={runId} />
        </div>
      )}
    </div>
  );
}

function PreviewBar({
  view,
  setView,
}: {
  view: 'v2' | 'current' | 'embedded';
  setView: (v: 'v2' | 'current' | 'embedded') => void;
}) {
  return (
    <div
      className="ir-noprint rv-noprint"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 80,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        padding: '6px 16px',
        background: '#111417',
        color: '#e8e6e1',
        fontSize: 12.5,
      }}
    >
      <strong style={{ letterSpacing: '0.04em' }}>DEV PREVIEW</strong>
      <span style={{ opacity: 0.65 }}>fixture d8253e89 · not production</span>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
        <button onClick={() => setView('current')} style={tabStyle(view === 'current')}>
          Current
        </button>
        <button onClick={() => setView('v2')} style={tabStyle(view === 'v2')}>
          V2 (full width)
        </button>
        <button onClick={() => setView('embedded')} style={tabStyle(view === 'embedded')}>
          V2 in app shell
        </button>
      </div>
    </div>
  );
}

function tabStyle(active: boolean): CSSProperties {
  return {
    padding: '4px 12px',
    borderRadius: 5,
    border: `1px solid ${active ? '#3ba17f' : '#333'}`,
    background: active ? '#183a30' : 'transparent',
    color: active ? '#7fe0bd' : '#cfcdc8',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  };
}
