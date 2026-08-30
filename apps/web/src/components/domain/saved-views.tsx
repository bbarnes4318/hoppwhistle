'use client';

import { Bookmark, Check, Plus, Trash2 } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

import { useThemeScope } from './theme-scope';

/**
 * SavedViews — named filter sets, per user.
 *
 * Every operator on these screens has three or four questions they ask daily
 * ("my disputed calls this week", "publishers under 40% billable"). Rebuilding
 * the filter stack each time is the tax this removes.
 *
 * Persistence is the caller's: pass `views` and the callbacks. `useSavedViews`
 * below is a localStorage-backed default so pages work before there is an API
 * for this — swap it for a server-backed hook without touching this component.
 */

export interface SavedView<TFilters = Record<string, unknown>> {
  id: string;
  name: string;
  filters: TFilters;
}

export interface SavedViewsProps<TFilters> {
  views: SavedView<TFilters>[];
  /** The filter state to store when someone saves the current view. */
  currentFilters: TFilters;
  /** Which view is applied, if any. */
  activeId?: string | null;
  onApply: (view: SavedView<TFilters>) => void;
  onCreate: (name: string, filters: TFilters) => void;
  onDelete: (id: string) => void;
  className?: string;
}

export function SavedViews<TFilters>({
  views,
  currentFilters,
  activeId,
  onApply,
  onCreate,
  onDelete,
  className,
}: SavedViewsProps<TFilters>) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  // PopoverContent is portalled — carry the theme scope onto it.
  const theme = useThemeScope();

  const active = views.find(v => v.id === activeId);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate(trimmed, currentFilters);
    setName('');
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            'h-8 gap-1.5 rounded-control border-rule bg-surface t-body text-ink',
            className
          )}
        >
          <Bookmark aria-hidden className="h-3.5 w-3.5 text-ink-3" />
          <span className="max-w-[140px] truncate">{active ? active.name : 'Views'}</span>
        </Button>
      </PopoverTrigger>

      <PopoverContent
        data-theme={theme}
        align="end"
        className="w-64 rounded-card border-rule bg-surface p-0"
      >
        <div className="border-b border-rule px-3 py-2">
          <h3 className="t-label text-ink-3">Saved views</h3>
        </div>

        {views.length === 0 ? (
          <p className="t-meta px-3 py-3 text-ink-3">
            No saved views yet. Set your filters, then name and save them here.
          </p>
        ) : (
          <ul className="max-h-56 overflow-y-auto py-1">
            {views.map(v => (
              <li key={v.id}>
                <div className="group flex items-center gap-1 px-1">
                  <button
                    type="button"
                    onClick={() => {
                      onApply(v);
                      setOpen(false);
                    }}
                    className={cn(
                      't-body flex min-w-0 flex-1 items-center gap-2 rounded-control px-2 py-1.5 text-left text-ink',
                      'hover:bg-sunken focus-visible:outline-none'
                    )}
                  >
                    <Check
                      aria-hidden
                      className={cn(
                        'h-3.5 w-3.5 shrink-0',
                        v.id === activeId ? 'text-live' : 'text-transparent'
                      )}
                    />
                    <span className="truncate">{v.name}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onDelete(v.id)}
                    aria-label={`Delete view ${v.name}`}
                    className="shrink-0 rounded-control p-1.5 text-ink-3 opacity-0 hover:bg-sunken hover:text-dropped focus-visible:opacity-100 group-hover:opacity-100 focus-visible:outline-none"
                  >
                    <Trash2 aria-hidden className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={submit} className="flex items-center gap-1 border-t border-rule p-2">
          <Input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Name this view"
            aria-label="Name for the current view"
            className="h-8 rounded-control border-rule bg-surface t-body text-ink placeholder:text-ink-3"
          />
          <Button
            type="submit"
            size="sm"
            disabled={!name.trim()}
            className="h-8 shrink-0 rounded-control bg-money px-2 text-white hover:bg-money/90 disabled:opacity-40"
            aria-label="Save current filters as a view"
          >
            <Plus aria-hidden className="h-3.5 w-3.5" />
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/**
 * localStorage-backed views, scoped by a key you choose (usually the page).
 * A stand-in until there is an endpoint: it is per-browser, not per-user, so
 * it does not follow anyone to another machine. Reads are guarded because
 * storage throws in private mode and in some embedded webviews.
 */
export function useSavedViews<TFilters>(storageKey: string) {
  const [views, setViews] = React.useState<SavedView<TFilters>[]>([]);
  const [activeId, setActiveId] = React.useState<string | null>(null);

  // Read after mount, never during render: the server has no localStorage and
  // reading it during render would produce a hydration mismatch.
  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) setViews(JSON.parse(raw) as SavedView<TFilters>[]);
    } catch {
      setViews([]);
    }
  }, [storageKey]);

  const persist = React.useCallback(
    (next: SavedView<TFilters>[]) => {
      setViews(next);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Quota or a blocked store: the views stay for this session only.
      }
    },
    [storageKey]
  );

  const create = React.useCallback(
    (name: string, filters: TFilters) => {
      const view: SavedView<TFilters> = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        name,
        filters,
      };
      persist([...views, view]);
      setActiveId(view.id);
    },
    [views, persist]
  );

  const remove = React.useCallback(
    (id: string) => {
      persist(views.filter(v => v.id !== id));
      setActiveId(cur => (cur === id ? null : cur));
    },
    [views, persist]
  );

  return { views, activeId, setActiveId, create, remove };
}
