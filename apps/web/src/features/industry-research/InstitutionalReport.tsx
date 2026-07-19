'use client';

import type { RankedOpportunity, StructuredReport } from '@hopwhistle/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';

import { researchApi, type ReportResponse } from './api';
import { CostSummary } from './CostSummary';
import { SourcesWorkspace } from './SourcesWorkspace';

// ---- helpers -------------------------------------------------------------

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

// Map arbitrary AI section titles into a small set of institutional categories.
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
  const parts = plain.split(/(?<=[.!?])\s+/).slice(0, max);
  return parts.join(' ');
}

function money(n?: number): string {
  return n == null ? '—' : `$${n.toFixed(2)}`;
}

// ---- component -----------------------------------------------------------

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
  const sectionEls = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 700);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Active-section highlighting via IntersectionObserver.
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

  // Bucket sections into institutional categories (first match wins; unmatched → market).
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
    const geo = meta.geography;
    return `${v.biggestOpportunity} — targeting ${v.bestCustomer} with ${v.bestBusinessModel}, beginning in ${geo}.`;
  }, [r.sections, v, meta.geography]);

  const reasonsFor = [
    v.biggestOpportunity,
    ...r.rankedOpportunities.slice(0, 2).map(o => o.opportunity),
  ]
    .filter(Boolean)
    .slice(0, 3);
  const reasonsAgainst = [v.biggestRisk, ...r.killCriteria.slice(0, 2)].filter(Boolean).slice(0, 3);

  const risks = useMemo(() => {
    const adv = report.verification?.adversarial;
    const out: Array<{ text: string; cat: string; sev: string }> = [];
    if (v.biggestRisk) out.push({ text: v.biggestRisk, cat: 'Primary', sev: 'Critical' });
    const add = (arr: string[] | undefined, cat: string, sev: string) =>
      (arr ?? []).slice(0, 3).forEach(t => out.push({ text: t, cat, sev }));
    add(adv?.economicWeaknesses, 'Economic', 'High');
    add(adv?.regulatoryWeaknesses, 'Regulatory', 'High');
    add(adv?.operatorWarnings, 'Operational', 'Moderate');
    add(adv?.customerWarnings, 'Customer', 'Moderate');
    const seen = new Set<string>();
    return out.filter(x => (seen.has(x.text) ? false : (seen.add(x.text), true))).slice(0, 8);
  }, [report.verification, v.biggestRisk]);

  const toggle = (k: string) =>
    setCollapsed(p => {
      const n = new Set(p);
      n.has(k) ? n.delete(k) : n.add(k);
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
    setMobileNav(false);
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

  const q = query.trim().toLowerCase();
  const matches = (text: string) => !q || text.toLowerCase().includes(q);

  return (
    <div>
      {/* ── Identity row ─────────────────────────────────────────── */}
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
          <button className="ir-btn" onClick={() => dl('markdown')}>
            Export
          </button>
          <button className="ir-btn" onClick={() => window.print()}>
            Print
          </button>
          <button
            className="ir-btn"
            onClick={() =>
              copy('share', typeof window !== 'undefined' ? window.location.href : runId)
            }
          >
            {copied === 'share' ? 'Link copied' : 'Share'}
          </button>
        </div>
      </div>

      {/* ── Decision strip ───────────────────────────────────────── */}
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

      {/* ── Recommendation ───────────────────────────────────────── */}
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
        >
          {copied === 'rec' ? 'Copied' : 'Copy'}
        </button>
      </div>

      {/* ── Reasons for / against (first viewport) ──────────────── */}
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

      {/* ── Report body grid ─────────────────────────────────────── */}
      <div className="ir-report-grid" style={{ marginTop: 28 }}>
        {/* Left nav */}
        <nav className="ir-nav-col">
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

        {/* Main canvas */}
        <div className="ir-canvas">
          {/* toolbar */}
          <div
            className="ir-noprint"
            style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}
          >
            <input
              className="ir-field"
              style={{ height: 32, maxWidth: 260 }}
              placeholder="Search the report…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              aria-label="Search report"
            />
            <button
              className="ir-btn"
              style={{ height: 32 }}
              onClick={() => setAll(collapsed.size === 0)}
            >
              {collapsed.size === 0 ? 'Collapse all' : 'Expand all'}
            </button>
          </div>

          {/* Core analysis categories */}
          {categories.map(cat => {
            const anyMatch = cat.sections.some(s => matches(s.title) || matches(s.markdown));
            if (!anyMatch) return null;
            const isCollapsed = collapsed.has(cat.key);
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
                      {cat.sections.length > 1 && <div className="ir-h3">{s.title}</div>}
                      <div className="ir-body" style={{ marginTop: 6 }}>
                        <ReactMarkdown>{s.markdown}</ReactMarkdown>
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
            <SectionHead label="Economics" />
            <EconomicsTable report={r} />
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
              <SectionHead label="Ranked entry opportunities" />
              <div style={{ overflowX: 'auto' }}>
                <table className="ir-table">
                  <thead>
                    <tr>
                      <th className="ir-num">#</th>
                      <th>Opportunity</th>
                      <th>Customer</th>
                      <th>Model</th>
                      <th>To revenue</th>
                      <th className="ir-num">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.rankedOpportunities.map(o => (
                      <tr key={o.rank} className="ir-clickable" onClick={() => setDrawer(o)}>
                        <td className="ir-num">{o.rank}</td>
                        <td style={{ fontWeight: 600 }}>{o.opportunity}</td>
                        <td className="ir-muted">{o.customer ?? '—'}</td>
                        <td className="ir-muted">{o.revenueModel ?? '—'}</td>
                        <td className="ir-muted">{o.timeToFirstRevenue ?? '—'}</td>
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

          {/* Risks */}
          <section
            id="ir-risks"
            data-anchor="risks"
            ref={el => {
              sectionEls.current.risks = el;
            }}
            className="ir-report-section"
          >
            <SectionHead label="Risk register" />
            {risks.length > 0 ? (
              <div style={{ overflowX: 'auto' }}>
                <table className="ir-table">
                  <thead>
                    <tr>
                      <th>Risk</th>
                      <th>Category</th>
                      <th>Severity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {risks.map((rk, i) => (
                      <tr key={i}>
                        <td>{rk.text}</td>
                        <td className="ir-muted">{rk.cat}</td>
                        <td>
                          <SeverityTag sev={rk.sev} />
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
                      <span className="ir-neg">✕</span> {k}
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
              <SectionHead label="Independent review" />
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
            <SectionHead label="Evidence & sources" />
            <SourcesWorkspace sources={report.sources} evidence={report.evidence} />
          </section>

          {/* Methodology & audit trail — collapsed */}
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

        {/* Right rail */}
        <aside className="ir-rail">
          <div className="ir-panel" style={{ padding: 14 }}>
            <div className="ir-eyebrow">Immediate next action</div>
            <p style={{ fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
              {r.rankedOpportunities[0]
                ? `Start with ${v.bestSegment}: ${r.rankedOpportunities[0].opportunity}.`
                : `Focus on ${v.bestSegment}.`}
            </p>
            <hr className="ir-divider" style={{ margin: '12px 0' }} />
            <div className="ir-eyebrow">Confidence</div>
            <div className="ir-num" style={{ fontSize: 18, fontWeight: 600, marginTop: 2 }}>
              {Math.round(v.confidence * 100)}%
            </div>
            {r.killCriteria[0] && (
              <>
                <hr className="ir-divider" style={{ margin: '12px 0' }} />
                <div className="ir-eyebrow ir-neg">Critical kill criterion</div>
                <p style={{ fontSize: 12, marginTop: 4, lineHeight: 1.45 }}>{r.killCriteria[0]}</p>
              </>
            )}
            <hr className="ir-divider" style={{ margin: '12px 0' }} />
            <div className="ir-noprint" style={{ display: 'flex', gap: 6 }}>
              <button className="ir-btn" style={{ flex: 1 }} onClick={() => window.print()}>
                Print
              </button>
              <button className="ir-btn" style={{ flex: 1 }} onClick={() => dl('markdown')}>
                Export
              </button>
            </div>
          </div>
        </aside>
      </div>

      {/* Mobile section navigator */}
      <button
        className="ir-btn ir-btn-primary ir-noprint"
        style={{
          position: 'fixed',
          bottom: 20,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 40,
          display: 'none',
        }}
        data-ir-mobile-nav
        onClick={() => setMobileNav(true)}
      >
        Sections
      </button>
      {mobileNav && (
        <>
          <div className="ir-drawer-scrim" onClick={() => setMobileNav(false)} />
          <div className="ir-drawer" style={{ padding: 16 }}>
            <div className="ir-h3" style={{ marginBottom: 10 }}>
              Jump to section
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
          <div className="ir-drawer-scrim" onClick={() => setDrawer(null)} />
          <div className="ir-drawer" style={{ padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
              <div className="ir-eyebrow">Opportunity #{drawer.rank}</div>
              <button className="ir-btn ir-btn-ghost" onClick={() => setDrawer(null)}>
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
                <DrawerRow k="Startup cost" val={drawer.startupCost} />
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
  collapsed,
  onToggle,
  onCopy,
  copied,
}: {
  label: string;
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
          className="ir-btn-ghost"
          style={{
            background: 'none',
            border: 0,
            cursor: 'pointer',
            padding: 0,
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            flex: 1,
          }}
        >
          <span className="ir-h2">{label}</span>
          <span className="ir-muted" style={{ fontSize: 12 }}>
            {collapsed ? '▸' : '▾'}
          </span>
        </button>
      ) : (
        <span className="ir-h2" style={{ flex: 1 }}>
          {label}
        </span>
      )}
      {onCopy && (
        <button className="ir-btn ir-btn-ghost ir-noprint" style={{ height: 26 }} onClick={onCopy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      )}
    </div>
  );
}

function SeverityTag({ sev }: { sev: string }) {
  const cls =
    sev === 'Critical'
      ? 'ir-neg'
      : sev === 'High'
        ? 'ir-warn'
        : sev === 'Moderate'
          ? 'ir-info'
          : 'ir-muted';
  const dot = sev === 'Critical' ? 'ir-dot-neg' : sev === 'High' ? 'ir-dot-warn' : 'ir-dot-muted';
  return (
    <span className={`ir-status ${cls}`}>
      <span className={`ir-dot ${dot}`} />
      {sev}
    </span>
  );
}

function EconomicsTable({ report }: { report: StructuredReport }) {
  const s = (name: string) => report.unitEconomicsScenarios.find(x => x.name === name);
  const cons = s('conservative');
  const base = s('base');
  const agg = s('aggressive');
  const cell = (val?: string) => <td className="ir-num">{val ?? 'Not established'}</td>;
  const rows: Array<[string, keyof NonNullable<typeof base>]> = [
    ['Average contract value', 'asp'],
    ['Gross margin', 'grossMargin'],
    ['Customer acquisition cost', 'cac'],
    ['Payback period', 'paybackPeriod'],
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
                {cell(cons?.[key] as string | undefined)}
                {cell(base?.[key] as string | undefined)}
                {cell(agg?.[key] as string | undefined)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {base?.notes && (
        <div style={{ marginTop: 14 }}>
          <div className="ir-eyebrow">Economic verdict</div>
          <p className="ir-body" style={{ marginTop: 4 }}>
            {base.notes}
          </p>
        </div>
      )}
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
                <span className="ir-muted">•</span> {c}
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
      <td>{val ?? 'Not established'}</td>
    </tr>
  );
}
