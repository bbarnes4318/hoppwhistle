'use client';

import { CAPABILITY_CATEGORIES, type CapabilityCategory } from '@hopwhistle/shared';
import { Check, Plus, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface Props {
  categories?: CapabilityCategory[];
  selected: string[];
  onChange: (next: string[]) => void;
}

const LABELS = new Map<string, string>();
for (const cat of CAPABILITY_CATEGORIES) for (const it of cat.items) LABELS.set(it.id, it.label);

function labelFor(id: string): string {
  return LABELS.get(id) ?? id;
}

export function CapabilityPicker({
  categories = CAPABILITY_CATEGORIES,
  selected,
  onChange,
}: Props) {
  const [query, setQuery] = useState('');
  const [custom, setCustom] = useState('');
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return categories;
    return categories
      .map(c => ({ ...c, items: c.items.filter(i => i.label.toLowerCase().includes(q)) }))
      .filter(c => c.items.length > 0);
  }, [categories, query]);

  const toggle = (id: string) => {
    if (selectedSet.has(id)) onChange(selected.filter(s => s !== id));
    else onChange([...selected, id]);
  };

  const selectCategory = (cat: CapabilityCategory) => {
    const ids = cat.items.map(i => i.id);
    const next = new Set(selected);
    ids.forEach(id => next.add(id));
    onChange(Array.from(next));
  };

  const clearCategory = (cat: CapabilityCategory) => {
    const ids = new Set(cat.items.map(i => i.id));
    onChange(selected.filter(s => !ids.has(s)));
  };

  const addCustom = () => {
    const value = custom.trim();
    if (!value) return;
    if (!selectedSet.has(value)) onChange([...selected, value]);
    setCustom('');
  };

  return (
    <div className="space-y-4">
      {/* Selected chips */}
      <div className="rounded-lg border border-border bg-muted/30 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Selected capabilities
          </span>
          <Badge variant="secondary">{selected.length}</Badge>
        </div>
        {selected.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            None selected yet. Choose from the categories below or add your own.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {selected.map(id => (
              <button
                key={id}
                type="button"
                onClick={() => toggle(id)}
                className="group inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
              >
                {labelFor(id)}
                <X className="h-3 w-3 opacity-60 group-hover:opacity-100" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search capabilities…"
          className="pl-9"
          aria-label="Search capabilities"
        />
      </div>

      {/* Custom entry */}
      <div className="flex gap-2">
        <Input
          value={custom}
          onChange={e => setCustom(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addCustom();
            }
          }}
          placeholder="Add a custom capability…"
          aria-label="Add a custom capability"
        />
        <Button type="button" variant="outline" onClick={addCustom} disabled={!custom.trim()}>
          <Plus className="mr-1 h-4 w-4" /> Add
        </Button>
      </div>

      {/* Categories */}
      <div className="grid gap-4 md:grid-cols-2">
        {filtered.map(cat => {
          const selectedInCat = cat.items.filter(i => selectedSet.has(i.id)).length;
          return (
            <div key={cat.id} className="rounded-lg border border-border p-3">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-semibold text-foreground">{cat.label}</h4>
                <div className="flex items-center gap-1">
                  {selectedInCat > 0 && (
                    <Badge variant="secondary" className="mr-1">
                      {selectedInCat}
                    </Badge>
                  )}
                  <button
                    type="button"
                    onClick={() => selectCategory(cat)}
                    className="text-[11px] font-medium text-primary hover:underline"
                  >
                    Select all
                  </button>
                  <span className="text-muted-foreground/40">·</span>
                  <button
                    type="button"
                    onClick={() => clearCategory(cat)}
                    className="text-[11px] font-medium text-muted-foreground hover:underline"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {cat.items.map(item => {
                  const active = selectedSet.has(item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => toggle(item.id)}
                      aria-pressed={active}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                        active
                          ? 'border-primary/40 bg-primary/10 text-primary'
                          : 'border-border bg-transparent text-muted-foreground hover:border-primary/30 hover:text-foreground'
                      )}
                    >
                      {active && <Check className="h-3 w-3" />}
                      {item.label}
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
