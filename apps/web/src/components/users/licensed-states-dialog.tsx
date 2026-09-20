'use client';

import { AlertTriangle, Check, Loader2, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { apiClient } from '@/lib/api';
import {
  JURISDICTIONS,
  REGIONS,
  type Region,
  jurisdictionsInRegion,
  searchJurisdictions,
} from '@/lib/licensable-jurisdictions';
import { cn } from '@/lib/utils';

/**
 * Where an agent's licences are typed in.
 *
 * ── What was here before ─────────────────────────────────────────────────────
 *
 * Nothing. `metadata.licensedStates` gates which CRM leads an agent can open
 * and, from this change on, which calls they can be routed. It defaults to
 * DENY, and the only way to set it was `apps/api/src/cli/agent-licenses.ts` --
 * a shell on the API host. So the one control that decides what an agent may
 * legally work could only be operated by somebody with production shell access,
 * and the administrator who actually knows the licence had no way to enter it.
 *
 * The endpoint was always there: PATCH /api/v1/users/:userId merges metadata,
 * validates every code, and is admin-and-owner only. This is its screen.
 *
 * ── A licence is a legal fact, so the form does not guess ────────────────────
 *
 * No preselection, no "same as the agency", no inferring from the states an
 * agent has already worked. `docs/AGENT_LICENSED_STATES_ROLLOUT.md` sets out
 * why the last one is the worst of them: the states an agent has been GIVEN are
 * the very thing the licence constrains, so reading them back as the licence
 * would ratify every past violation. What opens is what is stored.
 *
 * ── Saving replaces, and says so ─────────────────────────────────────────────
 *
 * The PATCH sets `licensedStates` to exactly the selection, so removing a state
 * here removes the licence. The footer names the additions and removals before
 * the button is pressed, because "save" on a form that silently replaces a
 * legal grant should not be the first time somebody learns what it is doing.
 */

interface LicensedStatesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: { id: string; email: string; licensedStates?: string[] } | null;
  onSaved: () => void;
}

export function LicensedStatesDialog({
  open,
  onOpenChange,
  user,
  onSaved,
}: LicensedStatesDialogProps): JSX.Element {
  const stored = useMemo(() => [...(user?.licensedStates ?? [])].sort(), [user]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Reset to what is stored every time the dialog opens, and whenever it is
   * pointed at a different person. Without the second, closing on one agent and
   * opening on the next showed the first agent's licence over the second's name
   * -- and the save would have written it.
   */
  useEffect(() => {
    if (!open) return;
    setSelected(new Set(stored));
    setQuery('');
    setError(null);
    setSaving(false);
  }, [open, user?.id, stored]);

  const visible = useMemo(() => searchJurisdictions(query), [query]);
  const visibleByRegion = useMemo(() => {
    const map = new Map<Region, typeof JURISDICTIONS>();
    for (const region of REGIONS) {
      const inRegion = visible.filter(j => j.region === region);
      if (inRegion.length > 0) map.set(region, inRegion);
    }
    return map;
  }, [visible]);

  const added = useMemo(
    () => [...selected].filter(code => !stored.includes(code)).sort(),
    [selected, stored]
  );
  const removed = useMemo(() => stored.filter(code => !selected.has(code)), [selected, stored]);
  const dirty = added.length > 0 || removed.length > 0;

  const toggle = (code: string) =>
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  /** Whole region on, unless it is already wholly on, in which case off. */
  const toggleRegion = (region: Region) =>
    setSelected(prev => {
      const codes = jurisdictionsInRegion(region).map(j => j.code);
      const next = new Set(prev);
      const allOn = codes.every(code => next.has(code));
      for (const code of codes) {
        if (allOn) next.delete(code);
        else next.add(code);
      }
      return next;
    });

  const save = async () => {
    if (!user) return;
    setSaving(true);
    setError(null);

    // Sorted so the stored value does not churn on every save, and the server
    // sorts it again anyway -- this just keeps the request readable in a log.
    const licensedStates = [...selected].sort();

    const response = await apiClient.patch(`/api/v1/users/${user.id}`, {
      metadata: { licensedStates },
    });

    setSaving(false);

    if (response.error) {
      // The server names the codes it refused. Showing its message rather than
      // a generic failure is the difference between fixing a typo and guessing.
      setError(response.error.message || 'The licence could not be saved.');
      return;
    }

    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Licensed states</DialogTitle>
          <DialogDescription>
            {user?.email}
            {' — '}
            an agent is served leads and routed calls only in the jurisdictions selected here.
          </DialogDescription>
        </DialogHeader>

        {/* Search and the running count. */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search by name or code…"
              className="pl-8"
              aria-label="Search jurisdictions"
            />
          </div>
          <div className="shrink-0 text-sm tabular-nums text-muted-foreground">
            <span className="font-semibold text-foreground">{selected.size}</span> of{' '}
            {JURISDICTIONS.length}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={selected.size === 0}
            onClick={() => setSelected(new Set())}
          >
            Clear all
          </Button>
        </div>

        <div className="max-h-[22rem] space-y-4 overflow-y-auto pr-1">
          {visible.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nothing matches “{query}”.
            </p>
          ) : (
            [...visibleByRegion.entries()].map(([region, items]) => {
              const all = jurisdictionsInRegion(region).map(j => j.code);
              const allOn = all.every(code => selected.has(code));

              return (
                <div key={region}>
                  <div className="mb-1.5 flex items-center justify-between">
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
                          <span
                            className={cn(
                              'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border',
                              on
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-input'
                            )}
                          >
                            {on ? <Check className="h-3 w-3" /> : null}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{j.name}</span>
                          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                            {j.code}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/*
          Nothing selected is a real and legitimate state -- it is what every
          agent starts as -- but it is also indistinguishable on screen from a
          form that failed to load, so it says which one this is.
        */}
        {selected.size === 0 ? (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-900 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              No jurisdictions selected. This agent will be served no leads and routed no
              state-identified calls.
            </span>
          </div>
        ) : null}

        {error ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
            <X className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        <DialogFooter className="items-center sm:justify-between">
          {/* What pressing save will actually change. */}
          <div className="flex min-h-[1.5rem] flex-wrap items-center gap-1.5 text-xs">
            {added.length > 0 ? (
              <Badge variant="success" className="font-mono">
                +{added.join(' +')}
              </Badge>
            ) : null}
            {removed.length > 0 ? (
              <Badge variant="destructive" className="font-mono">
                −{removed.join(' −')}
              </Badge>
            ) : null}
            {!dirty ? <span className="text-muted-foreground">No changes</span> : null}
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={!dirty || saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save licence
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
