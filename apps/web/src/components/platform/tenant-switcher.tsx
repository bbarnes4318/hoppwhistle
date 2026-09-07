'use client';

import { Building2, Check, ChevronDown, Globe, Loader2 } from 'lucide-react';
import * as React from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { usePlatformContext } from '@/hooks/use-platform-context';
import type { PlatformContextState } from '@/hooks/use-platform-context';
import { cn } from '@/lib/utils';

/**
 * The acting-agency switcher, for NetEnroll staff.
 *
 * ── What it has to do ────────────────────────────────────────────────────────
 *
 * Phase 1b built the switch as an API with no way to reach it, which is how a
 * platform admin ended up with no agency selected and no means to pick one.
 * This is that means.
 *
 * Three requirements, and the third is the one that is easy to get wrong:
 *
 *   1. Visible to platform staff only. Everyone else renders nothing — not a
 *      disabled control, not an empty menu.
 *   2. "All agencies" when nothing is selected, and a list to enter.
 *   3. Visibly, unmistakably different while an agency IS selected, for the
 *      whole time it is selected. An operator looking at one agency's callers
 *      and money must not be able to mistake it for the platform view. So the
 *      active state is not a subtle highlight: it is a filled amber control
 *      carrying the agency's name, in the top bar, on every page.
 *
 * The switcher accepts a caller-supplied state so a page can share one fetch
 * with the banner below it rather than asking twice.
 */
export function TenantSwitcher({ state }: { state?: PlatformContextState }) {
  const own = usePlatformContext();
  const ctx = state ?? own;

  const [open, setOpen] = React.useState(false);

  const onOpenChange = React.useCallback(
    (next: boolean) => {
      setOpen(next);
      // The agency list is a platform-staff-only endpoint and is not needed
      // until somebody actually opens the menu.
      if (next && ctx.tenants.length === 0 && !ctx.tenantsLoading) void ctx.loadTenants();
    },
    [ctx]
  );

  // Nothing at all for an agency user, and nothing while we do not yet know.
  // Rendering "All agencies" before the answer arrives would flash the platform
  // view at somebody who does not have one.
  if (ctx.loading || !ctx.isPlatformAdmin) return null;

  const inside = ctx.actingTenant !== null;
  const label = inside ? (ctx.actingTenant?.name ?? 'Agency') : 'All agencies';

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex h-7 shrink-0 items-center gap-1.5 rounded-control border px-2 t-meta font-medium',
            'focus-visible:outline-none',
            inside
              ? // Deliberately loud. This is the "you are inside one agency's
                // data" state, and it stays on screen the whole time.
                'border-amber-500 bg-amber-500 text-amber-950 hover:bg-amber-400'
              : 'border-rule bg-surface text-ink-2 hover:border-rule-strong hover:text-ink'
          )}
          aria-label={
            inside
              ? `Acting inside ${label}. Change agency`
              : 'Cross-agency view. Choose an agency'
          }
        >
          {inside ? (
            <Building2 aria-hidden className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <Globe aria-hidden className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="max-w-[160px] truncate">{label}</span>
          <ChevronDown aria-hidden className="h-3 w-3 shrink-0 opacity-70" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="t-body">
          <span className="block text-ink">NetEnroll staff</span>
          <span className="block t-meta font-normal text-ink-3">
            {inside
              ? 'You are acting inside one agency. Everything on screen is theirs.'
              : 'Cross-agency view. Agency pages need an agency.'}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem
          className="t-body"
          onSelect={event => {
            event.preventDefault();
            void ctx.leaveTenant();
          }}
        >
          <Globe aria-hidden className="mr-2 h-3.5 w-3.5" />
          <span className="flex-1">All agencies</span>
          {!inside && <Check aria-hidden className="h-3.5 w-3.5" />}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {ctx.tenantsLoading && (
          <div className="flex items-center gap-2 px-2 py-1.5 t-meta text-ink-3">
            <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
            Loading agencies…
          </div>
        )}

        {!ctx.tenantsLoading && ctx.tenants.length === 0 && (
          <div className="px-2 py-1.5 t-meta text-ink-3">No agencies</div>
        )}

        {ctx.tenants.map(tenant => (
          <DropdownMenuItem
            key={tenant.id}
            className="t-body"
            disabled={tenant.status !== 'ACTIVE'}
            onSelect={event => {
              event.preventDefault();
              void ctx.enterTenant(tenant.id);
            }}
          >
            <Building2 aria-hidden className="mr-2 h-3.5 w-3.5" />
            <span className="flex-1 truncate">{tenant.name}</span>
            {tenant.id === ctx.actingTenant?.id && (
              <Check aria-hidden className="h-3.5 w-3.5" />
            )}
          </DropdownMenuItem>
        ))}

        {ctx.error && (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5 t-meta text-red-600">{ctx.error}</div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
