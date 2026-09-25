'use client';

import { AudioLines, CornerDownLeft, Loader2, Megaphone, Phone, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { formatPhone } from '@/components/domain';
import { useThemeScope } from '@/components/domain/theme-scope';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/hooks/use-auth';
import { usePlatformContext } from '@/hooks/use-platform-context';
import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';

import { allNavItems, navFor, PLATFORM_NAV } from './nav-config';

/**
 * Global command palette, cmd-K / ctrl-K.
 *
 * Searches calls by phone number or ID, plus campaigns, publishers and buyers,
 * and jumps to any page the current role can reach. Page jumps are local and
 * instant; the remote searches are debounced and run in parallel.
 *
 * Results are scoped by whatever the API already scopes them by — a publisher
 * searching calls gets their own calls, because /api/v1/calls filters on the
 * caller's own token. The palette does not widen anyone's access.
 */

interface CallHit {
  id: string;
  fromNumber?: string | null;
  toNumber?: string | null;
  campaignName?: string | null;
  status?: string | null;
}
interface NamedHit {
  id: string;
  name?: string | null;
  code?: string | null;
}

interface Results {
  calls: CallHit[];
  campaigns: NamedHit[];
  publishers: NamedHit[];
  buyers: NamedHit[];
}

const EMPTY: Results = { calls: [], campaigns: [], publishers: [], buyers: [] };

/** Digits only, so "(415) 555-0142" and "+14155550142" both search usefully. */
function looksLikePhone(q: string): boolean {
  const digits = q.replace(/\D/g, '');
  return digits.length >= 4 && digits.length / q.length > 0.5;
}

/**
 * Two layers have to come off. apiClient resolves with `{ data: <parsed body> }`,
 * and the list endpoints themselves return `{ data: [...] }` — so the array sits
 * at res.data.data. Some endpoints return a bare array instead, so both shapes
 * are tolerated at each level rather than assuming one.
 */
function unwrap<T>(res: unknown): T[] {
  const outer = (res as { data?: unknown } | null)?.data ?? res;
  if (Array.isArray(outer)) return outer as T[];
  const inner = (outer as { data?: unknown } | null)?.data;
  if (Array.isArray(inner)) return inner as T[];
  return [];
}

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const theme = useThemeScope();
  const auth = useAuth();
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<Results>(EMPTY);
  const [loading, setLoading] = React.useState(false);

  const platform = usePlatformContext();
  const previewing = platform.previewRole != null || auth.user?.previewRole != null;

  const pages = React.useMemo(() => {
    // The sidebar's own answer, from the same function, so the palette never
    // offers a page the sidebar does not -- including under a role preview.
    const groups = navFor({ ...auth, previewing });
    if (groups.length > 0) return allNavItems(groups);
    return allNavItems(PLATFORM_NAV).filter(i => i.href === '/dashboard');
  }, [auth, previewing]);

  /**
   * Whether this viewer's own navigation has a given destination in it.
   *
   * The palette searches campaigns, publishers and buyers remotely and links
   * the hits to `/campaigns/:id`, `/publishers?id=` and `/buyers?id=`. Those
   * are three of the screens an agency principal no longer has, and the
   * searches were gated on whether the viewer's TOKEN could list the records --
   * which it still can, because the endpoints back screens that are staying
   * (the Calls ledger builds its filters from both lists). So an owner who
   * typed two characters got a tidy list of links into pages that now redirect
   * them straight back out.
   *
   * Asking the nav instead of naming the roles keeps this answer attached to
   * the one list in `lib/staff-only-routes.ts`: a destination that leaves
   * somebody's sidebar leaves their search results in the same edit. It also
   * retires a quiet oddity -- `canListParties` included agents, who have never
   * had a publishers or buyers page to be sent to.
   */
  const canReach = React.useCallback(
    (href: string) => pages.some(item => item.href.split('?')[0] === href),
    [pages]
  );

  // Remote search: debounced, and only for queries long enough to be meaningful.
  React.useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2) {
      setResults(EMPTY);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const timer = setTimeout(() => {
      const phone = looksLikePhone(q);
      const callQuery = phone
        ? `phone=${encodeURIComponent(q.replace(/\D/g, ''))}`
        : `search=${encodeURIComponent(q)}`;

      // A search is worth running only if its hits lead somewhere this viewer
      // can go. Not running it also stops the 403s a publisher used to collect
      // in the console, which is what the old role test was reaching for.
      void Promise.allSettled([
        apiClient.get(`/api/v1/calls?${callQuery}&limit=5`),
        canReach('/campaigns')
          ? apiClient.get(`/api/v1/campaigns?limit=5&search=${encodeURIComponent(q)}`)
          : Promise.resolve(null),
        canReach('/publishers')
          ? apiClient.get(`/api/v1/publishers?limit=5&search=${encodeURIComponent(q)}`)
          : Promise.resolve(null),
        canReach('/buyers')
          ? apiClient.get(`/api/v1/buyers?limit=5&search=${encodeURIComponent(q)}`)
          : Promise.resolve(null),
      ]).then(settled => {
        if (cancelled) return;
        const [calls, campaigns, publishers, buyers] = settled;
        setResults({
          calls: calls.status === 'fulfilled' ? unwrap<CallHit>(calls.value) : [],
          campaigns: campaigns.status === 'fulfilled' ? unwrap<NamedHit>(campaigns.value) : [],
          publishers: publishers.status === 'fulfilled' ? unwrap<NamedHit>(publishers.value) : [],
          buyers: buyers.status === 'fulfilled' ? unwrap<NamedHit>(buyers.value) : [],
        });
        setLoading(false);
      });
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, open, canReach]);

  /**
   * What the box says it searches.
   *
   * It used to name campaigns, publishers and buyers unconditionally, which for
   * an agency principal is now three things it does not search and a publisher
   * could never search either. The prompt is assembled from what will actually
   * run.
   */
  const searchPlaceholder = React.useMemo(() => {
    const parts = ['calls'];
    if (canReach('/campaigns')) parts.push('campaigns');
    if (canReach('/publishers')) parts.push('publishers');
    if (canReach('/buyers')) parts.push('buyers');
    return `Search ${parts.join(', ')} — or jump to a page`;
  }, [canReach]);

  const go = React.useCallback(
    (href: string) => {
      onOpenChange(false);
      setQuery('');
      router.push(href);
    },
    [router, onOpenChange]
  );

  const hasRemote =
    results.calls.length +
      results.campaigns.length +
      results.publishers.length +
      results.buyers.length >
    0;

  return (
    /*
      Composed from Dialog + DialogContent + Command rather than from the
      CommandDialog convenience wrapper. That wrapper hardcodes its own
      DialogContent with no way to pass a className, so the theme scope could
      only go on a child — and a child with `display: contents` paints no
      background, which left the palette's chrome dark over a light page.
      Same reasoning as SheetDrawer; the ui/ primitives are untouched.

      data-theme rides on DialogContent because it is the portalled element:
      portals mount on document.body, outside any data-theme subtree.
    */
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-theme={theme}
        className="overflow-hidden border-rule bg-surface p-0 shadow-none sm:rounded-card"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <Command className="bg-surface [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:t-label [&_[cmdk-group-heading]]:text-ink-3 [&_[cmdk-input]]:h-11 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-2">
          <CommandInput placeholder={searchPlaceholder} value={query} onValueChange={setQuery} />
          <CommandList>
            {loading && !hasRemote ? (
              <div className="flex items-center gap-2 px-3 py-4 t-meta text-ink-3">
                <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
                Searching
              </div>
            ) : null}

            {!loading && query.trim().length >= 2 && !hasRemote ? (
              <CommandEmpty>
                Nothing matches &ldquo;{query.trim()}&rdquo;. Try a phone number, a call ID, or a
                campaign name.
              </CommandEmpty>
            ) : null}

            {results.calls.length > 0 ? (
              <CommandGroup heading="Calls">
                {results.calls.map(c => (
                  <CommandItem
                    key={c.id}
                    value={`call ${c.id} ${c.fromNumber ?? ''} ${c.toNumber ?? ''}`}
                    onSelect={() => go(`/calls/${c.id}`)}
                  >
                    <Phone aria-hidden className="mr-2 h-3.5 w-3.5 text-ink-3" />
                    <span className="t-data">
                      {c.fromNumber ? formatPhone(c.fromNumber) : c.id}
                    </span>
                    {c.campaignName ? (
                      <span className="ml-2 truncate t-meta text-ink-3">{c.campaignName}</span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {results.campaigns.length > 0 ? (
              <CommandGroup heading="Campaigns">
                {results.campaigns.map(c => (
                  <CommandItem
                    key={c.id}
                    value={`campaign ${c.name ?? c.id}`}
                    onSelect={() => go(`/campaigns/${c.id}`)}
                  >
                    <Megaphone aria-hidden className="mr-2 h-3.5 w-3.5 text-ink-3" />
                    {c.name ?? c.id}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {results.publishers.length > 0 ? (
              <CommandGroup heading="Publishers">
                {results.publishers.map(p => (
                  <CommandItem
                    key={p.id}
                    value={`publisher ${p.name ?? p.id}`}
                    onSelect={() => go(`/publishers?id=${p.id}`)}
                  >
                    <Users aria-hidden className="mr-2 h-3.5 w-3.5 text-ink-3" />
                    {p.name ?? p.id}
                    {p.code ? <span className="ml-2 t-meta text-ink-3">{p.code}</span> : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {results.buyers.length > 0 ? (
              <CommandGroup heading="Buyers">
                {results.buyers.map(b => (
                  <CommandItem
                    key={b.id}
                    value={`buyer ${b.name ?? b.id}`}
                    onSelect={() => go(`/buyers?id=${b.id}`)}
                  >
                    <AudioLines aria-hidden className="mr-2 h-3.5 w-3.5 text-ink-3" />
                    {b.name ?? b.id}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {hasRemote ? <CommandSeparator /> : null}

            <CommandGroup heading="Go to">
              {pages.map(item => {
                const Icon = item.icon;
                return (
                  <CommandItem
                    key={item.href}
                    value={`page ${item.name}`}
                    onSelect={() => go(item.href)}
                  >
                    <Icon aria-hidden className="mr-2 h-3.5 w-3.5 text-ink-3" />
                    {item.name}
                    <CornerDownLeft aria-hidden className="ml-auto h-3 w-3 text-ink-3 opacity-0" />
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

/** cmd-K / ctrl-K, wired once by the topbar. */
export function useCommandPalette() {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(v => !v);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return { open, setOpen };
}

export const commandPaletteHintClass = cn('t-meta text-ink-3');
