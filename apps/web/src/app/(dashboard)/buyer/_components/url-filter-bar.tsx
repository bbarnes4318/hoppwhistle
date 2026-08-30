'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';

import { FilterBar, type FilterOption } from '@/components/domain';

/**
 * FilterBar bound to the URL.
 *
 * The pages behind this are server-rendered, so a filter has to change the
 * request, not component state. This is the one interactive leaf that does it:
 * it writes the query string, and Next re-renders the server component with the
 * new params. `useTransition` keeps the old rows on screen while that happens
 * instead of flashing the skeleton on every keystroke.
 */

export interface UrlSelect {
  param: string;
  label: string;
  allLabel?: string;
  options: FilterOption[];
}

export interface UrlFilterBarProps {
  search?: { param: string; placeholder: string };
  selects?: UrlSelect[];
  /** Binds the `range` preset plus `from`/`to` day inputs. */
  dateRange?: boolean;
  /** Params reset to page 1 whenever any filter changes. */
  pageParam?: string;
  children?: React.ReactNode;
}

const SEARCH_DEBOUNCE_MS = 350;

export function UrlFilterBar({
  search,
  selects = [],
  dateRange = false,
  pageParam = 'page',
  children,
}: UrlFilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = React.useTransition();

  const searchParam = search?.param;
  const urlSearch = searchParam ? (params.get(searchParam) ?? '') : '';
  const [searchDraft, setSearchDraft] = React.useState(urlSearch);

  // The URL is the source of truth: a back navigation or a "clear all" has to
  // win over whatever is in the box.
  React.useEffect(() => {
    setSearchDraft(urlSearch);
  }, [urlSearch]);

  const commit = React.useCallback(
    (mutate: (next: URLSearchParams) => void) => {
      const next = new URLSearchParams(params.toString());
      mutate(next);
      next.delete(pageParam);
      const qs = next.toString();
      startTransition(() => {
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      });
    },
    [params, pathname, pageParam, router]
  );

  // Debounced, so typing a phone number is one navigation and not eleven.
  React.useEffect(() => {
    if (!searchParam || searchDraft === urlSearch) return;
    const id = setTimeout(() => {
      commit(next => {
        if (searchDraft) next.set(searchParam, searchDraft);
        else next.delete(searchParam);
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [searchDraft, urlSearch, searchParam, commit]);

  const selectDescriptors = selects.map(s => ({
    id: s.param,
    label: s.label,
    allLabel: s.allLabel,
    options: s.options,
    value: params.get(s.param),
  }));

  return (
    <FilterBar
      search={
        search
          ? { value: searchDraft, onChange: setSearchDraft, placeholder: search.placeholder }
          : undefined
      }
      selects={selectDescriptors}
      onSelectChange={(id, value) =>
        commit(next => {
          if (value) next.set(id, value);
          else next.delete(id);
        })
      }
      dateRange={
        dateRange
          ? {
              value: { from: params.get('from'), to: params.get('to') },
              onChange: v =>
                commit(next => {
                  if (v.from) next.set('from', v.from);
                  else next.delete('from');
                  if (v.to) next.set('to', v.to);
                  else next.delete('to');
                  // Typing a day is choosing a custom window, so say so rather
                  // than leaving a preset selected that no longer describes it.
                  if (v.from || v.to) next.set('range', 'custom');
                  else next.delete('range');
                }),
            }
          : undefined
      }
      onClearAll={() =>
        commit(next => {
          if (searchParam) next.delete(searchParam);
          for (const s of selects) next.delete(s.param);
          next.delete('from');
          next.delete('to');
          next.delete('range');
        })
      }
    >
      {children}
    </FilterBar>
  );
}
