'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { RECIPROCAL_CODES, STATES, type Region, type StateRecord } from './state-data';

/**
 * Approximate tile cartogram: [column, row] on a 12 x 8 grid. Keeps every
 * jurisdiction on screen at once so the heat map needs no scrolling.
 */
const TILE_GRID: Record<string, [number, number]> = {
  AK: [1, 1],
  ME: [12, 1],
  VT: [11, 2],
  NH: [12, 2],
  WA: [1, 3],
  ID: [2, 3],
  MT: [3, 3],
  ND: [4, 3],
  MN: [5, 3],
  IL: [6, 3],
  WI: [7, 3],
  MI: [8, 3],
  NY: [9, 3],
  CT: [10, 3],
  RI: [11, 3],
  MA: [12, 3],
  OR: [1, 4],
  NV: [2, 4],
  WY: [3, 4],
  SD: [4, 4],
  IA: [5, 4],
  IN: [6, 4],
  OH: [7, 4],
  PA: [8, 4],
  NJ: [9, 4],
  CA: [1, 5],
  UT: [2, 5],
  CO: [3, 5],
  NE: [4, 5],
  MO: [5, 5],
  KY: [6, 5],
  WV: [7, 5],
  VA: [8, 5],
  MD: [9, 5],
  DE: [10, 5],
  AZ: [2, 6],
  NM: [3, 6],
  KS: [4, 6],
  AR: [5, 6],
  TN: [6, 6],
  NC: [7, 6],
  SC: [8, 6],
  DC: [9, 6],
  OK: [4, 7],
  LA: [5, 7],
  MS: [6, 7],
  AL: [7, 7],
  GA: [8, 7],
  HI: [1, 8],
  TX: [4, 8],
  FL: [9, 8],
};

const REGIONS: Region[] = ['Northeast', 'Midwest', 'South', 'West'];

type SortKey =
  | 'valueIndex'
  | 'name'
  | 'region'
  | 'population'
  | 'seniors'
  | 'totalFee'
  | 'costPer1k';
type SortDir = 'asc' | 'desc';

interface ScoredState extends StateRecord {
  /** State fee after the reciprocal-jurisdiction adjustment. */
  effectiveStateFee: number;
  totalFee: number;
  /** Dollars spent per 1,000 residents aged 55-80. Lower is better. */
  costPer1k: number;
  /** 0-100, where 100 is the strongest senior-population-per-dollar in the set. */
  valueIndex: number;
  isReciprocal: boolean;
  isResident: boolean;
  rank: number;
}

const num = new Intl.NumberFormat('en-US');
const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

/** Keeps sub-1 indices legible: 0.5 rather than a bare 0. */
function fmtIndex(n: number): string {
  return n.toFixed(n >= 10 ? 0 : 1);
}

function compactNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return num.format(n);
}

/** Emerald ramp keyed to the value index — the single visual encoding of value. */
function heatStyle(index: number, max: number) {
  const t = max > 0 ? Math.min(1, index / max) : 0;
  const eased = Math.pow(t, 0.4);
  return {
    backgroundColor: `rgba(16, 185, 129, ${(0.08 + eased * 0.64).toFixed(3)})`,
    borderColor: `rgba(16, 185, 129, ${(0.18 + eased * 0.45).toFixed(3)})`,
    color: eased > 0.5 ? '#f0fdf4' : '#a7f3d0',
  };
}

export function StateValueTool() {
  const [residence, setResidence] = useState('FL');
  const [region, setRegion] = useState<Region | 'All'>('All');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'grid' | 'map'>('grid');
  const [sortKey, setSortKey] = useState<SortKey>('valueIndex');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [selected, setSelected] = useState<string[]>([]);

  /** Fees, value index and rank for every jurisdiction, given the resident state. */
  const scored = useMemo<ScoredState[]>(() => {
    const residentFee = STATES.find(s => s.code === residence)?.stateFee ?? 0;

    const withFees = STATES.map(s => {
      const isResident = s.code === residence;
      const isReciprocal = !isResident && (RECIPROCAL_CODES as readonly string[]).includes(s.code);
      const effectiveStateFee = isReciprocal ? residentFee : s.stateFee;
      const totalFee = effectiveStateFee + s.niprFee;
      return {
        ...s,
        isResident,
        isReciprocal,
        effectiveStateFee,
        totalFee,
        costPer1k: totalFee / (s.seniors / 1000),
        seniorsPerDollar: s.seniors / totalFee,
      };
    });

    const bestRate = Math.max(...withFees.map(s => s.seniorsPerDollar));
    const ranked = withFees
      .map(({ seniorsPerDollar, ...s }) => ({
        ...s,
        valueIndex: (seniorsPerDollar / bestRate) * 100,
      }))
      .sort((a, b) => b.valueIndex - a.valueIndex);

    return ranked.map((s, i) => ({ ...s, rank: i + 1 }));
  }, [residence]);

  const maxIndex = scored[0]?.valueIndex ?? 100;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = scored.filter(
      s =>
        (region === 'All' || s.region === region) &&
        (q === '' || s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q))
    );
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv) * dir;
      return ((av as number) - (bv as number)) * dir;
    });
  }, [scored, region, query, sortKey, sortDir]);

  const plan = useMemo(() => {
    const rows = scored.filter(s => selected.includes(s.code));
    return {
      rows,
      cost: rows.reduce((sum, s) => sum + s.totalFee, 0),
      seniors: rows.reduce((sum, s) => sum + s.seniors, 0),
    };
  }, [scored, selected]);

  const best = scored[0];
  const medianCost = useMemo(() => {
    const sorted = [...scored].map(s => s.costPer1k).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
  }, [scored]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      // Names sort A-Z first; every numeric column opens on its best value.
      setSortDir(
        key === 'name' || key === 'region' || key === 'costPer1k' || key === 'totalFee'
          ? 'asc'
          : 'desc'
      );
    }
  }

  function toggleSelect(code: string) {
    setSelected(prev => (prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]));
  }

  const columns: { key: SortKey; label: string; align: 'left' | 'right'; hint: string }[] = [
    { key: 'name', label: 'State', align: 'left', hint: 'Jurisdiction' },
    { key: 'region', label: 'Region', align: 'left', hint: 'Census region' },
    { key: 'population', label: 'Population', align: 'right', hint: 'Total residents' },
    { key: 'seniors', label: 'Ages 55-80', align: 'right', hint: 'Final expense market' },
    { key: 'totalFee', label: 'Total fee', align: 'right', hint: 'State fee + NIPR fee' },
    { key: 'costPer1k', label: '$ / 1K seniors', align: 'right', hint: 'Lower is better' },
    {
      key: 'valueIndex',
      label: 'Value index',
      align: 'right',
      hint: 'Seniors reached per dollar, best state = 100',
    },
  ];

  const controlClass =
    'h-8 rounded-lg border border-slate-800 bg-slate-900/70 px-2.5 text-xs text-slate-200 outline-none transition-colors hover:border-slate-700 focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/30';

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-[#070913] font-sans text-white selection:bg-emerald-500/30">
      {/* Header — mirrors the landing navigation */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-800/60 bg-slate-950/80 px-4 backdrop-blur-md md:px-6">
        <div className="flex items-center gap-3">
          <Link href="/" className="group flex items-center gap-2.5">
            <div className="relative h-7 w-7 overflow-hidden rounded-lg border border-slate-800 bg-slate-900 p-1 transition-all duration-300 group-hover:border-emerald-500/30">
              <Image
                src="/hopwhistle.png"
                alt="NetEnroll logo"
                fill
                className="object-contain p-1"
                priority
              />
            </div>
            <span className="text-base font-semibold tracking-tight text-white transition-colors group-hover:text-emerald-400">
              NetEnroll
            </span>
          </Link>
          <span className="hidden h-4 w-px bg-slate-800 sm:block" />
          <div className="hidden sm:block">
            <h1 className="text-sm font-medium leading-tight tracking-tight text-white">
              State Value Evaluator
            </h1>
            <p className="text-[11px] leading-tight text-slate-500">
              Senior market per licensing dollar, all 51 jurisdictions
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="rounded-lg px-3 py-1 text-xs font-medium text-slate-400 transition-colors hover:bg-slate-900 hover:text-white"
          >
            Back to site
          </Link>
          <a
            href="mailto:jimmy@leadzer.io"
            className="inline-flex h-8 items-center justify-center rounded-lg bg-emerald-500 px-3.5 text-xs font-semibold text-slate-950 shadow-sm shadow-emerald-500/20 transition-all duration-200 hover:bg-emerald-400 active:scale-95"
          >
            Talk to us
          </a>
        </div>
      </header>

      {/* Control bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-900 bg-slate-950/40 px-4 py-2 md:px-6">
        <label className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-slate-500">
          Resident state
          <select
            value={residence}
            onChange={e => setResidence(e.target.value)}
            className={controlClass}
          >
            {[...STATES]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map(s => (
                <option key={s.code} value={s.code} className="bg-slate-900">
                  {s.name}
                </option>
              ))}
          </select>
        </label>

        <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/70 p-0.5">
          {(['All', ...REGIONS] as const).map(r => (
            <button
              key={r}
              onClick={() => setRegion(r)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                region === r ? 'bg-emerald-500 text-slate-950' : 'text-slate-400 hover:text-white'
              }`}
            >
              {r}
            </button>
          ))}
        </div>

        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Filter states..."
          className={`${controlClass} w-40 placeholder:text-slate-600`}
        />

        <div className="ml-auto flex items-center gap-2">
          {selected.length > 0 && (
            <button
              onClick={() => setSelected([])}
              className="rounded-lg px-2.5 py-1 text-xs font-medium text-slate-400 transition-colors hover:text-white"
            >
              Clear {selected.length}
            </button>
          )}
          <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/70 p-0.5">
            {(['grid', 'map'] as const).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                  view === v ? 'bg-emerald-500 text-slate-950' : 'text-slate-400 hover:text-white'
                }`}
              >
                {v === 'grid' ? 'Data grid' : 'Heat map'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1 gap-3 p-3 md:px-6 md:py-3">
        <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          {/* KPI strip */}
          <div className="grid shrink-0 grid-cols-2 gap-2 lg:grid-cols-4">
            {[
              {
                label: 'Best value',
                value: best ? best.name : '—',
                sub: best ? `index ${fmtIndex(best.valueIndex)}` : '',
              },
              {
                label: 'Lowest cost / 1K',
                value: best ? `$${best.costPer1k.toFixed(4)}` : '—',
                sub: `median $${medianCost.toFixed(4)}`,
              },
              {
                label: 'Jurisdictions shown',
                value: String(visible.length),
                sub: `of ${scored.length}`,
              },
              {
                label: 'Plan cost',
                value: money.format(plan.cost),
                sub: plan.rows.length
                  ? `${compactNum(plan.seniors)} seniors reached`
                  : 'select rows to build',
              },
            ].map(kpi => (
              <div
                key={kpi.label}
                className="rounded-lg border border-slate-800/80 bg-slate-900/40 px-3 py-2"
              >
                <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                  {kpi.label}
                </div>
                <div className="truncate font-mono text-base font-medium tabular-nums text-emerald-400">
                  {kpi.value}
                </div>
                <div className="truncate text-[11px] text-slate-500">{kpi.sub}</div>
              </div>
            ))}
          </div>

          {/* Data grid */}
          {view === 'grid' ? (
            <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-800/80 bg-slate-900/20">
              <table className="w-full border-collapse text-xs">
                <thead className="sticky top-0 z-10 bg-slate-950">
                  <tr className="border-b border-slate-800">
                    <th className="w-8 px-2 py-2" />
                    <th className="w-10 px-1 py-2 text-right text-[10px] font-medium uppercase tracking-wider text-slate-500">
                      #
                    </th>
                    {columns.map(col => (
                      <th
                        key={col.key}
                        title={col.hint}
                        className={`px-2.5 py-2 ${col.align === 'right' ? 'text-right' : 'text-left'} ${
                          col.key === 'valueIndex' ? 'w-40' : ''
                        }`}
                      >
                        <button
                          onClick={() => toggleSort(col.key)}
                          className={`inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider transition-colors hover:text-white ${
                            sortKey === col.key ? 'text-emerald-400' : 'text-slate-500'
                          }`}
                        >
                          {col.label}
                          <span className="text-[9px] leading-none">
                            {sortKey === col.key ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
                          </span>
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map(s => {
                    const isSelected = selected.includes(s.code);
                    return (
                      <tr
                        key={s.code}
                        onClick={() => toggleSelect(s.code)}
                        className={`cursor-pointer border-b border-slate-900/70 transition-colors ${
                          isSelected ? 'bg-emerald-500/10' : 'hover:bg-slate-800/40'
                        }`}
                      >
                        <td className="px-2 py-1">
                          <span
                            className={`flex h-3.5 w-3.5 items-center justify-center rounded border text-[9px] leading-none ${
                              isSelected
                                ? 'border-emerald-400 bg-emerald-500 text-slate-950'
                                : 'border-slate-700 text-transparent'
                            }`}
                            aria-hidden
                          >
                            ✓
                          </span>
                        </td>
                        <td className="px-1 py-1 text-right font-mono text-[11px] tabular-nums text-slate-600">
                          {s.rank}
                        </td>
                        <td className="whitespace-nowrap px-2.5 py-1">
                          <span className="font-medium text-slate-100">{s.name}</span>
                          {s.isResident && (
                            <span className="ml-1.5 rounded bg-slate-800 px-1 py-px text-[9px] font-medium uppercase tracking-wide text-slate-400">
                              Resident
                            </span>
                          )}
                          {s.isReciprocal && (
                            <span className="ml-1.5 rounded bg-emerald-500/15 px-1 py-px text-[9px] font-medium uppercase tracking-wide text-emerald-400">
                              Recip
                            </span>
                          )}
                        </td>
                        <td className="px-2.5 py-1 text-slate-500">{s.region}</td>
                        <td className="px-2.5 py-1 text-right font-mono tabular-nums text-slate-400">
                          {compactNum(s.population)}
                        </td>
                        <td className="px-2.5 py-1 text-right font-mono tabular-nums text-slate-200">
                          {compactNum(s.seniors)}
                        </td>
                        <td className="px-2.5 py-1 text-right font-mono tabular-nums text-slate-300">
                          {money.format(s.totalFee)}
                        </td>
                        <td className="px-2.5 py-1 text-right font-mono tabular-nums text-slate-300">
                          ${s.costPer1k.toFixed(4)}
                        </td>
                        <td className="px-2.5 py-1">
                          <div className="flex items-center justify-end gap-2">
                            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-800">
                              <div
                                className="h-full rounded-full bg-emerald-500"
                                style={{
                                  width: `${Math.max(2, (s.valueIndex / maxIndex) * 100)}%`,
                                }}
                              />
                            </div>
                            <span className="w-10 text-right font-mono text-[13px] font-medium tabular-nums text-emerald-400">
                              {fmtIndex(s.valueIndex)}
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {visible.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-3 py-8 text-center text-slate-500">
                        No jurisdictions match those filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            /* Heat map — tile cartogram, no scrolling */
            <div className="min-h-0 flex-1 rounded-lg border border-slate-800/80 bg-slate-900/20 p-3">
              <div
                className="grid h-full gap-1"
                style={{
                  gridTemplateColumns: 'repeat(12, minmax(0, 1fr))',
                  gridTemplateRows: 'repeat(8, minmax(0, 1fr))',
                }}
              >
                {scored.map(s => {
                  const [col, row] = TILE_GRID[s.code] ?? [1, 1];
                  const dimmed = !visible.some(v => v.code === s.code);
                  const isSelected = selected.includes(s.code);
                  return (
                    <button
                      key={s.code}
                      onClick={() => toggleSelect(s.code)}
                      title={`${s.name} — value index ${fmtIndex(s.valueIndex)}, $${s.costPer1k.toFixed(4)} per 1,000 seniors, ${money.format(s.totalFee)} total fee`}
                      style={{
                        gridColumn: col,
                        gridRow: row,
                        ...heatStyle(s.valueIndex, maxIndex),
                        opacity: dimmed ? 0.18 : 1,
                      }}
                      className={`flex flex-col items-center justify-center rounded border transition-transform duration-150 hover:scale-105 ${
                        isSelected
                          ? 'ring-2 ring-emerald-400 ring-offset-1 ring-offset-[#070913]'
                          : ''
                      }`}
                    >
                      <span className="font-mono text-[11px] font-semibold leading-none">
                        {s.code}
                      </span>
                      <span className="mt-0.5 font-mono text-[10px] leading-none opacity-80">
                        {fmtIndex(s.valueIndex)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </main>

        {/* Licensing plan rail */}
        <aside className="hidden w-64 shrink-0 flex-col gap-3 xl:flex">
          <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-slate-800/80 bg-slate-900/40">
            <div className="shrink-0 border-b border-slate-800 px-3 py-2">
              <h2 className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                Licensing plan
              </h2>
              <p className="text-[11px] text-slate-500">Click any state to add it</p>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {plan.rows.length === 0 ? (
                <p className="px-3 py-4 text-[11px] leading-relaxed text-slate-600">
                  No states selected. Sort by value index and add the top jurisdictions to price out
                  a multi-state licensing run.
                </p>
              ) : (
                plan.rows.map(s => (
                  <button
                    key={s.code}
                    onClick={() => toggleSelect(s.code)}
                    className="flex w-full items-center justify-between border-b border-slate-900/70 px-3 py-1 text-left transition-colors hover:bg-slate-800/40"
                  >
                    <span className="truncate text-xs text-slate-200">{s.name}</span>
                    <span className="ml-2 font-mono text-[11px] tabular-nums text-slate-400">
                      {money.format(s.totalFee)}
                    </span>
                  </button>
                ))
              )}
            </div>
            <div className="shrink-0 space-y-1 border-t border-slate-800 px-3 py-2">
              <div className="flex items-baseline justify-between">
                <span className="text-[11px] text-slate-500">Total cost</span>
                <span className="font-mono text-base font-medium tabular-nums text-emerald-400">
                  {money.format(plan.cost)}
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-[11px] text-slate-500">Seniors reached</span>
                <span className="font-mono text-xs tabular-nums text-slate-300">
                  {compactNum(plan.seniors)}
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-[11px] text-slate-500">Blended $ / 1K</span>
                <span className="font-mono text-xs tabular-nums text-slate-300">
                  {plan.seniors > 0 ? `$${(plan.cost / (plan.seniors / 1000)).toFixed(4)}` : '—'}
                </span>
              </div>
            </div>
          </div>

          <div className="shrink-0 rounded-lg border border-slate-800/80 bg-slate-900/40 px-3 py-2">
            <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-500">
              Value index
            </div>
            <div className="flex h-1.5 overflow-hidden rounded-full">
              {[0.1, 0.3, 0.5, 0.7, 0.9].map(t => (
                <div
                  key={t}
                  className="flex-1"
                  style={{ backgroundColor: `rgba(16, 185, 129, ${0.06 + t * 0.62})` }}
                />
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-slate-500">
              <span>Low</span>
              <span>High</span>
            </div>
          </div>
        </aside>
      </div>

      {/* Footnote */}
      <footer className="flex h-8 shrink-0 items-center justify-between border-t border-slate-900 px-4 text-[11px] text-slate-600 md:px-6">
        <span>
          Value index = residents aged 55-80 reached per licensing dollar, indexed to the strongest
          jurisdiction.
        </span>
        <span className="hidden sm:inline">
          New York and Tennessee are reciprocal — they charge your resident state fee.
        </span>
      </footer>
    </div>
  );
}
