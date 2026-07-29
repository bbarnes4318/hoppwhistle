'use client';

import type { RankedOpportunity, StructuredReport } from '@hopwhistle/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';

import { AiBriefings } from './AiBriefings';
import { researchApi, type ReportResponse } from './api';
import { CostSummary } from './CostSummary';
import { ExecutiveSnapshot } from './ExecutiveSnapshot';
import { SourcesWorkspace } from './SourcesWorkspace';
import { BarCompare, CapitalSpeedScatter, RiskMatrix, Timeline } from './ui/charts';
import { SearchHighlight, highlightMarkdownComponents } from './ui/highlight';
import {
  buildRiskRegister,
  deriveEconomicVerdict,
  deriveReasonsAgainst,
  deriveReasonsFor,
  deriveRecommendation,
  firstSectionSentence,
  NOT_ESTABLISHED,
  type EconomicVerdict,
} from './ui/report-helpers';
import { capitalVsSpeed, opportunityBars, riskMatrixCells } from './ui/report-story';

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
  const reportRef = useRef<HTMLDivElement>(null);
  const centerScrollRef = useRef<HTMLDivElement>(null);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const oppOpenerRef = useRef<HTMLElement | null>(null);
  const mobileOpenerRef = useRef<HTMLButtonElement>(null);
  const mobileCloseRef = useRef<HTMLButtonElement>(null);

  const q = query.trim().toLowerCase();
  const mdComponents = useMemo(() => highlightMarkdownComponents(q), [q]);

  const scrollToTarget = (target: HTMLElement) => {
    if (centerScrollRef.current && window.innerWidth > 900) {
      const container = centerScrollRef.current;
      const containerRect = container.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const relativeTop = targetRect.top - containerRect.top + container.scrollTop;
      const targetScrollTop = relativeTop - 70;
      container.scrollTo({ top: Math.max(0, targetScrollTop), behavior: 'smooth' });
    } else {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const scrollToMatch = (target: HTMLElement) => {
    if (centerScrollRef.current && window.innerWidth > 900) {
      const container = centerScrollRef.current;
      const containerRect = container.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const relativeTop = targetRect.top - containerRect.top + container.scrollTop;
      const targetScrollTop = relativeTop - containerRect.height / 2 + targetRect.height / 2;
      container.scrollTo({ top: Math.max(0, targetScrollTop), behavior: 'smooth' });
    } else {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  useEffect(() => {
    const handleScroll = (e: Event) => {
      const target = e.target as HTMLElement;
      if (target === centerScrollRef.current) {
        setShowTop(target.scrollTop > 700);
      } else if (e.currentTarget === window) {
        setShowTop(window.scrollY > 700);
      }
    };
    const scrollEl = centerScrollRef.current;
    if (scrollEl) {
      scrollEl.addEventListener('scroll', handleScroll, { passive: true });
    }
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      if (scrollEl) {
        scrollEl.removeEventListener('scroll', handleScroll);
      }
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  useEffect(() => {
    const rootEl = window.innerWidth > 900 ? centerScrollRef.current : null;
    const obs = new IntersectionObserver(
      entries => {
        const vis = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (vis?.target instanceof HTMLElement && vis.target.dataset.anchor)
          setActive(vis.target.dataset.anchor);
      },
      { root: rootEl, rootMargin: '-20px 0px -70% 0px' }
    );
    Object.values(sectionEls.current).forEach(el => el && obs.observe(el));
    return () => obs.disconnect();
  });

  // Collect every visible match across the WHOLE report canvas (decision summary,
  // recommendation, reasons, analysis, economics/opportunity/risk tables, review,
  // kill criteria, right rail, evidence & sources). Exclude matches inside a
  // collapsed methodology <details> unless it is open.
  const scanMarks = () => {
    const root = reportRef.current;
    if (!root || !q) return [] as HTMLElement[];
    return Array.from(root.querySelectorAll<HTMLElement>('[data-ir-mark]')).filter(
      m => !m.closest('details:not([open])')
    );
  };
  useEffect(() => {
    const marks = scanMarks();
    setMatchCount(marks.length);
    setMatchIdx(marks.length ? 0 : -1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, collapsed]);
  useEffect(() => {
    const marks = scanMarks();
    marks.forEach(m => m.removeAttribute('data-ir-active'));
    if (matchIdx >= 0 && marks[matchIdx]) {
      marks[matchIdx].setAttribute('data-ir-active', '');
      scrollToMatch(marks[matchIdx]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchIdx, matchCount]);

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

  const recommendation = useMemo(() => deriveRecommendation(r), [r]);
  const reasonsFor = useMemo(() => deriveReasonsFor(r), [r]);
  const reasonsAgainst = useMemo(() => deriveReasonsAgainst(r), [r]);
  const riskRows = useMemo(
    () => buildRiskRegister(r, report.verification?.adversarial),
    [r, report.verification]
  );
  const econVerdict = useMemo(() => deriveEconomicVerdict(r), [r]);
  const base = r.unitEconomicsScenarios.find(s => s.name === 'base');
  const executionReminder =
    firstSectionSentence(r, /90.day|execution|validation|first.customer/i) ??
    'Validate demand with paying customers before committing to fixed costs.';

  const oppBars = useMemo(() => opportunityBars(r), [r]);
  const capSpeed = useMemo(() => capitalVsSpeed(r), [r]);
  const riskCells = useMemo(
    () => riskMatrixCells(r, report.verification?.adversarial),
    [r, report.verification]
  );
  const timeline = [
    { label: 'Days 1–30', detail: 'Validate demand with real paying customers' },
    { label: 'Days 31–60', detail: 'Turn what works into a repeatable sales motion' },
    { label: 'Days 61–90', detail: 'Scale only what has proven out' },
  ];

  const H = ({ text }: { text: string }) => <SearchHighlight text={text} query={q} />;

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
    const target = sectionEls.current[id];
    if (target) {
      scrollToTarget(target);
    }
    closeMobile();
  };

  const backToTop = () => {
    if (centerScrollRef.current && window.innerWidth > 900) {
      centerScrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };
  const dl = (fmt: 'markdown' | 'json') => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    void fetch(researchApi.reportDownloadUrl(runId, fmt), {
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
    { id: 'briefings', label: 'AI briefings' },
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
    <div
      ref={reportRef}
      style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}
    >
      <div className="ir-report-grid">
        {/* Left Column: Summary + Table of Contents */}
        <aside className="ir-left-col">
          <div
            className="ir-left-summary"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              padding: '8px 10px',
              background: 'var(--ir-surface)',
              border: '1px solid var(--ir-border)',
              borderRadius: 6,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.2 }}>{meta.industry}</div>
            <div className="ir-muted" style={{ fontSize: 11, lineHeight: 1.2 }}>
              {meta.geography}
            </div>

            <div className="ir-divider" style={{ margin: '3px 0' }} />

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '80px 1fr',
                gap: '4px 4px',
                fontSize: 11,
              }}
            >
              <div className="ir-muted">Verdict</div>
              <div>
                <span
                  className={`ir-verdict ${verdictClass(v.verdict)}`}
                  style={{ padding: '1px 5px', fontSize: 9, fontWeight: 700 }}
                >
                  {v.verdict.replace(/_/g, ' ')}
                </span>
              </div>

              <div className="ir-muted">Score</div>
              <div style={{ fontWeight: 600 }} className="ir-num">
                {v.overallScore} / 100
              </div>

              <div className="ir-muted">Confidence</div>
              <div style={{ fontWeight: 600 }} className="ir-num">
                {Math.round(v.confidence * 100)}%
              </div>

              <div className="ir-muted">Time to revenue</div>
              <div style={{ fontWeight: 600 }}>{v.timeToFirstRevenue}</div>

              <div className="ir-muted">Capital</div>
              <div style={{ fontWeight: 600 }}>{v.initialCapital}</div>
            </div>

            <div className="ir-divider" style={{ margin: '3px 0' }} />

            <div>
              <div
                className="ir-muted"
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  marginBottom: 2,
                }}
              >
                Recommended Entry
              </div>
              <div
                className="ir-clamp-2"
                style={{ fontSize: 11, fontWeight: 500, lineHeight: 1.35 }}
                title={recommendation}
              >
                <H text={recommendation} />
              </div>
            </div>
          </div>

          <div className="ir-toc-label">Table of Contents</div>
          <nav className="ir-toc-nav" aria-label="Report sections">
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
        </aside>

        {/* Center Column: Report Canvas (the scrollable area) */}
        <div className="ir-center-col" ref={centerScrollRef}>
          {/* Mobile and Print Header Block */}
          <div className="ir-mobile-header-block">
            <div
              style={{
                padding: 12,
                background: 'var(--ir-surface)',
                border: '1px solid var(--ir-border)',
                borderRadius: 6,
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  color: 'var(--ir-text-3)',
                }}
              >
                Industry Research · {meta.mode.replace(/_/g, ' ')}
              </div>
              <h1 className="ir-h1" style={{ marginTop: 2, marginBottom: 4 }}>
                <H text={meta.industry} />
              </h1>
              <div className="ir-muted" style={{ fontSize: 12, marginBottom: 8 }}>
                {meta.geography} ·{' '}
                {new Date(report.createdAt).toLocaleDateString(undefined, {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </div>
              <div className="ir-divider" style={{ margin: '8px 0' }} />
              <div
                style={{ display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: 12, marginTop: 8 }}
              >
                <div>
                  <strong>Verdict:</strong>{' '}
                  <span className={`ir-verdict ${verdictClass(v.verdict)}`}>
                    {v.verdict.replace(/_/g, ' ')}
                  </span>
                </div>
                <div>
                  <strong>Score:</strong> {v.overallScore}/100
                </div>
                <div>
                  <strong>Confidence:</strong> {Math.round(v.confidence * 100)}%
                </div>
                <div>
                  <strong>Capital:</strong> {v.initialCapital}
                </div>
              </div>
              <div style={{ marginTop: 8, fontSize: 12 }}>
                <strong>Recommended Entry:</strong> {recommendation}
              </div>
            </div>
          </div>

          <div className="ir-canvas">
            {/* Sticky Search Toolbar */}
            <div
              className="ir-search-toolbar ir-noprint"
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
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

            {/* Executive snapshot — the decision summary, visualized */}
            <section
              id="ir-decision"
              data-anchor="decision"
              ref={el => {
                sectionEls.current.decision = el;
              }}
              style={{ marginBottom: 18 }}
            >
              <ExecutiveSnapshot report={r} maxBudgetUsd={maxBudgetUsd} query={q} />
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                  gap: 20,
                  marginTop: 18,
                  paddingTop: 18,
                  borderTop: '1px solid var(--ir-border)',
                }}
              >
                <ReasonCol title="Why this can work" cls="ir-pos" items={reasonsFor} q={q} />
                <ReasonCol title="Why this can fail" cls="ir-neg" items={reasonsAgainst} q={q} />
              </div>
            </section>

            {/* AI briefings */}
            <section
              id="ir-briefings"
              data-anchor="briefings"
              ref={el => {
                sectionEls.current.briefings = el;
              }}
              className="ir-report-section ir-noprint"
            >
              <div className="ir-h2">AI briefings</div>
              <p className="ir-muted" style={{ fontSize: 13, margin: '4px 0 12px' }}>
                Short spoken briefings generated from this report — pick a focus, listen, or read
                the transcript.
              </p>
              <AiBriefings report={r} runId={runId} />
            </section>

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
                    onCopy={() => {
                      void copy(
                        cat.key,
                        cat.sections.map(s => `## ${s.title}\n\n${s.markdown}`).join('\n\n')
                      );
                    }}
                    copied={copied === cat.key}
                  />
                  {!isCollapsed &&
                    cat.sections.map(s => (
                      <div key={s.key} style={{ marginTop: 14 }}>
                        {cat.sections.length > 1 && (
                          <div className="ir-h3">
                            <H text={s.title} />
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
              <EconomicsTable report={r} verdict={econVerdict} q={q} />
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

                {r.rankedOpportunities[0] && (
                  <div
                    className="ir-panel"
                    style={{
                      padding: 14,
                      marginTop: 4,
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0,1fr) auto',
                      gap: 14,
                      alignItems: 'center',
                      background: 'color-mix(in srgb, var(--ir-accent) 6%, transparent)',
                      borderColor: 'color-mix(in srgb, var(--ir-accent) 30%, var(--ir-border))',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div className="ir-eyebrow" style={{ color: 'var(--ir-accent)' }}>
                        Top-ranked opportunity
                      </div>
                      <div style={{ fontSize: 16, fontWeight: 700, marginTop: 3 }}>
                        <H text={r.rankedOpportunities[0].opportunity} />
                      </div>
                      <div className="ir-muted" style={{ fontSize: 12, marginTop: 3 }}>
                        Best fit for {r.rankedOpportunities[0].customer ?? v.bestCustomer} ·{' '}
                        {r.rankedOpportunities[0].revenueModel ?? v.bestBusinessModel} ·{' '}
                        {r.rankedOpportunities[0].timeToFirstRevenue ?? v.timeToFirstRevenue} to
                        revenue
                      </div>
                    </div>
                    <button
                      className="ir-btn ir-btn-primary ir-noprint"
                      onClick={e => openOpp(r.rankedOpportunities[0], e.currentTarget)}
                      style={{ flexShrink: 0 }}
                    >
                      {r.rankedOpportunities[0].opportunityScore} / 100 · Details
                    </button>
                  </div>
                )}

                {(oppBars.length > 0 || capSpeed.length > 0) && (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: capSpeed.length
                        ? 'repeat(auto-fit,minmax(240px,1fr))'
                        : '1fr',
                      gap: 20,
                      margin: '16px 0',
                    }}
                  >
                    {oppBars.length > 0 && (
                      <div>
                        <div className="ir-eyebrow" style={{ marginBottom: 8 }}>
                          Opportunity scores
                        </div>
                        <BarCompare data={oppBars} />
                      </div>
                    )}
                    {capSpeed.length > 0 && (
                      <div>
                        <div className="ir-eyebrow" style={{ marginBottom: 8 }}>
                          Capital vs. time to revenue
                        </div>
                        <CapitalSpeedScatter data={capSpeed} />
                      </div>
                    )}
                  </div>
                )}

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
                          <td style={{ fontWeight: 600 }}>
                            <H text={o.opportunity} />
                          </td>
                          <td className="ir-muted">
                            <H text={o.customer ?? '—'} />
                          </td>
                          <td className="ir-muted">
                            <H text={o.offer ?? '—'} />
                          </td>
                          <td className="ir-muted">
                            <H text={o.revenueModel ?? '—'} />
                          </td>
                          <td className="ir-muted">
                            <H text={o.startupCost ?? '—'} />
                          </td>
                          <td className="ir-muted">
                            <H text={o.timeToFirstRevenue ?? '—'} />
                          </td>
                          <td className="ir-muted">
                            <H text={o.salesDifficulty ?? '—'} />
                          </td>
                          <td className="ir-num" style={{ fontWeight: 600 }}>
                            <H text={String(o.opportunityScore)} />
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

            {/* First 90 days */}
            <section className="ir-report-section">
              <SectionHead label="First 90 days" query={q} />
              <div style={{ marginTop: 12 }}>
                <Timeline phases={timeline} />
              </div>
            </section>

            {/* Risk register */}
            <section
              id="ir-risks"
              data-anchor="risks"
              ref={el => {
                sectionEls.current.risks = el;
              }}
              className="ir-report-section"
            >
              <SectionHead label="Risk register" query={q} />
              {riskCells.length > 0 && (
                <div style={{ margin: '10px 0 16px' }}>
                  <div className="ir-eyebrow" style={{ marginBottom: 8 }}>
                    Probability × impact
                  </div>
                  <RiskMatrix cells={riskCells} />
                </div>
              )}
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
                          <td style={{ minWidth: 200 }}>
                            <H text={rk.risk} />
                          </td>
                          <td>
                            <Classified value={rk.probability} q={q} />
                          </td>
                          <td>
                            <Classified value={rk.impact} q={q} />
                          </td>
                          <td>
                            <Classified value={rk.ability} q={q} />
                          </td>
                          <td className="ir-muted" style={{ minWidth: 180 }}>
                            <H text={rk.mitigation} />
                          </td>
                          <td className="ir-muted" style={{ minWidth: 160 }}>
                            <H text={rk.trigger} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="ir-muted">
                  No material risks were flagged by the adversarial review.
                </p>
              )}
              {r.killCriteria.length > 0 && (
                <div style={{ marginTop: 18 }}>
                  <div className="ir-eyebrow ir-neg">Do not continue if</div>
                  <ul style={{ margin: '8px 0 0', paddingLeft: 0, listStyle: 'none' }}>
                    {r.killCriteria.map((k, i) => (
                      <li
                        key={i}
                        style={{ display: 'flex', gap: 8, padding: '3px 0', fontSize: 14 }}
                      >
                        <span className="ir-neg" aria-hidden>
                          ✕
                        </span>{' '}
                        <H text={k} />
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
                <IndependentReview report={report} q={q} />
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
              <SourcesWorkspace sources={report.sources} evidence={report.evidence} highlight={q} />
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
                      Replay of an earlier investigation — research evidence was reused; synthesis
                      and verification were re-run. No new research charges were incurred.
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
        </div>

        {/* Right Column: Decision Support Panel */}
        <aside className="ir-right-col">
          <div className="ir-decision-support-panel">
            <div className="ir-eyebrow">Immediate next action</div>
            <p style={{ fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
              <H
                text={
                  r.rankedOpportunities[0]
                    ? `Start with ${v.bestSegment}: ${r.rankedOpportunities[0].opportunity}.`
                    : `Focus on ${v.bestSegment}.`
                }
              />
            </p>
            <hr className="ir-divider" style={{ margin: '12px 0' }} />
            <div className="ir-eyebrow">Critical economic threshold</div>
            <p style={{ fontSize: 12, marginTop: 4, lineHeight: 1.45 }}>
              <H
                text={`Base-case payback: ${base?.paybackPeriod ?? NOT_ESTABLISHED}${base?.grossMargin ? ` · gross margin ${base.grossMargin}` : ''}`}
              />
            </p>
            {r.killCriteria[0] && (
              <>
                <hr className="ir-divider" style={{ margin: '12px 0' }} />
                <div className="ir-eyebrow ir-neg">Critical kill criterion</div>
                <p style={{ fontSize: 12, marginTop: 4, lineHeight: 1.45 }}>
                  <H text={r.killCriteria[0]} />
                </p>
              </>
            )}
            <hr className="ir-divider" style={{ margin: '12px 0' }} />
            <div className="ir-eyebrow">Execution reminder</div>
            <p style={{ fontSize: 12, marginTop: 4, lineHeight: 1.45 }}>
              <H text={executionReminder} />
            </p>
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

            {/* Score block */}
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 8,
                marginTop: 10,
                padding: '6px 10px',
                background: 'var(--ir-surface-2)',
                border: '1px solid var(--ir-border)',
                borderRadius: 6,
                alignSelf: 'start',
              }}
            >
              <span
                className="ir-muted"
                style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase' }}
              >
                Score
              </span>
              <span
                style={{ fontSize: 18, fontWeight: 700, color: 'var(--ir-accent)' }}
                className="ir-num"
              >
                {drawer.opportunityScore}
              </span>
              <span className="ir-muted" style={{ fontSize: 11 }}>
                / 100
              </span>
            </div>

            <div className="ir-details-grid">
              {/* Group 1: Business model */}
              <div className="ir-details-card">
                <h4>Business Model</h4>
                <div className="ir-details-row">
                  <div className="ir-details-label">Target customer</div>
                  <div className="ir-details-value">{drawer.customer ?? NOT_ESTABLISHED}</div>
                </div>
                <div className="ir-details-row">
                  <div className="ir-details-label">Offer</div>
                  <div className="ir-details-value">{drawer.offer ?? NOT_ESTABLISHED}</div>
                </div>
                <div className="ir-details-row">
                  <div className="ir-details-label">Revenue model</div>
                  <div className="ir-details-value">{drawer.revenueModel ?? NOT_ESTABLISHED}</div>
                </div>
                <div className="ir-details-row">
                  <div className="ir-details-label">Price</div>
                  <div className="ir-details-value">{drawer.price ?? NOT_ESTABLISHED}</div>
                </div>
              </div>

              {/* Group 2: Launch requirements */}
              <div className="ir-details-card">
                <h4>Launch Requirements</h4>
                <div className="ir-details-row">
                  <div className="ir-details-label">Startup capital</div>
                  <div className="ir-details-value">{drawer.startupCost ?? NOT_ESTABLISHED}</div>
                </div>
                <div className="ir-details-row">
                  <div className="ir-details-label">Time to MVP</div>
                  <div className="ir-details-value">{drawer.timeToMvp ?? NOT_ESTABLISHED}</div>
                </div>
                <div className="ir-details-row">
                  <div className="ir-details-label">Time to revenue</div>
                  <div className="ir-details-value">
                    {drawer.timeToFirstRevenue ?? NOT_ESTABLISHED}
                  </div>
                </div>
              </div>

              {/* Group 3: Economics and difficulty */}
              <div className="ir-details-card">
                <h4>Economics and Difficulty</h4>
                <div className="ir-details-row">
                  <div className="ir-details-label">Gross margin</div>
                  <div className="ir-details-value">
                    {drawer.grossMarginRange ?? NOT_ESTABLISHED}
                  </div>
                </div>
                <div className="ir-details-row">
                  <div className="ir-details-label">Sales difficulty</div>
                  <div className="ir-details-value">
                    {drawer.salesDifficulty ?? NOT_ESTABLISHED}
                  </div>
                </div>
                <div className="ir-details-row">
                  <div className="ir-details-label">Regulatory risk</div>
                  <div className="ir-details-value">{drawer.regulatoryRisk ?? NOT_ESTABLISHED}</div>
                </div>
                <div className="ir-details-row">
                  <div className="ir-details-label">Defensibility</div>
                  <div className="ir-details-value">{drawer.defensibility ?? NOT_ESTABLISHED}</div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {showTop && (
        <button
          className="ir-noprint"
          aria-label="Back to top"
          onClick={backToTop}
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

function ReasonCol({
  title,
  cls,
  items,
  q,
}: {
  title: string;
  cls: string;
  items: string[];
  q: string;
}) {
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
            <span>
              <SearchHighlight text={t} query={q} />
            </span>
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
    <div className="ir-section-header-band">
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
            <SearchHighlight text={label} query={query} />
          </span>
          <span className="ir-muted" style={{ fontSize: 12 }} aria-hidden>
            {collapsed ? '▸' : '▾'}
          </span>
        </button>
      ) : (
        <span className="ir-h2" style={{ flex: 1 }}>
          <SearchHighlight text={label} query={query} />
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

function Classified({ value, q }: { value: string; q: string }) {
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
  if (value === NOT_ESTABLISHED)
    return (
      <span className="ir-muted">
        <SearchHighlight text={value} query={q} />
      </span>
    );
  return (
    <span className={`ir-status ${cls}`}>
      <span className={`ir-dot ${dot}`} aria-hidden /> <SearchHighlight text={value} query={q} />
    </span>
  );
}

function EconomicsTable({
  report,
  verdict,
  q,
}: {
  report: StructuredReport;
  verdict: EconomicVerdict;
  q: string;
}) {
  const s = (name: string) => report.unitEconomicsScenarios.find(x => x.name === name);
  const cons = s('conservative');
  const base = s('base');
  const agg = s('aggressive');
  const cell = (val?: string) => (
    <td className="ir-num">{val ? <SearchHighlight text={val} query={q} /> : NOT_ESTABLISHED}</td>
  );
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
                <SearchHighlight text={report.executiveVerdict.initialCapital} query={q} />
              </td>
            </tr>
            {rows.map(([label, key]) => (
              <tr key={label}>
                <td>{label}</td>
                {key ? cell(cons?.[key]) : <td className="ir-num ir-muted">{NOT_ESTABLISHED}</td>}
                {key ? cell(base?.[key]) : <td className="ir-num ir-muted">{NOT_ESTABLISHED}</td>}
                {key ? cell(agg?.[key]) : <td className="ir-num ir-muted">{NOT_ESTABLISHED}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 14 }}>
        <div className="ir-eyebrow">
          Economic verdict ·{' '}
          <span className={verdict.cls} style={{ fontWeight: 700 }}>
            <SearchHighlight text={verdict.label} query={q} />
          </span>
        </div>
        <p className="ir-body" style={{ marginTop: 4 }}>
          <SearchHighlight text={verdict.sentence} query={q} />
        </p>
      </div>
    </div>
  );
}

function IndependentReview({ report, q }: { report: ReportResponse; q: string }) {
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
              <span className={fp.cls}>
                <SearchHighlight text={fp.label} query={q} />
              </span>
            </td>
          </tr>
          <tr>
            <td>Adversarial risk review</td>
            <td>
              <span className={ap.cls}>
                <SearchHighlight text={ap.label} query={q} />
              </span>
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
                <SearchHighlight text={c} query={q} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
