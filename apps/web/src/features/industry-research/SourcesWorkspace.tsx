'use client';

import type { Claim, EvidenceSource } from '@hopwhistle/shared';
import { useMemo, useState } from 'react';

import { SearchHighlight } from './ui/highlight';
import { buildSourcePreview, domainOf } from './ui/report-helpers';

const STRONG = new Set(['verified_fact']);
const WEAK = new Set(['unverified_industry_claim', 'hypothesis']);

function isStrong(c: Claim): boolean {
  return STRONG.has(c.classification) || c.supportingSourceIds.length >= 2;
}

/**
 * Sources & Evidence workspace in the institutional design (compact summary strip,
 * thin dividers, institutional tables, expandable rows, restrained status text —
 * no oversized number cards, rounded claim cards, or decorative badges). Supports
 * claim→source and source→claim navigation and a real source preview.
 */
export function SourcesWorkspace({
  sources,
  evidence,
  highlight = '',
}: {
  sources: EvidenceSource[];
  evidence: Claim[];
  highlight?: string;
}) {
  const [tab, setTab] = useState<'claims' | 'sources'>('claims');
  const [q, setQ] = useState('');
  const [classFilter, setClassFilter] = useState('all');
  const [providerFilter, setProviderFilter] = useState('all');
  const [minConf, setMinConf] = useState(0);
  const [openSource, setOpenSource] = useState<string | null>(null);
  const [openClaim, setOpenClaim] = useState<string | null>(null);

  const sourceById = useMemo(() => new Map(sources.map(s => [s.sourceId, s])), [sources]);
  const supportingClaims = useMemo(() => {
    const m = new Map<string, Claim[]>();
    for (const c of evidence)
      for (const sid of c.supportingSourceIds) (m.get(sid) ?? m.set(sid, []).get(sid)!).push(c);
    return m;
  }, [evidence]);
  const contradictingClaims = useMemo(() => {
    const m = new Map<string, Claim[]>();
    for (const c of evidence)
      for (const sid of c.contradictingSourceIds) (m.get(sid) ?? m.set(sid, []).get(sid)!).push(c);
    return m;
  }, [evidence]);

  const summary = useMemo(
    () => ({
      sources: sources.length,
      material: evidence.filter(c => c.materiality >= 0.5).length,
      strong: evidence.filter(isStrong).length,
      partial: evidence.filter(c => c.supportingSourceIds.length === 1 && !isStrong(c)).length,
      unresolved: evidence.filter(
        c => WEAK.has(c.classification) || c.supportingSourceIds.length === 0
      ).length,
    }),
    [evidence, sources]
  );

  const classifications = useMemo(
    () => Array.from(new Set(evidence.map(c => c.classification))),
    [evidence]
  );
  const providers = useMemo(
    () => Array.from(new Set([...evidence.map(c => c.provider), ...sources.map(s => s.provider)])),
    [evidence, sources]
  );

  const query = q.trim().toLowerCase();
  const filteredClaims = useMemo(
    () =>
      evidence.filter(c => {
        if (query && !c.text.toLowerCase().includes(query)) return false;
        if (classFilter !== 'all' && c.classification !== classFilter) return false;
        if (providerFilter !== 'all' && c.provider !== providerFilter) return false;
        if (c.confidence < minConf) return false;
        return true;
      }),
    [evidence, query, classFilter, providerFilter, minConf]
  );
  const filteredSources = useMemo(
    () =>
      sources.filter(s => {
        if (
          query &&
          !(s.title ?? '').toLowerCase().includes(query) &&
          !s.url.toLowerCase().includes(query)
        )
          return false;
        if (providerFilter !== 'all' && s.provider !== providerFilter) return false;
        return true;
      }),
    [sources, query, providerFilter]
  );

  const selectStyle = 'ir-field';

  return (
    <div>
      {/* Compact summary strip */}
      <div className="ir-strip" style={{ marginBottom: 12 }}>
        <StripStat label="Sources" value={summary.sources} />
        <StripStat label="Material claims" value={summary.material} />
        <StripStat label="Strongly supported" value={summary.strong} cls="ir-pos" />
        <StripStat label="Partially supported" value={summary.partial} cls="ir-warn" />
        <StripStat label="Unresolved" value={summary.unresolved} cls="ir-neg" />
      </div>

      {/* Controls */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          alignItems: 'center',
          marginBottom: 10,
        }}
      >
        <div
          style={{ display: 'inline-flex', border: '1px solid var(--ir-border)', borderRadius: 4 }}
        >
          {(['claims', 'sources'] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              aria-pressed={tab === t}
              style={{
                height: 30,
                padding: '0 12px',
                border: 0,
                background: tab === t ? 'var(--ir-accent)' : 'transparent',
                color: tab === t ? '#fff' : 'var(--ir-text-2)',
                fontSize: 13,
                fontWeight: 500,
                textTransform: 'capitalize',
                cursor: 'pointer',
              }}
            >
              {t}
            </button>
          ))}
        </div>
        <input
          className="ir-field"
          style={{ height: 30, flex: 1, minWidth: 160 }}
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder={tab === 'claims' ? 'Filter claims…' : 'Filter sources…'}
          aria-label={`Filter ${tab}`}
        />
        {tab === 'claims' && (
          <select
            className={selectStyle}
            style={{ height: 30, width: 'auto' }}
            value={classFilter}
            onChange={e => setClassFilter(e.target.value)}
            aria-label="Filter by classification"
          >
            <option value="all">All types</option>
            {classifications.map(c => (
              <option key={c} value={c}>
                {c.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        )}
        <select
          className={selectStyle}
          style={{ height: 30, width: 'auto' }}
          value={providerFilter}
          onChange={e => setProviderFilter(e.target.value)}
          aria-label="Filter by discovering provider"
        >
          <option value="all">All providers</option>
          {providers.map(p => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        {tab === 'claims' && (
          <select
            className={selectStyle}
            style={{ height: 30, width: 'auto' }}
            value={minConf}
            onChange={e => setMinConf(Number(e.target.value))}
            aria-label="Minimum confidence"
          >
            <option value={0}>Any confidence</option>
            <option value={0.5}>50%+</option>
            <option value={0.7}>70%+</option>
            <option value={0.9}>90%+</option>
          </select>
        )}
      </div>

      {/* Claims — thin-divider rows, expandable to sources */}
      {tab === 'claims' &&
        (filteredClaims.length === 0 ? (
          <p className="ir-muted" style={{ fontSize: 13 }}>
            No claims match these filters.
          </p>
        ) : (
          <div style={{ borderTop: '1px solid var(--ir-border)' }}>
            {filteredClaims.map(c => {
              const open = openClaim === c.claimId;
              const srcs = c.supportingSourceIds
                .map(id => sourceById.get(id))
                .filter(Boolean) as EvidenceSource[];
              return (
                <div
                  key={c.claimId}
                  style={{ borderBottom: '1px solid var(--ir-border)', padding: '10px 0' }}
                >
                  <div style={{ fontSize: 14 }}>
                    <SearchHighlight text={c.text} query={highlight} />
                  </div>
                  <div
                    className="ir-muted"
                    style={{
                      fontSize: 11,
                      marginTop: 4,
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 10,
                    }}
                  >
                    <span>{c.classification.replace(/_/g, ' ')}</span>
                    <span>conf {Math.round(c.confidence * 100)}%</span>
                    <span>materiality {Math.round(c.materiality * 100)}%</span>
                    <span>via {c.provider}</span>
                    {c.contradictingSourceIds.length > 0 && (
                      <span className="ir-warn">
                        {c.contradictingSourceIds.length} contradicting
                      </span>
                    )}
                    {srcs.length > 0 && (
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => setOpenClaim(open ? null : c.claimId)}
                        style={{
                          background: 'none',
                          border: 0,
                          padding: 0,
                          color: 'var(--ir-accent)',
                          cursor: 'pointer',
                          fontSize: 11,
                        }}
                      >
                        {open ? 'Hide' : 'Show'} {srcs.length} source{srcs.length === 1 ? '' : 's'}
                      </button>
                    )}
                  </div>
                  {open && srcs.length > 0 && (
                    <ul style={{ margin: '8px 0 0', paddingLeft: 0, listStyle: 'none' }}>
                      {srcs.map(s => (
                        <li key={s.sourceId} style={{ padding: '2px 0' }}>
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            style={{ fontSize: 12, color: 'var(--ir-accent)' }}
                            aria-label={`Open source in a new tab: ${s.title ?? s.url}`}
                          >
                            {s.title ?? s.url} ↗
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        ))}

      {/* Sources — thin-divider rows, expandable to a real preview */}
      {tab === 'sources' &&
        (filteredSources.length === 0 ? (
          <p className="ir-muted" style={{ fontSize: 13 }}>
            No sources match these filters.
          </p>
        ) : (
          <div style={{ borderTop: '1px solid var(--ir-border)' }}>
            {filteredSources.map(s => {
              const open = openSource === s.sourceId;
              const support = supportingClaims.get(s.sourceId) ?? [];
              const contra = contradictingClaims.get(s.sourceId) ?? [];
              return (
                <div
                  key={s.sourceId}
                  style={{ borderBottom: '1px solid var(--ir-border)', padding: '10px 0' }}
                >
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                    <span
                      className={s.validated ? 'ir-pos' : 'ir-muted'}
                      style={{ fontSize: 11, fontWeight: 600, flexShrink: 0 }}
                    >
                      {s.validated ? 'Validated' : 'Unverified'}
                    </span>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      style={{ fontSize: 14, color: 'var(--ir-accent)', wordBreak: 'break-word' }}
                      aria-label={`Open source in a new tab: ${s.title ?? s.url}`}
                    >
                      <SearchHighlight text={s.title ?? s.url} query={highlight} /> ↗
                    </a>
                  </div>
                  <div
                    className="ir-muted"
                    style={{
                      fontSize: 11,
                      marginTop: 3,
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 10,
                    }}
                  >
                    <span>{domainOf(s.url)}</span>
                    <span>via {s.provider}</span>
                    {support.length > 0 && (
                      <span>
                        {support.length} supported claim{support.length === 1 ? '' : 's'}
                      </span>
                    )}
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => setOpenSource(open ? null : s.sourceId)}
                      style={{
                        background: 'none',
                        border: 0,
                        padding: 0,
                        color: 'var(--ir-accent)',
                        cursor: 'pointer',
                        fontSize: 11,
                      }}
                    >
                      {open ? 'Hide preview' : 'Preview'}
                    </button>
                  </div>

                  {open &&
                    (() => {
                      const preview = buildSourcePreview(s);
                      return (
                        <div
                          style={{
                            marginTop: 8,
                            border: '1px solid var(--ir-border)',
                            borderRadius: 4,
                            padding: 12,
                          }}
                        >
                          <table className="ir-table">
                            <tbody>
                              <PreviewRow k="Title" v={preview.title} />
                              <PreviewRow k="Domain / publisher" v={preview.domain} />
                              <PreviewRow k="Publication date" v={preview.publishedDate} />
                              <PreviewRow k="Source type" v={preview.sourceType} />
                              <PreviewRow k="Validation status" v={preview.validation} />
                              <PreviewRow k="Discovered by" v={preview.provider} />
                            </tbody>
                          </table>
                          <div
                            className="ir-muted"
                            style={{ fontSize: 12, marginTop: 8, fontStyle: 'italic' }}
                          >
                            {preview.previewText ?? 'No preview text available.'}
                          </div>
                          {support.length > 0 && (
                            <div style={{ marginTop: 10 }}>
                              <div className="ir-eyebrow">Supporting claims</div>
                              <ul style={{ margin: '4px 0 0', paddingLeft: 0, listStyle: 'none' }}>
                                {support.map(c => (
                                  <li key={c.claimId} style={{ fontSize: 12, padding: '2px 0' }}>
                                    {c.text}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {contra.length > 0 && (
                            <div style={{ marginTop: 10 }}>
                              <div className="ir-eyebrow ir-warn">Contradicting claims</div>
                              <ul style={{ margin: '4px 0 0', paddingLeft: 0, listStyle: 'none' }}>
                                {contra.map(c => (
                                  <li
                                    key={c.claimId}
                                    className="ir-warn"
                                    style={{ fontSize: 12, padding: '2px 0' }}
                                  >
                                    {c.text}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                </div>
              );
            })}
          </div>
        ))}
    </div>
  );
}

function StripStat({ label, value, cls }: { label: string; value: number; cls?: string }) {
  return (
    <div className="ir-strip-cell">
      <div className="ir-strip-label">{label}</div>
      <div className={`ir-strip-value ${cls ?? ''}`}>{value}</div>
    </div>
  );
}

function PreviewRow({ k, v }: { k: string; v?: string }) {
  return (
    <tr>
      <td className="ir-muted" style={{ width: 150 }}>
        {k}
      </td>
      <td>{v ?? 'Not established'}</td>
    </tr>
  );
}
