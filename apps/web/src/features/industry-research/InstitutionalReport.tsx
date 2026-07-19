'use client';

import type { RankedOpportunity, StructuredReport } from '@hopwhistle/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';

import { researchApi, type ReportResponse } from './api';
import { CostSummary } from './CostSummary';
import { SourcesWorkspace } from './SourcesWorkspace';
import { Highlight, highlightMarkdownComponents } from './ui/highlight';
import {
  buildRiskRegister,
  deriveEconomicVerdict,
  firstSectionSentence,
  NOT_ESTABLISHED,
} from './ui/report-helpers';

function verdictClass(v: string): string {
  return v === 'GO' ? 'ir-verdict-go' : v === 'DO_NOT_ENTER' ? 'ir-verdict-no' : 'ir-verdict-cond';
}
function reviewPhrase(v?: string): { label: string; cls: string } {
  switch (v) {
    case 'pass':
      return { label: 'Passed', cls: 'ir-pos' };
    case 'pass_with_caveats':
      return { label: 'Passed with caveats', cls: 'ir-warn' };
    case 'repair_required':
      return { label: 'Required corrections', cls: 'ir-warn' };
    case 'reject':
      return { label: 'Failed', cls: 'ir-neg' };
    default:
      return { label: '—', cls: 'ir-muted' };
  }
}

const CATEGORY_DEFS: Array<{ key: string; label: string; re: RegExp }> = [
  {
    key: 'market',
    label: 'Market attractiveness',
    re: /market|outsider|industry structure|sizing|demand size/i,
  },
  { key: 'customers', label: 'Customer and demand', re: /customer|buyer|persona/i },
  { key: 'competition', label: 'Competitive structure', re: /competit|rival|incumbent/i },
  {
    key: 'entry',
    label: 'Entry strategy',
    re: /entry|thesis|wedge|distribution|sales|go.to.market/i,
  },
  {
    key: 'operations',
    label: 'Operational requirements',
    re: /operator|operation|typical day|staffing|supply/i,
  },
  { key: 'regulatory', label: 'Regulatory and legal risk', re: /regulat|legal|licens|complian/i },
  { key: 'failure', label: 'Failure modes', re: /failure|dirt|fraud|what goes wrong/i },
  {
    key: 'firstcustomer',
    label: 'First-customer strategy',
    re: /first.customer|first 10|first ten/i,
  },
  { key: 'execution', label: '30/60/90-day plan', re: /90.day|execution|validation test|roadmap/i },
];

function firstSentences(md: string, max = 2): string {
  const plain = md
    .replace(/[#*_`>-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain
    .split(/(?<=[.!?])\s+/)
    .slice(0, max)
    .join(' ');
}
function money(n?: number): string {
  return n == null ? '—' : `$${n.toFixed(2)}`;
}

export function InstitutionalReport({
  runId,
  report,
  status = 'completed',
  accruedCostUsd = 0,
  maxBudgetUsd = 0,
}: {
  runId: string;
  report: ReportResponse;
  status?: string;
  accruedCostUsd?: number;
  maxBudgetUsd?: number;
}) {
  const r = report.structured;
  const v = r.executiveVerdict;
  const meta = r.reportMetadata;

  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [active, setActive] = useState('decision');
  const [drawer, setDrawer] = useState<RankedOpportunity | null>(null);
  const [copied, setCopied] = useState('');
  const [showTop, setShowTop] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [matchCount, setMatchCount] = useState(0);
  const [matchIdx, setMatchIdx] = useState(-1);

  const sectionEls = useRef<Record<string, HTMLElement | null>>({});
  const canvasRef = useRef<HTMLDivElement>(null);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const oppOpenerRef = useRef<HTMLElement | null>(null);
  const mobileOpenerRef = useRef<HTMLButtonElement>(null);
  const mobileCloseRef = useRef<HTMLButtonElement>(null);

  const q = query.trim().toLowerCase();
  const mdComponents = useMemo(() => highlightMarkdownComponents(q), [q]);

  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 700);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Active-section highlighting.
  useEffect(() => {
    const obs = new IntersectionObserver(
      entries => {
        const vis = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (vis?.target instanceof HTMLElement && vis.target.dataset.anchor)
          setActive(vis.target.dataset.anchor);
      },
      { rootMargin: '-64px 0px -70% 0px' }
    );
    Object.values(sectionEls.current).forEach(el => el && obs.observe(el));
    return () => obs.disconnect();
  });

  // Count matches after each render pass that changes the query or layout.
  useEffect(() => {
    const root = canvasRef.current;
    const marks = q && root ? root.querySelectorAll('[data-ir-mark]') : [];
    setMatchCount(marks.length);
    setMatchIdx(marks.length ? 0 : -1);
  }, [q, collapsed]);

  // Move to the active match (data attribute, not className → React won't clobber).
  useEffect(() => {
    const root = canvasRef.current;
    if (!root) return;
    const marks = Array.from(root.querySelectorAll<HTMLElement>('[data-ir-mark]'));
    marks.forEach(m => m.removeAttribute('data-ir-active'));
    if (matchIdx >= 0 && marks[matchIdx]) {
      marks[matchIdx].setAttribute('data-ir-active', '');
      marks[matchIdx].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [matchIdx, matchCount]);

  // Escape closes any open overlay; focus returns to the opener.
  useEffect(() => {
    if (!drawer && !mobileNav) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (drawer) closeDrawer();
      if (mobileNav) closeMobile();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawer, mobileNav]);

  useEffect(() => {
    if (drawer) drawerCloseRef.current?.focus();
  }, [drawer]);
  useEffect(() => {
    if (mobileNav) mobileCloseRef.current?.focus();
  }, [mobileNav]);

  const categories = useMemo(() => {
    const buckets = new Map<string, { label: string; sections: typeof r.sections }>();
    for (const c of CATEGORY_DEFS) buckets.set(c.key, { label: c.label, sections: [] });
    for (const s of r.sections) {
      const hit =
        CATEGORY_DEFS.find(c => c.re.test(s.title) || c.re.test(s.key)) ?? CATEGORY_DEFS[0];
      buckets.get(hit.key)!.sections.push(s);
    }
    return CATEGORY_DEFS.map(c => ({ key: c.key, ...buckets.get(c.key)! })).filter(
      c => c.sections.length > 0
    );
  }, [r.sections]);

  const recommendation = useMemo(() => {
    const thesis = r.sections.find(s => /thesis|recommend/i.test(s.title));
    if (thesis) return firstSentences(thesis.markdown, 2);
    return `${v.biggestOpportunity} — targeting ${v.bestCustomer} with ${v.bestBusinessModel}, beginning in ${meta.geography}.`;
  }, [r.sections, v, meta.geography]);

  const reasonsFor = [
    v.biggestOpportunity,
    ...r.rankedOpportunities.slice(0, 2).map(o => o.opportunity),
  ]
    .filter(Boolean)
    .slice(0, 3);
  const reasonsAgainst = [v.biggestRisk, ...r.killCriteria.slice(0, 2)].filter(Boolean).slice(0, 3);

  const riskRows = useMemo(
    () => buildRiskRegister(r, report.verification?.adversarial),
    [r, report.verification]
  );
  const econVerdict = useMemo(() => deriveEconomicVerdict(r), [r]);
  const base = r.unitEconomicsScenarios.find(s => s.name === 'base');
  const executionReminder =
    firstSectionSentence(r, /90.day|execution|validation|first.customer/i) ??
    'Validate demand with paying customers before committing to fixed costs.';

  const toggle = (k: string) =>
    setCollapsed(p => {
      const n = new Set(p);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const setAll = (c: boolean) => setCollapsed(c ? new Set(categories.map(x => x.key)) : new Set());

  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(''), 1400);
    } catch {
      /* noop */
    }
  };
  const goto = (id: string) => {
    sectionEls.current[id]?.scrollIntoView({ behavior: 'smooth' });
    closeMobile();
  };
  const dl = (fmt: 'markdown' | 'json') => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    fetch(researchApi.reportDownloadUrl(runId, fmt), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(res => res.blob())
      .then(b => {
        const url = URL.createObjectURL(b);
        const a = document.createElement('a');
        a.href = url;
        a.download = `industry-research-${runId}.${fmt === 'markdown' ? 'md' : 'json'}`;
        a.click();
        URL.revokeObjectURL(url);
      });
  };

  function openOpp(o: RankedOpportunity, opener: HTMLElement) {
    oppOpenerRef.current = opener;
    setDrawer(o);
  }
  function closeDrawer() {
    setDrawer(null);
    oppOpenerRef.current?.focus();
  }
  function closeMobile() {
    setMobileNav(false);
    mobileOpenerRef.current?.focus();
  }
  const stepMatch = (delta: number) =>
    setMatchIdx(i => (matchCount ? (i + delta + matchCount) % matchCount : -1));

  const navItems: Array<{ id: string; label: string; group?: string }> = [
    { id: 'decision', label: 'Decision summary', group: 'Summary' },
    ...categories.map((c, i) => ({
      id: c.key,
      label: c.label,
      group: i === 0 ? 'Analysis' : undefined,
    })),
    { id: 'economics', label: 'Economics', group: categories.length ? undefined : 'Analysis' },
    { id: 'opportunities', label: 'Opportunities' },
    { id: 'risks', label: 'Risks' },
    { id: 'review', label: 'Independent review', group: 'Verification' },
    { id: 'evidence', label: 'Evidence & sources', group: 'Support' },
    { id: 'methodology', label: 'Methodology & audit' },
  ];

  return (
    <div>
      {/* Identity row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          paddingBottom: 12,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div className="ir-eyebrow">Industry Research · {meta.mode.replace(/_/g, ' ')}</div>
          <h1 className="ir-h1" style={{ marginTop: 3 }}>
            {meta.industry}
          </h1>
          <div className="ir-muted" style={{ fontSize: 12, marginTop: 2 }}>
            {meta.geography} ·{' '}
            {new Date(report.createdAt).toLocaleDateString(undefined, {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}
          </div>
        </div>
        <div className="ir-noprint" style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button
            className="ir-btn"
            onClick={() => dl('markdown')}
            aria-label="Export report as Markdown"
          >
            Export
          </button>
          <button
            className="ir-btn"
            onClick={() => window.print()}
            aria-label="Print or save as PDF"
          >
            Print / Save PDF
          </button>
          <button
            className="ir-btn"
            onClick={() =>
              copy('share', typeof window !== 'undefined' ? window.location.href : runId)
            }
            aria-label="Copy shareable link"
          >
            {copied === 'share' ? 'Link copied' : 'Share'}
          </button>
        </div>
      </div>

      {/* Decision strip */}
      <div className="ir-strip">
        <div className="ir-strip-cell">
          <div className="ir-strip-label">Verdict</div>
          <div className="ir-strip-value">
            <span className={`ir-verdict ${verdictClass(v.verdict)}`}>
              {v.verdict.replace(/_/g, ' ')}
            </span>
          </div>
        </div>
        <StripCell label="Score" value={`${v.overallScore} / 100`} />
        <StripCell label="Confidence" value={`${Math.round(v.confidence * 100)}%`} />
        <StripCell label="Time to revenue" value={v.timeToFirstRevenue} />
        <StripCell label="Capital" value={v.initialCapital} />
        <StripCell label="Max authorized" value={money(maxBudgetUsd)} />
      </div>

      {/* Recommendation */}
      <div style={{ marginTop: 14, display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <div className="ir-eyebrow" style={{ flexShrink: 0, paddingTop: 2 }}>
          Recommended entry
        </div>
        <p style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.5, margin: 0 }}>
          {recommendation}
        </p>
        <button
          className="ir-btn ir-btn-ghost ir-noprint"
          style={{ flexShrink: 0, height: 26 }}
          onClick={() => copy('rec', recommendation)}
          aria-label="Copy recommendation"
        >
          {copied === 'rec' ? 'Copied' : 'Copy'}
        </button>
      </div>

      {/* Reasons for / against */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 24,
          marginTop: 16,
          paddingTop: 16,
          borderTop: '1px solid var(--ir-border)',
        }}
      >
        <ReasonCol title="Why this can work" cls="ir-pos" items={reasonsFor} />
        <ReasonCol title="Why this can fail" cls="ir-neg" items={reasonsAgainst} />
      </div>

      {/* Report body grid */}
      <div className="ir-report-grid" style={{ marginTop: 28 }}>
        <nav className="ir-nav-col" aria-label="Report sections">
          {navItems.map(it => (
            <div key={it.id}>
              {it.group && <div className="ir-nav-group">{it.group}</div>}
              <a
                className="ir-nav-link"
                data-active={active === it.id}
                href={`#ir-${it.id}`}
                onClick={e => {
                  e.preventDefault();
                  goto(it.id);
                }}
              >
                {it.label}
              </a>
            </div>
          ))}
        </nav>

        <div className="ir-canvas" ref={canvasRef}>
          {/* Search toolbar */}
          <div
            className="ir-noprint"
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              marginBottom: 8,
              flexWrap: 'wrap',
            }}
          >
            <input
              className="ir-field"
              style={{ height: 32, maxWidth: 240 }}
              placeholder="Search the report…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              aria-label="Search report"
            />
            {q && (
              <>
                <span className="ir-muted ir-num" style={{ fontSize: 12 }} aria-live="polite">
                  {matchCount ? `${matchIdx + 1} of ${matchCount}` : 'No matches'}
                </span>
                <button
                  className="ir-btn"
                  style={{ height: 32 }}
                  onClick={() => stepMatch(-1)}
                  disabled={!matchCount}
                  aria-label="Previous match"
                >
                  ‹
                </button>
                <button
                  className="ir-btn"
                  style={{ height: 32 }}
                  onClick={() => stepMatch(1)}
                  disabled={!matchCount}
                  aria-label="Next match"
                >
                  ›
                </button>
                <button
                  className="ir-btn ir-btn-ghost"
                  style={{ height: 32 }}
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                >
                  Clear
                </button>
              </>
            )}
            <button
              className="ir-btn"
              style={{ height: 32, marginLeft: 'auto' }}
              onClick={() => setAll(collapsed.size === 0)}
              aria-label={collapsed.size === 0 ? 'Collapse all sections' : 'Expand all sections'}
            >
              {collapsed.size === 0 ? 'Collapse all' : 'Expand all'}
            </button>
          </div>

          {/* Core analysis */}
          {categories.map(cat => {
            const isCollapsed = collapsed.has(cat.key) && !q;
            return (
              <section
                key={cat.key}
                id={`ir-${cat.key}`}
                data-anchor={cat.key}
                ref={el => {
                  sectionEls.current[cat.key] = el;
                }}
                className="ir-report-section"
              >
                <SectionHead
                  label={cat.label}
                  query={q}
                  collapsed={isCollapsed}
                  onToggle={() => toggle(cat.key)}
                  onCopy={() =>
                    copy(
                      cat.key,
                      cat.sections.map(s => `## ${s.title}\n\n${s.markdown}`).join('\n\n')
                    )
                  }
                  copied={copied === cat.key}
                />
                {!isCollapsed &&
                  cat.sections.map(s => (
                    <div key={s.key} style={{ marginTop: 14 }}>
                      {cat.sections.length > 1 && (
                        <div className="ir-h3">
                          <Highlight text={s.title} query={q} />
                        </div>
                      )}
                      <div className="ir-body" style={{ marginTop: 6 }}>
                        <ReactMarkdown components={mdComponents}>{s.markdown}</ReactMarkdown>
                      </div>
                    </div>
                  ))}
              </section>
            );
          })}

          {/* Economics */}
          <section
            id="ir-economics"
            data-anchor="economics"
            ref={el => {
              sectionEls.current.economics = el;
            }}
            className="ir-report-section"
          >
            <SectionHead label="Economics" query={q} />
            <EconomicsTable report={r} verdict={econVerdict} />
          </section>

          {/* Opportunities */}
          {r.rankedOpportunities.length > 0 && (
            <section
              id="ir-opportunities"
              data-anchor="opportunities"
              ref={el => {
                sectionEls.current.opportunities = el;
              }}
              className="ir-report-section"
            >
              <SectionHead label="Ranked entry opportunities" query={q} />
              <div style={{ overflowX: 'auto' }}>
                <table className="ir-table">
                  <thead>
                    <tr>
                      <th className="ir-num">Rank</th>
                      <th>Opportunity</th>
                      <th>Target customer</th>
                      <th>Offer</th>
                      <th>Revenue model</th>
                      <th>Startup capital</th>
                      <th>Time to revenue</th>
                      <th>Difficulty</th>
                      <th className="ir-num">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.rankedOpportunities.map(o => (
                      <tr
                        key={o.rank}
                        className="ir-clickable"
                        role="button"
                        tabIndex={0}
                        aria-label={`Open details for opportunity ${o.rank}: ${o.opportunity}`}
                        onClick={e => openOpp(o, e.currentTarget)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            openOpp(o, e.currentTarget);
                          }
                        }}
                      >
                        <td className="ir-num">{o.rank}</td>
                        <td style={{ fontWeight: 600 }}>{o.opportunity}</td>
                        <td className="ir-muted">{o.customer ?? '—'}</td>
                        <td className="ir-muted">{o.offer ?? '—'}</td>
                        <td className="ir-muted">{o.revenueModel ?? '—'}</td>
                        <td className="ir-muted">{o.startupCost ?? '—'}</td>
                        <td className="ir-muted">{o.timeToFirstRevenue ?? '—'}</td>
                        <td className="ir-muted">{o.salesDifficulty ?? '—'}</td>
                        <td className="ir-num" style={{ fontWeight: 600 }}>
                          {o.opportunityScore}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="ir-muted ir-noprint" style={{ marginTop: 8, fontSize: 12 }}>
                Select a row for evidence, risks, and the first-customer approach.
              </p>
            </section>
          )}

          {/* Risk register — six fields */}
          <section
            id="ir-risks"
            data-anchor="risks"
            ref={el => {
              sectionEls.current.risks = el;
            }}
            className="ir-report-section"
          >
            <SectionHead label="Risk register" query={q} />
            {riskRows.length > 0 ? (
              <div style={{ overflowX: 'auto' }}>
                <table className="ir-table">
                  <thead>
                    <tr>
                      <th>Risk</th>
                      <th>Probability</th>
                      <th>Impact</th>
                      <th>Ability to overcome</th>
                      <th>Mitigation</th>
                      <th>Trigger</th>
                    </tr>
                  </thead>
                  <tbody>
                    {riskRows.map((rk, i) => (
                      <tr key={i}>
                        <td style={{ minWidth: 200 }}>{rk.risk}</td>
                        <td>
                          <Classified value={rk.probability} />
                        </td>
                        <td>
                          <Classified value={rk.impact} />
                        </td>
                        <td>
                          <Classified value={rk.ability} />
                        </td>
                        <td className="ir-muted" style={{ minWidth: 180 }}>
                          {rk.mitigation}
                        </td>
                        <td className="ir-muted" style={{ minWidth: 160 }}>
                          {rk.trigger}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="ir-muted">No material risks were flagged by the adversarial review.</p>
            )}
            {r.killCriteria.length > 0 && (
              <div style={{ marginTop: 18 }}>
                <div className="ir-eyebrow ir-neg">Do not continue if</div>
                <ul style={{ margin: '8px 0 0', paddingLeft: 0, listStyle: 'none' }}>
                  {r.killCriteria.map((k, i) => (
                    <li key={i} style={{ display: 'flex', gap: 8, padding: '3px 0', fontSize: 14 }}>
                      <span className="ir-neg" aria-hidden>
                        ✕
                      </span>{' '}
                      {k}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {/* Independent review */}
          {report.verification && (
            <section
              id="ir-review"
              data-anchor="review"
              ref={el => {
                sectionEls.current.review = el;
              }}
              className="ir-report-section"
            >
              <SectionHead label="Independent review" query={q} />
              <IndependentReview report={report} />
            </section>
          )}

          {/* Evidence & sources */}
          <section
            id="ir-evidence"
            data-anchor="evidence"
            ref={el => {
              sectionEls.current.evidence = el;
            }}
            className="ir-report-section"
          >
            <SectionHead label="Evidence & sources" query={q} />
            <SourcesWorkspace sources={report.sources} evidence={report.evidence} />
          </section>

          {/* Methodology & audit trail */}
          <section
            id="ir-methodology"
            data-anchor="methodology"
            ref={el => {
              sectionEls.current.methodology = el;
            }}
            className="ir-report-section"
          >
            <details>
              <summary style={{ cursor: 'pointer' }}>
                <span className="ir-h2">Methodology &amp; audit trail</span>
              </summary>
              <div style={{ marginTop: 14 }}>
                {report.provenance && report.provenance.executionType !== 'fresh' && (
                  <p className="ir-muted" style={{ fontSize: 13, marginBottom: 10 }}>
                    Replay of an earlier investigation — research evidence was reused; synthesis and
                    verification were re-run. No new research charges were incurred.
                  </p>
                )}
                <p className="ir-muted" style={{ fontSize: 13, marginBottom: 12 }}>
                  Independently researched, synthesized, and verified from real, cited sources.
                  Synthesis engine: {report.synthesisProvider ?? '—'}
                  {report.synthesisModel ? ` (${report.synthesisModel})` : ''}. Schema{' '}
                  {meta.schemaVersion}.
                </p>
                <CostSummary
                  runId={runId}
                  status={status}
                  accruedCostUsd={accruedCostUsd}
                  maxBudgetUsd={maxBudgetUsd}
                />
                <div style={{ marginTop: 12, display: 'flex', gap: 6 }} className="ir-noprint">
                  <button className="ir-btn" onClick={() => dl('markdown')}>
                    Download Markdown
                  </button>
                  <button className="ir-btn" onClick={() => dl('json')}>
                    Download JSON
                  </button>
                </div>
              </div>
            </details>
          </section>
        </div>

        {/* Right rail — unique, decision-useful only (no duplicated Confidence/Print/Export) */}
        <aside className="ir-rail">
          <div className="ir-panel" style={{ padding: 14 }}>
            <div className="ir-eyebrow">Immediate next action</div>
            <p style={{ fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
              {r.rankedOpportunities[0]
                ? `Start with ${v.bestSegment}: ${r.rankedOpportunities[0].opportunity}.`
                : `Focus on ${v.bestSegment}.`}
            </p>
            <hr className="ir-divider" style={{ margin: '12px 0' }} />
            <div className="ir-eyebrow">Critical economic threshold</div>
            <p style={{ fontSize: 12, marginTop: 4, lineHeight: 1.45 }}>
              Base-case payback: {base?.paybackPeriod ?? NOT_ESTABLISHED}
              {base?.grossMargin ? ` · gross margin ${base.grossMargin}` : ''}
            </p>
            {r.killCriteria[0] && (
              <>
                <hr className="ir-divider" style={{ margin: '12px 0' }} />
                <div className="ir-eyebrow ir-neg">Critical kill criterion</div>
                <p style={{ fontSize: 12, marginTop: 4, lineHeight: 1.45 }}>{r.killCriteria[0]}</p>
              </>
            )}
            <hr className="ir-divider" style={{ margin: '12px 0' }} />
            <div className="ir-eyebrow">Execution reminder</div>
            <p style={{ fontSize: 12, marginTop: 4, lineHeight: 1.45 }}>{executionReminder}</p>
          </div>
        </aside>
      </div>

      {/* Mobile section navigator */}
      <button
        ref={mobileOpenerRef}
        className="ir-btn ir-btn-primary ir-noprint"
        style={{
          position: 'fixed',
          bottom: 20,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 40,
        }}
        data-ir-mobile-nav
        aria-haspopup="dialog"
        onClick={() => setMobileNav(true)}
      >
        Sections
      </button>
      {mobileNav && (
        <>
          <div className="ir-drawer-scrim" onClick={closeMobile} />
          <div
            className="ir-drawer"
            style={{ padding: 16 }}
            role="dialog"
            aria-modal="true"
            aria-label="Report sections"
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 10,
              }}
            >
              <div className="ir-h3">Jump to section</div>
              <button
                ref={mobileCloseRef}
                className="ir-btn ir-btn-ghost"
                onClick={closeMobile}
                aria-label="Close section navigator"
              >
                Close
              </button>
            </div>
            {navItems.map(it => (
              <a
                key={it.id}
                className="ir-nav-link"
                href={`#ir-${it.id}`}
                onClick={e => {
                  e.preventDefault();
                  goto(it.id);
                }}
              >
                {it.label}
              </a>
            ))}
          </div>
        </>
      )}

      {/* Opportunity drawer */}
      {drawer && (
        <>
          <div className="ir-drawer-scrim" onClick={closeDrawer} />
          <div
            className="ir-drawer"
            style={{ padding: 20 }}
            role="dialog"
            aria-modal="true"
            aria-label={`Opportunity ${drawer.rank}: ${drawer.opportunity}`}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
              <div className="ir-eyebrow">Opportunity #{drawer.rank}</div>
              <button
                ref={drawerCloseRef}
                className="ir-btn ir-btn-ghost"
                onClick={closeDrawer}
                aria-label="Close opportunity details"
              >
                Close
              </button>
            </div>
            <h3 className="ir-h2" style={{ marginTop: 6 }}>
              {drawer.opportunity}
            </h3>
            <table className="ir-table" style={{ marginTop: 12 }}>
              <tbody>
                <DrawerRow k="Target customer" val={drawer.customer} />
                <DrawerRow k="Offer" val={drawer.offer} />
                <DrawerRow k="Revenue model" val={drawer.revenueModel} />
                <DrawerRow k="Price" val={drawer.price} />
                <DrawerRow k="Startup capital" val={drawer.startupCost} />
                <DrawerRow k="Time to MVP" val={drawer.timeToMvp} />
                <DrawerRow k="Time to revenue" val={drawer.timeToFirstRevenue} />
                <DrawerRow k="Gross margin" val={drawer.grossMarginRange} />
                <DrawerRow k="Sales difficulty" val={drawer.salesDifficulty} />
                <DrawerRow k="Regulatory risk" val={drawer.regulatoryRisk} />
                <DrawerRow k="Defensibility" val={drawer.defensibility} />
                <DrawerRow k="Score" val={String(drawer.opportunityScore)} />
              </tbody>
            </table>
          </div>
        </>
      )}

      {showTop && (
        <button
          className="ir-noprint"
          aria-label="Back to top"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          style={{
            position: 'fixed',
            bottom: 20,
            right: 20,
            zIndex: 40,
            width: 38,
            height: 38,
            borderRadius: 5,
            border: '1px solid var(--ir-border-strong)',
            background: 'var(--ir-surface)',
            color: 'var(--ir-text)',
            cursor: 'pointer',
          }}
        >
          ↑
        </button>
      )}
    </div>
  );
}

// ---- sub-components -------------------------------------------------------

function StripCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="ir-strip-cell">
      <div className="ir-strip-label">{label}</div>
      <div className="ir-strip-value">{value}</div>
    </div>
  );
}

function ReasonCol({ title, cls, items }: { title: string; cls: string; items: string[] }) {
  return (
    <div>
      <div className={`ir-eyebrow ${cls}`}>{title}</div>
      <ol style={{ margin: '10px 0 0', padding: 0, listStyle: 'none' }}>
        {items.map((t, i) => (
          <li
            key={i}
            style={{ display: 'flex', gap: 10, padding: '5px 0', fontSize: 14, lineHeight: 1.5 }}
          >
            <span className={`ir-num ${cls}`} style={{ fontWeight: 600, flexShrink: 0 }}>
              {String(i + 1).padStart(2, '0')}
            </span>
            <span>{t}</span>
          </li>
        ))}
        {items.length === 0 && <li className="ir-muted">—</li>}
      </ol>
    </div>
  );
}

function SectionHead({
  label,
  query = '',
  collapsed,
  onToggle,
  onCopy,
  copied,
}: {
  label: string;
  query?: string;
  collapsed?: boolean;
  onToggle?: () => void;
  onCopy?: () => void;
  copied?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {onToggle ? (
        <button
          onClick={onToggle}
          aria-expanded={!collapsed}
          style={{
            background: 'none',
            border: 0,
            cursor: 'pointer',
            padding: 0,
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            flex: 1,
            color: 'inherit',
          }}
        >
          <span className="ir-h2">
            <Highlight text={label} query={query} />
          </span>
          <span className="ir-muted" style={{ fontSize: 12 }} aria-hidden>
            {collapsed ? '▸' : '▾'}
          </span>
        </button>
      ) : (
        <span className="ir-h2" style={{ flex: 1 }}>
          <Highlight text={label} query={query} />
        </span>
      )}
      {onCopy && (
        <button
          className="ir-btn ir-btn-ghost ir-noprint"
          style={{ height: 26 }}
          onClick={onCopy}
          aria-label={`Copy ${label} section`}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      )}
    </div>
  );
}

// A classified value (probability/impact/ability) — text carries the meaning, a
// dot only reinforces it (status is never communicated by colour alone).
function Classified({ value }: { value: string }) {
  const cls =
    value === 'High' || value === 'Likely'
      ? 'ir-neg'
      : value === 'Possible' || value === 'Moderate'
        ? 'ir-warn'
        : value === 'Low'
          ? 'ir-info'
          : 'ir-muted';
  const dot =
    value === 'High' || value === 'Likely'
      ? 'ir-dot-neg'
      : value === 'Possible' || value === 'Moderate'
        ? 'ir-dot-warn'
        : 'ir-dot-muted';
  if (value === NOT_ESTABLISHED) return <span className="ir-muted">{value}</span>;
  return (
    <span className={`ir-status ${cls}`}>
      <span className={`ir-dot ${dot}`} aria-hidden /> {value}
    </span>
  );
}

function EconomicsTable({
  report,
  verdict,
}: {
  report: StructuredReport;
  verdict: { label: string; cls: string; sentence: string };
}) {
  const s = (name: string) => report.unitEconomicsScenarios.find(x => x.name === name);
  const cons = s('conservative');
  const base = s('base');
  const agg = s('aggressive');
  const cell = (val?: string) => <td className="ir-num">{val ?? NOT_ESTABLISHED}</td>;
  // Required rows; existing schema only provides asp/grossMargin/cac/paybackPeriod/ltv.
  const rows: Array<[string, keyof NonNullable<typeof base> | null]> = [
    ['Monthly revenue at maturity', null],
    ['Average contract value', 'asp'],
    ['Gross margin', 'grossMargin'],
    ['Customer acquisition cost', 'cac'],
    ['Payback period', 'paybackPeriod'],
    ['Break-even timeline', null],
    ['Working-capital requirement', null],
    ['Lifetime value', 'ltv'],
  ];
  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table className="ir-table">
          <thead>
            <tr>
              <th>Metric</th>
              <th className="ir-num">Conservative</th>
              <th className="ir-num">Base</th>
              <th className="ir-num">Aggressive</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Startup capital</td>
              <td className="ir-num" colSpan={3} style={{ textAlign: 'left' }}>
                {report.executiveVerdict.initialCapital}
              </td>
            </tr>
            {rows.map(([label, key]) => (
              <tr key={label}>
                <td>{label}</td>
                {key ? (
                  cell(cons?.[key] as string | undefined)
                ) : (
                  <td className="ir-num ir-muted">{NOT_ESTABLISHED}</td>
                )}
                {key ? (
                  cell(base?.[key] as string | undefined)
                ) : (
                  <td className="ir-num ir-muted">{NOT_ESTABLISHED}</td>
                )}
                {key ? (
                  cell(agg?.[key] as string | undefined)
                ) : (
                  <td className="ir-num ir-muted">{NOT_ESTABLISHED}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 14 }}>
        <div className="ir-eyebrow">
          Economic verdict ·{' '}
          <span className={verdict.cls} style={{ fontWeight: 700 }}>
            {verdict.label}
          </span>
        </div>
        <p className="ir-body" style={{ marginTop: 4 }}>
          {verdict.sentence}
        </p>
      </div>
    </div>
  );
}

function IndependentReview({ report }: { report: ReportResponse }) {
  const f = report.verification?.factual;
  const a = report.verification?.adversarial;
  const adj = report.verification?.adjudication;
  const fp = reviewPhrase(f?.verdict);
  const ap = reviewPhrase(a?.verdict);
  const unresolved = (f?.blockingDefects.length ?? 0) + (a?.blockingDefects.length ?? 0);
  const caveats = [
    ...(a?.economicWeaknesses ?? []),
    ...(a?.operatorWarnings ?? []),
    ...(f?.missingEvidence ?? []),
  ].slice(0, 4);
  return (
    <div>
      <table className="ir-table" style={{ maxWidth: 520 }}>
        <tbody>
          <tr>
            <td>Factual accuracy</td>
            <td>
              <span className={fp.cls}>{fp.label}</span>
            </td>
          </tr>
          <tr>
            <td>Adversarial risk review</td>
            <td>
              <span className={ap.cls}>{ap.label}</span>
            </td>
          </tr>
          <tr>
            <td>Material conflicts</td>
            <td>{adj ? 'Resolved' : 'None found'}</td>
          </tr>
          <tr>
            <td>Claims reviewed</td>
            <td className="ir-num">{f?.claimsChecked ?? 0}</td>
          </tr>
          <tr>
            <td>Unresolved critical issues</td>
            <td className={`ir-num ${unresolved ? 'ir-neg' : 'ir-pos'}`}>{unresolved}</td>
          </tr>
        </tbody>
      </table>
      {caveats.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="ir-eyebrow">Important reviewer caveats</div>
          <ul style={{ margin: '8px 0 0', paddingLeft: 0, listStyle: 'none' }}>
            {caveats.map((c, i) => (
              <li key={i} style={{ display: 'flex', gap: 8, padding: '3px 0', fontSize: 14 }}>
                <span className="ir-muted" aria-hidden>
                  •
                </span>{' '}
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function DrawerRow({ k, val }: { k: string; val?: string }) {
  return (
    <tr>
      <td className="ir-muted" style={{ width: 140 }}>
        {k}
      </td>
      <td>{val ?? NOT_ESTABLISHED}</td>
    </tr>
  );
}
