'use client';

import type { Claim, EvidenceSource } from '@hopwhistle/shared';
import { ExternalLink, Search } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const STRONG = new Set(['verified_fact']);
const WEAK = new Set(['unverified_industry_claim', 'hypothesis']);

function isStrong(c: Claim): boolean {
  return STRONG.has(c.classification) || c.supportingSourceIds.length >= 2;
}

/**
 * Searchable, filterable Sources & Evidence workspace. Replaces the count-only
 * Evidence tab: users can search claims and sources, filter by classification /
 * provider / confidence, follow a claim to its sources and vice-versa, and see
 * contradictory and unresolved evidence — no raw JSON.
 */
export function SourcesWorkspace({
  sources,
  evidence,
}: {
  sources: EvidenceSource[];
  evidence: Claim[];
}) {
  const [tab, setTab] = useState<'claims' | 'sources'>('claims');
  const [q, setQ] = useState('');
  const [classFilter, setClassFilter] = useState('all');
  const [providerFilter, setProviderFilter] = useState('all');
  const [minConf, setMinConf] = useState(0);
  const [expandedSource, setExpandedSource] = useState<string | null>(null);

  const sourceById = useMemo(() => new Map(sources.map(s => [s.sourceId, s])), [sources]);
  const claimsBySource = useMemo(() => {
    const m = new Map<string, Claim[]>();
    for (const c of evidence)
      for (const sid of c.supportingSourceIds) {
        if (!m.has(sid)) m.set(sid, []);
        m.get(sid)!.push(c);
      }
    return m;
  }, [evidence]);

  const summary = useMemo(() => {
    const material = evidence.filter(c => c.materiality >= 0.5);
    return {
      sources: sources.length,
      material: material.length,
      strong: evidence.filter(isStrong).length,
      partial: evidence.filter(c => c.supportingSourceIds.length === 1 && !isStrong(c)).length,
      unresolved: evidence.filter(
        c => WEAK.has(c.classification) || c.supportingSourceIds.length === 0
      ).length,
    };
  }, [evidence, sources]);

  const classifications = useMemo(
    () => Array.from(new Set(evidence.map(c => c.classification))),
    [evidence]
  );
  const providers = useMemo(
    () => Array.from(new Set([...evidence.map(c => c.provider), ...sources.map(s => s.provider)])),
    [evidence, sources]
  );

  const filteredClaims = useMemo(() => {
    const query = q.trim().toLowerCase();
    return evidence.filter(c => {
      if (query && !c.text.toLowerCase().includes(query)) return false;
      if (classFilter !== 'all' && c.classification !== classFilter) return false;
      if (providerFilter !== 'all' && c.provider !== providerFilter) return false;
      if (c.confidence < minConf) return false;
      return true;
    });
  }, [evidence, q, classFilter, providerFilter, minConf]);

  const filteredSources = useMemo(() => {
    const query = q.trim().toLowerCase();
    return sources.filter(s => {
      if (
        query &&
        !(s.title ?? '').toLowerCase().includes(query) &&
        !s.url.toLowerCase().includes(query)
      )
        return false;
      if (providerFilter !== 'all' && s.provider !== providerFilter) return false;
      return true;
    });
  }, [sources, q, providerFilter]);

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <SummaryCard label="Sources" value={summary.sources} />
        <SummaryCard label="Material claims" value={summary.material} />
        <SummaryCard label="Strongly supported" value={summary.strong} tone="good" />
        <SummaryCard label="Partially supported" value={summary.partial} tone="warn" />
        <SummaryCard label="Unresolved" value={summary.unresolved} tone="bad" />
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-border p-0.5">
          {(['claims', 'sources'] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                'rounded-md px-3 py-1 text-sm font-medium capitalize transition-colors',
                tab === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="relative min-w-[180px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder={tab === 'claims' ? 'Search claims…' : 'Search sources…'}
            className="h-9 pl-8"
            aria-label={`Search ${tab}`}
          />
        </div>
        {tab === 'claims' && (
          <select
            value={classFilter}
            onChange={e => setClassFilter(e.target.value)}
            className="h-9 rounded-md border border-border bg-background px-2 text-sm"
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
          value={providerFilter}
          onChange={e => setProviderFilter(e.target.value)}
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
          aria-label="Filter by source"
        >
          <option value="all">All sources</option>
          {providers.map(p => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        {tab === 'claims' && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            min conf
            <select
              value={minConf}
              onChange={e => setMinConf(Number(e.target.value))}
              className="h-9 rounded-md border border-border bg-background px-2 text-sm"
              aria-label="Minimum confidence"
            >
              <option value={0}>any</option>
              <option value={0.5}>50%+</option>
              <option value={0.7}>70%+</option>
              <option value={0.9}>90%+</option>
            </select>
          </label>
        )}
      </div>

      {/* Claims */}
      {tab === 'claims' &&
        (filteredClaims.length === 0 ? (
          <Empty>No claims match these filters.</Empty>
        ) : (
          <ul className="space-y-2">
            {filteredClaims.map(c => (
              <li key={c.claimId} className="rounded-lg border border-border p-3">
                <p className="text-sm">{c.text}</p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                  <Badge variant="outline" className="text-[10px]">
                    {c.classification.replace(/_/g, ' ')}
                  </Badge>
                  <span className="text-muted-foreground">
                    conf {Math.round(c.confidence * 100)}%
                  </span>
                  <span className="text-muted-foreground">
                    · materiality {Math.round(c.materiality * 100)}%
                  </span>
                  {c.contradictingSourceIds.length > 0 && (
                    <Badge variant="warning" className="text-[10px]">
                      {c.contradictingSourceIds.length} contradicting
                    </Badge>
                  )}
                </div>
                {c.supportingSourceIds.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {c.supportingSourceIds.map(sid => {
                      const s = sourceById.get(sid);
                      if (!s) return null;
                      return (
                        <a
                          key={sid}
                          href={s.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          <ExternalLink className="h-3 w-3 flex-shrink-0" />
                          <span className="truncate">{s.title ?? s.url}</span>
                        </a>
                      );
                    })}
                  </div>
                )}
              </li>
            ))}
          </ul>
        ))}

      {/* Sources */}
      {tab === 'sources' &&
        (filteredSources.length === 0 ? (
          <Empty>No sources match these filters.</Empty>
        ) : (
          <ul className="space-y-2">
            {filteredSources.map(s => {
              const supports = claimsBySource.get(s.sourceId) ?? [];
              const open = expandedSource === s.sourceId;
              return (
                <li key={s.sourceId} className="rounded-lg border border-border p-3">
                  <div className="flex items-start gap-2">
                    <Badge
                      variant={s.validated ? 'success' : 'outline'}
                      className="mt-0.5 flex-shrink-0 text-[10px]"
                    >
                      {s.validated ? 'validated' : 'unverified'}
                    </Badge>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="break-all text-sm text-primary hover:underline"
                      aria-label={`Open source in a new tab: ${s.title ?? s.url}`}
                    >
                      {s.title ?? s.url}
                    </a>
                  </div>
                  <div className="mt-1 pl-1 text-xs">
                    {supports.length > 0 ? (
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => setExpandedSource(open ? null : s.sourceId)}
                        className="text-primary hover:underline"
                      >
                        {open ? 'Hide' : 'Show'} {supports.length} supported claim
                        {supports.length === 1 ? '' : 's'}
                      </button>
                    ) : (
                      <span className="text-muted-foreground">
                        Not yet tied to a specific claim
                      </span>
                    )}
                  </div>
                  {open && supports.length > 0 && (
                    <ul className="mt-2 space-y-1 border-t border-border/60 pt-2">
                      {supports.map(c => (
                        <li key={c.claimId} className="flex items-start gap-1.5 text-xs">
                          <Badge variant="outline" className="mt-0.5 flex-shrink-0 text-[9px]">
                            {c.classification.replace(/_/g, ' ')}
                          </Badge>
                          <span>{c.text}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        ))}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'good' | 'warn' | 'bad';
}) {
  const color =
    tone === 'good'
      ? 'text-emerald-500'
      : tone === 'warn'
        ? 'text-amber-500'
        : tone === 'bad'
          ? 'text-destructive'
          : 'text-foreground';
  return (
    <div className="rounded-lg border border-border p-3 text-center">
      <div className={cn('text-2xl font-bold tabular-nums', color)}>{value}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
