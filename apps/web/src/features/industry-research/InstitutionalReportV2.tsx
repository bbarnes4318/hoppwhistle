'use client';

import type { RankedOpportunity } from '@hopwhistle/shared';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';

import { researchApi, type ReportResponse } from './api';
import { HL, ReportMarkdown } from './report-md';
import { ReportBriefingStudio } from './ReportBriefingStudio';
import { ReportDecisionBalance } from './ReportDecisionBalance';
import { ReportEconomicsSection } from './ReportEconomicsSection';
import { ReportEvidenceSection } from './ReportEvidenceSection';
import { ReportExecutionSection } from './ReportExecutionSection';
import { ReportExecutiveBrief } from './ReportExecutiveBrief';
import { ReportOpportunitySection } from './ReportOpportunitySection';
import { ReportRiskSection } from './ReportRiskSection';
import { findSections, leadValue } from './v2-derive';
import './report-v2.css';

const VERDICT_META: Record<string, { key: 'go' | 'cond' | 'no'; label: string }> = {
  GO: { key: 'go', label: 'Go' },
  CONDITIONAL_GO: { key: 'cond', label: 'Conditional Go' },
  DO_NOT_ENTER: { key: 'no', label: 'Do not enter' },
};

interface NavItem {
  id: string;
  label: string;
  group?: string;
}

export function InstitutionalReportV2({
  runId,
  report,
  embedded = false,
}: {
  runId: string;
  report: ReportResponse;
  /** Rendered inside the Industry Research app shell (RunView): drop the
   *  redundant wordmark bar and let the page scroll normally. */
  embedded?: boolean;
}) {
  const r = report.structured;
  const v = r.executiveVerdict;
  const meta = r.reportMetadata;
  const adversarial = report.verification?.adversarial ?? null;
  const vd = VERDICT_META[v.verdict] ?? { key: 'cond' as const, label: v.verdict.replace(/_/g, ' ') };

  const [query, setQuery] = useState('');
  const [active, setActive] = useState('brief');
  const [drawer, setDrawer] = useState<RankedOpportunity | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [showTop, setShowTop] = useState(false);
  const [matchCount, setMatchCount] = useState(0);
  const [matchIdx, setMatchIdx] = useState(-1);

  const q = query.trim();
  const rootRef = useRef<HTMLDivElement>(null);
  const sectionEls = useRef<Record<string, HTMLElement | null>>({});
  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const oppOpenerRef = useRef<HTMLElement | null>(null);
  const mobileOpenerRef = useRef<HTMLButtonElement>(null);
  const mobileCloseRef = useRef<HTMLButtonElement>(null);

  const custSections = useMemo(() => findSections(r, [/customer_truth|customer truth/i, /operator_truth|operator truth/i]), [r]);
  const compSection = useMemo(() => findSections(r, [/competitive|competition/i])[0], [r]);
  const stratSections = useMemo(() => findSections(r, [/entry_thesis|entry thesis|recommend/i, /first_customer|first.customer/i]), [r]);

  // The research shell pins its height and hides overflow on desktop (the old
  // report scrolled inside its own centre column). V2 scrolls the page, so
  // release that while V2 is mounted and restore it on unmount, leaving the
  // existing report's behaviour untouched.
  useEffect(() => {
    if (!embedded) return undefined;
    const shell = rootRef.current?.closest('.ir-root') as HTMLElement | null;
    if (!shell) return undefined;
    shell.classList.add('ir-report-v2-scroll');
    return () => shell.classList.remove('ir-report-v2-scroll');
  }, [embedded]);

  // ---- Search: scan every rendered mark, exclude closed <details> ----------
  const scanMarks = useCallback(() => {
    const root = rootRef.current;
    if (!root || !q) return [] as HTMLElement[];
    return Array.from(root.querySelectorAll<HTMLElement>('[data-rv-mark]')).filter(m => !m.closest('details:not([open])'));
  }, [q]);
  useEffect(() => {
    const marks = scanMarks();
    setMatchCount(marks.length);
    setMatchIdx(marks.length ? 0 : -1);
  }, [q, scanMarks]);
  useEffect(() => {
    const marks = scanMarks();
    marks.forEach(m => m.removeAttribute('data-rv-active'));
    if (matchIdx >= 0 && marks[matchIdx]) {
      marks[matchIdx].setAttribute('data-rv-active', '');
      marks[matchIdx].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [matchIdx, matchCount, scanMarks]);
  const stepMatch = (delta: number) => setMatchIdx(i => (matchCount ? (i + delta + matchCount) % matchCount : -1));

  // ---- Active section tracking + back-to-top -------------------------------
  useEffect(() => {
    const obs = new IntersectionObserver(
      entries => {
        const vis = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (vis?.target instanceof HTMLElement && vis.target.dataset.anchor) setActive(vis.target.dataset.anchor);
      },
      { rootMargin: '-80px 0px -70% 0px' }
    );
    Object.values(sectionEls.current).forEach(el => el && obs.observe(el));
    return () => obs.disconnect();
  });
  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 800);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // ---- Drawer / mobile a11y ------------------------------------------------
  useEffect(() => {
    if (!drawer && !mobileNav) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (drawer) closeDrawer();
      if (mobileNav) closeMobile();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });
  useEffect(() => { if (drawer) drawerCloseRef.current?.focus(); }, [drawer]);
  useEffect(() => { if (mobileNav) mobileCloseRef.current?.focus(); }, [mobileNav]);

  const goto = (id: string) => {
    sectionEls.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    closeMobile();
  };
  const onCite = (id: string) => {
    const el = document.getElementById(`rv-source-${id}`);
    (el ?? sectionEls.current.evidence)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (el) {
      el.style.transition = 'background 0.3s';
      el.style.background = 'var(--rv-accent-soft)';
      setTimeout(() => (el.style.background = ''), 1400);
    }
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
  const dl = (fmt: 'markdown' | 'json') => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    void fetch(researchApi.reportDownloadUrl(runId, fmt), { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(res => res.blob())
      .then(b => {
        const url = URL.createObjectURL(b);
        const a = document.createElement('a');
        a.href = url;
        a.download = `industry-research-${runId}.${fmt === 'markdown' ? 'md' : 'json'}`;
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => undefined);
  };

  // ---- Section registry (narrative order) ----------------------------------
  const sections: Array<{ id: string; label: string; group?: string; num?: number; body: ReactNode }> = [];
  let n = 0;
  const add = (s: { id: string; label: string; group?: string; numbered?: boolean; body: ReactNode }) => {
    if (s.numbered !== false) n += 1;
    sections.push({ id: s.id, label: s.label, group: s.group, num: s.numbered === false ? undefined : n, body: s.body });
  };

  add({ id: 'brief', label: 'Executive brief', group: 'Decision', numbered: false, body: <ReportExecutiveBrief report={r} query={q} /> });
  add({ id: 'opportunity', label: 'Opportunities', body: <ReportOpportunitySection report={r} query={q} onOpen={o => setDrawer(o)} onCite={onCite} /> });
  add({ id: 'balance', label: 'Why it works / fails', body: <ReportDecisionBalance report={r} query={q} /> });
  add({ id: 'economics', label: 'Economics', group: 'Analysis', body: <ReportEconomicsSection report={r} query={q} onCite={onCite} /> });
  if (custSections.length)
    add({ id: 'customer', label: 'Customer & demand', body: <NarrativeBody sections={custSections} query={q} onCite={onCite} /> });
  if (compSection)
    add({
      id: 'competition',
      label: 'Competition',
      body: (
        <div>
          {r.competitors.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 'var(--rv-4)' }}>
              {r.competitors.map((c, i) => (
                <span className="rv-chip" key={i}><HL text={c.name} query={q} /></span>
              ))}
            </div>
          )}
          <ReportMarkdown markdown={compSection.markdown} query={q} onCite={onCite} />
        </div>
      ),
    });
  add({ id: 'risk', label: 'Risk & kill criteria', group: 'Decision aids', body: <ReportRiskSection report={r} adversarial={adversarial} query={q} onCite={onCite} /> });
  if (stratSections.length)
    add({ id: 'strategy', label: 'Entry strategy', body: <NarrativeBody sections={stratSections} query={q} onCite={onCite} /> });
  add({ id: 'execution', label: '30 / 60 / 90 plan', body: <ReportExecutionSection report={r} query={q} onCite={onCite} /> });
  add({ id: 'briefing', label: 'AI briefing studio', group: 'Present', numbered: false, body: <ReportBriefingStudio report={r} runId={runId} /> });
  add({ id: 'evidence', label: 'Evidence & sources', group: 'Support', body: <ReportEvidenceSection report={r} query={q} onCite={onCite} /> });

  const navItems: NavItem[] = sections.map(s => ({ id: s.id, label: s.label, group: s.group }));

  return (
    <div className={`rv-root${embedded ? ' rv-embedded' : ''}`} ref={rootRef}>
      {/* Top bar — the app shell already shows the product wordmark and the run
          identity, so when embedded this becomes a slim search/actions bar. */}
      <div className="rv-topbar">
        {!embedded && (
          <>
            <div className="rv-wordmark">
              Industry<span>Research</span>
            </div>
            <div className="rv-topbar-meta">
              {meta.industry} · {meta.geography}
            </div>
          </>
        )}
        <div className="rv-noprint rv-topbar-actions" style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }}>
          <div className="rv-search-wrap" style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              className="rv-field"
              style={{ width: 190 }}
              placeholder="Search the report…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              aria-label="Search report"
            />
            {q && (
              <>
                <span className="rv-micro rv-muted rv-num" aria-live="polite" style={{ minWidth: 56, textAlign: 'right' }}>
                  {matchCount ? `${matchIdx + 1} / ${matchCount}` : 'No matches'}
                </span>
                <button className="rv-btn" onClick={() => stepMatch(-1)} disabled={!matchCount} aria-label="Previous match">‹</button>
                <button className="rv-btn" onClick={() => stepMatch(1)} disabled={!matchCount} aria-label="Next match">›</button>
                <button className="rv-btn rv-btn-ghost" onClick={() => setQuery('')} aria-label="Clear search">✕</button>
              </>
            )}
          </div>
          <button className="rv-btn" onClick={() => dl('markdown')}>Markdown</button>
          <button className="rv-btn" onClick={() => window.print()}>Print / PDF</button>
        </div>
      </div>

      <div className="rv-shell">
        {/* TOC rail */}
        <nav className="rv-toc rv-noprint" aria-label="Report sections">
          {navItems.map(it => (
            <div key={it.id}>
              {it.group && <div className="rv-nav-group">{it.group}</div>}
              <a className="rv-nav-link" data-active={active === it.id} href={`#rv-${it.id}`} onClick={e => { e.preventDefault(); goto(it.id); }}>
                {it.label}
              </a>
            </div>
          ))}
        </nav>

        {/* Reading column */}
        <main className="rv-main">
          {sections.map(s => (
            <section
              key={s.id}
              id={`rv-${s.id}`}
              data-anchor={s.id}
              className="rv-section"
              ref={el => { sectionEls.current[s.id] = el; }}
            >
              {s.id !== 'brief' && (
                <div className="rv-section-head">
                  {s.num != null && <span className="rv-idx">{String(s.num).padStart(2, '0')}</span>}
                  <span className="rv-h2">
                    <HL text={s.label} query={q} />
                  </span>
                  <span className="rv-spacer" />
                </div>
              )}
              {s.body}
            </section>
          ))}

          {/* Methodology & audit (collapsible, prints expanded) */}
          <section className="rv-section" id="rv-methodology">
            <details>
              <summary style={{ cursor: 'pointer', listStyle: 'none' }}>
                <span className="rv-h2">Methodology &amp; audit trail</span>
              </summary>
              <div style={{ marginTop: 'var(--rv-4)' }}>
                <p className="rv-small rv-muted">
                  Independently researched, synthesized, and verified from real, cited sources. Synthesis engine:{' '}
                  {report.synthesisProvider ?? '—'}
                  {report.synthesisModel ? ` (${report.synthesisModel})` : ''}. Schema {meta.schemaVersion}. Generated{' '}
                  {new Date(report.createdAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}.
                </p>
                <div className="rv-noprint" style={{ marginTop: 'var(--rv-3)', display: 'flex', gap: 6 }}>
                  <button className="rv-btn" onClick={() => dl('markdown')}>Download Markdown</button>
                  <button className="rv-btn" onClick={() => dl('json')}>Download JSON</button>
                </div>
              </div>
            </details>
          </section>
        </main>
      </div>

      {/* Mobile section navigator */}
      <button ref={mobileOpenerRef} className="rv-btn rv-btn-primary rv-mobile-nav-btn rv-noprint" aria-haspopup="dialog" onClick={() => setMobileNav(true)}>
        Sections
      </button>
      {mobileNav && (
        <>
          <div className="rv-scrim" onClick={closeMobile} />
          <div className="rv-drawer" style={{ padding: 'var(--rv-5)' }} role="dialog" aria-modal="true" aria-label="Report sections">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--rv-3)' }}>
              <div className="rv-h3">Jump to section</div>
              <button ref={mobileCloseRef} className="rv-btn rv-btn-ghost" onClick={closeMobile} aria-label="Close section navigator">Close</button>
            </div>
            {navItems.map(it => (
              <a key={it.id} className="rv-nav-link" href={`#rv-${it.id}`} onClick={e => { e.preventDefault(); goto(it.id); }}>
                {it.label}
              </a>
            ))}
          </div>
        </>
      )}

      {/* Opportunity drawer */}
      {drawer && <OpportunityDrawer opp={drawer} report={r} closeRef={drawerCloseRef} onClose={closeDrawer} />}

      {/* Back to top */}
      {showTop && (
        <button
          className="rv-btn rv-noprint"
          aria-label="Back to top"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          style={{ position: 'fixed', bottom: 18, right: 18, zIndex: 50, width: 38, height: 38, padding: 0, boxShadow: 'var(--rv-shadow-lg)' }}
        >
          ↑
        </button>
      )}
    </div>
  );
}

function NarrativeBody({
  sections,
  query,
  onCite,
}: {
  sections: Array<{ key: string; title: string; markdown: string }>;
  query: string;
  onCite?: (id: string) => void;
}) {
  return (
    <div className="rv-stack-gap" style={{ gap: 'var(--rv-5)' }}>
      {sections.map(s => (
        <div key={s.key}>
          {sections.length > 1 && (
            <div className="rv-h3" style={{ marginBottom: 'var(--rv-2)' }}>
              <HL text={s.title} query={query} />
            </div>
          )}
          <ReportMarkdown markdown={s.markdown} query={query} onCite={onCite} />
        </div>
      ))}
    </div>
  );
}

function OpportunityDrawer({
  opp,
  report,
  closeRef,
  onClose,
}: {
  opp: RankedOpportunity;
  report: ReportResponse['structured'];
  closeRef: RefObject<HTMLButtonElement>;
  onClose: () => void;
}) {
  const all = report.rankedOpportunities;
  const next = all.find(o => o.rank === opp.rank + 1);
  const gap = next ? opp.opportunityScore - next.opportunityScore : null;
  const v = report.executiveVerdict;
  return (
    <>
      <div className="rv-scrim" onClick={onClose} />
      <div className="rv-drawer" style={{ padding: 'var(--rv-6)' }} role="dialog" aria-modal="true" aria-label={`Opportunity ${opp.rank}: ${opp.opportunity}`}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 8 }}>
          <div className="rv-eyebrow rv-accent">Opportunity #{opp.rank}</div>
          <button ref={closeRef} className="rv-btn rv-btn-ghost" onClick={onClose} aria-label="Close opportunity details">Close</button>
        </div>
        <h3 className="rv-h1" style={{ marginTop: 6 }}>{opp.opportunity}</h3>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 'var(--rv-4)' }}>
          <span className="rv-display rv-num rv-accent">{opp.opportunityScore}</span>
          <span className="rv-muted">/ 100 · ranked #{opp.rank} of {all.length}</span>
        </div>
        {gap != null && (
          <p className="rv-small rv-dim" style={{ marginTop: 6 }}>
            {gap > 0 ? `${gap} points ahead of the #${opp.rank + 1} path.` : 'Tied with the next-ranked path.'}
          </p>
        )}

        <hr className="rv-hair" />
        <div className="rv-detail-group">
          <h4>Ranking context</h4>
          <div className="rv-detail-row"><div className="rv-detail-label">Best segment</div><div className="rv-detail-value">{leadValue(v.bestSegment).head}</div></div>
          <div className="rv-detail-row"><div className="rv-detail-label">Best customer</div><div className="rv-detail-value">{leadValue(v.bestCustomer).head}</div></div>
          <div className="rv-detail-row"><div className="rv-detail-label">Time to revenue</div><div className="rv-detail-value">{leadValue(v.timeToFirstRevenue).head}</div></div>
          <div className="rv-detail-row"><div className="rv-detail-label">Initial capital</div><div className="rv-detail-value">{leadValue(v.initialCapital).head}</div></div>
        </div>
        <p className="rv-micro rv-muted" style={{ marginTop: 'var(--rv-4)' }}>
          This report scores and ranks entry paths; per-opportunity economics were reported as shared narrative rather than
          separate structured fields. See the Economics, Entry strategy, and Evidence sections for the supporting detail.
        </p>
      </div>
    </>
  );
}
