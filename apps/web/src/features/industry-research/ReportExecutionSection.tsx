'use client';

import type { StructuredReport } from '@hopwhistle/shared';

import { HL, Inline, ReportMarkdown } from './report-md';
import { findSection, parseTimeline } from './v2-derive';

/**
 * 30/60/90-day execution. The ninety-day plan is prose organised by period; we
 * parse it into an actual timeline (period → what happens). The validation-tests
 * narrative follows. Where the plan can't be parsed into periods, the full
 * narrative is rendered rather than an empty timeline.
 */
export function ReportExecutionSection({
  report,
  query = '',
  onCite,
}: {
  report: StructuredReport;
  query?: string;
  onCite?: (id: string) => void;
}) {
  const plan = findSection(report, /ninety_day|90.?day|execution/i);
  const phases = parseTimeline(plan?.markdown);
  const validation = findSection(report, /validation/i);

  return (
    <div>
      {phases.length >= 2 ? (
        <ol className="rv-timeline">
          {phases.map((p, i) => (
            <li className="rv-tl-item" key={i}>
              <span className="rv-tl-dot" aria-hidden />
              <div className="rv-tl-label">
                <HL text={p.label} query={query} />
              </div>
              <p className="rv-tl-body rv-small">
                <Inline text={p.body} query={query} onCite={onCite} />
              </p>
            </li>
          ))}
        </ol>
      ) : (
        plan && <ReportMarkdown markdown={plan.markdown} query={query} onCite={onCite} />
      )}

      {validation && (
        <div style={{ marginTop: 'var(--rv-6)' }}>
          <div className="rv-eyebrow" style={{ marginBottom: 'var(--rv-3)' }}>
            Validation tests to run first
          </div>
          <ReportMarkdown markdown={validation.markdown} query={query} onCite={onCite} />
        </div>
      )}
    </div>
  );
}
