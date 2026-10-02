'use client';

import { useMemo, useState } from 'react';

import { Input } from '@/components/ui/input';
import {
  JURISDICTIONS,
  REGIONS,
  jurisdictionsInRegion,
  searchJurisdictions,
} from '@/lib/licensable-jurisdictions';
import { cn } from '@/lib/utils';

/**
 * Pick the states somebody is licensed in: search, a count, and a region
 * toggle. Controlled -- the caller owns the set -- so the invite dialog and
 * the first-sign-in screen choose states the same way.
 */
interface StatePickerProps {
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  /** Tailwind max-height class for the scrolling list. */
  listClassName?: string;
}

export function StatePicker({
  selected,
  onChange,
  listClassName = 'max-h-56',
}: StatePickerProps): JSX.Element {
  const [query, setQuery] = useState('');
  const visible = useMemo(() => searchJurisdictions(query), [query]);

  function toggle(code: string): void {
    const next = new Set(selected);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    onChange(next);
  }

  function toggleRegion(region: (typeof REGIONS)[number]): void {
    const codes = jurisdictionsInRegion(region).map(j => j.code);
    const next = new Set(selected);
    const allOn = codes.every(code => next.has(code));
    for (const code of codes) {
      if (allOn) next.delete(code);
      else next.add(code);
    }
    onChange(next);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <Input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Search by name or code…"
          aria-label="Search states"
        />
        <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
          <span className="font-semibold text-foreground">{selected.size}</span> of{' '}
          {JURISDICTIONS.length}
        </span>
      </div>
      <div className={cn('space-y-3 overflow-y-auto pr-1', listClassName)}>
        {REGIONS.map(region => {
          const items = visible.filter(j => j.region === region);
          if (items.length === 0) return null;
          const allOn = jurisdictionsInRegion(region).every(j => selected.has(j.code));
          return (
            <div key={region}>
              <div className="mb-1 flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  {region}
                </h4>
                <button
                  type="button"
                  onClick={() => toggleRegion(region)}
                  className="rounded px-1.5 py-0.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {allOn ? 'Clear region' : 'Select region'}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {items.map(j => {
                  const on = selected.has(j.code);
                  return (
                    <button
                      key={j.code}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      aria-label={`${j.name} (${j.code})`}
                      onClick={() => toggle(j.code)}
                      className={cn(
                        'flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm transition-colors',
                        on
                          ? 'border-primary/40 bg-primary/10 text-foreground'
                          : 'border-transparent bg-muted/40 text-muted-foreground hover:bg-muted'
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{j.name}</span>
                      <span className="shrink-0 font-mono text-[10px]">{j.code}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
