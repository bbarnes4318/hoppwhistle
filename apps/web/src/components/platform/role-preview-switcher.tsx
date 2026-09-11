'use client';

import { Check, ChevronDown, Eye, Shield, User, Users } from 'lucide-react';
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
import type { PlatformContextState, PreviewRole } from '@/hooks/use-platform-context';
import { cn } from '@/lib/utils';

/**
 * The role-preview switcher, for NetEnroll staff inside an agency.
 *
 * ── What it is for ───────────────────────────────────────────────────────────
 *
 * The agency switcher beside it changes WHICH agency. It does not change WHO you
 * are inside it: entering an agency grants ADMIN and OWNER (see
 * ACTING_TENANT_ROLES on the API side), so an operator asking "what does an
 * agent actually see on this screen?" was shown the administrator's screen and
 * had to guess. This is how they stop guessing.
 *
 * Three options, and the first is the normal state:
 *
 *   As NetEnroll staff  previewRole null — full access, writes allowed
 *   As agency owner     the principal's nav and the principal's pages
 *   As agent            one agent's nav, and nothing else
 *
 * ── Every preview is read-only, and says so twice ────────────────────────────
 *
 * The server refuses every non-GET request while a preview is set. This control
 * is therefore never the only thing on screen saying so: `RolePreviewBanner`
 * below renders a full-width strip under the top bar, on every page, for as long
 * as the preview lasts. A preview that could be mistaken for the real thing is
 * worse than no preview, because the operator would draw conclusions about what
 * an agency can do from a session that was never the agency's.
 */

const OPTIONS: Array<{
  role: PreviewRole | null;
  label: string;
  hint: string;
  icon: typeof Shield;
}> = [
  {
    role: null,
    label: 'As NetEnroll staff',
    hint: 'Full access to this agency. Writes allowed.',
    icon: Shield,
  },
  {
    role: 'OWNER',
    label: 'As agency owner',
    hint: "The principal's nav and pages. Read-only.",
    icon: Users,
  },
  {
    role: 'AGENT',
    label: 'As agent',
    hint: "One agent's nav and pages. Read-only.",
    icon: User,
  },
];

function labelFor(role: PreviewRole | null): string {
  return OPTIONS.find(option => option.role === role)?.label ?? 'As NetEnroll staff';
}

export function RolePreviewSwitcher({ state }: { state?: PlatformContextState }) {
  const own = usePlatformContext();
  const ctx = state ?? own;

  const [open, setOpen] = React.useState(false);

  // Staff only, inside an agency only, and nothing at all while we do not yet
  // know which. Previewing a role outside an agency is meaningless — the server
  // refuses it with 409 — so there is nothing to offer here either.
  if (ctx.loading || !ctx.isPlatformAdmin || ctx.actingTenant === null) return null;

  const previewing = ctx.previewRole !== null;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex h-7 shrink-0 items-center gap-1.5 rounded-control border px-2 t-meta font-medium',
            'focus-visible:outline-none',
            previewing
              ? // Rose, not the amber of the agency chip beside it. Two different
                // conditions must not share a colour: amber is "you are inside
                // one agency", this is "and you cannot change anything".
                'border-destructive bg-destructive text-destructive-foreground hover:opacity-90'
              : 'border-rule bg-surface text-ink-2 hover:border-rule-strong hover:text-ink'
          )}
          aria-label={
            previewing
              ? `Previewing as ${labelFor(ctx.previewRole)}, read-only. Change or leave the preview`
              : 'Viewing as NetEnroll staff. Preview this agency as one of its roles'
          }
        >
          <Eye aria-hidden className="h-3.5 w-3.5 shrink-0" />
          <span className="max-w-[160px] truncate">{labelFor(ctx.previewRole)}</span>
          <ChevronDown aria-hidden className="h-3 w-3 shrink-0 opacity-70" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="t-body">
          <span className="block text-ink">View this agency as</span>
          <span className="block t-meta font-normal text-ink-3">
            {ctx.actingTenant.name ?? 'This agency'} — a preview is read-only and takes effect on
            reload.
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {OPTIONS.map(option => {
          const Icon = option.icon;
          const selected = ctx.previewRole === option.role;
          return (
            <DropdownMenuItem
              key={option.label}
              className="t-body"
              onSelect={event => {
                event.preventDefault();
                if (selected) return;
                void ctx.setPreviewRole(option.role);
              }}
            >
              <Icon aria-hidden className="mr-2 h-3.5 w-3.5 shrink-0" />
              <span className="flex-1">
                <span className="block truncate">{option.label}</span>
                <span className="block t-meta text-ink-3">{option.hint}</span>
              </span>
              {selected && <Check aria-hidden className="ml-2 h-3.5 w-3.5 shrink-0" />}
            </DropdownMenuItem>
          );
        })}

        {ctx.error && (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5 t-meta text-dropped-ink">{ctx.error}</div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The strip under the top bar, on every page, for as long as a preview lasts.
 *
 * It names the role, the agency, and the fact that nothing can be changed, and
 * it carries the way out. Full width and in the destructive/rose token rather
 * than the amber of the acting-agency chip: the operator must never mistake a
 * preview for the real thing, and must never have to hunt for the exit.
 */
export function RolePreviewBanner({ state }: { state?: PlatformContextState }) {
  const own = usePlatformContext();
  const ctx = state ?? own;

  if (ctx.loading || !ctx.isPlatformAdmin || ctx.previewRole === null) return null;

  const roleLabel = ctx.previewRole === 'AGENT' ? 'an agent' : 'the agency owner';
  const agency = ctx.actingTenant?.name ?? 'this agency';

  return (
    <div
      role="status"
      className={cn(
        'flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-destructive/40',
        'bg-destructive/15 px-4 py-1.5 t-meta text-destructive'
      )}
    >
      <span className="flex items-center gap-1.5 font-medium">
        <Eye aria-hidden className="h-3.5 w-3.5 shrink-0" />
        Previewing {agency} as {roleLabel}
      </span>
      <span className="text-destructive/90">
        Everything is read-only. Nothing you do here can change this agency.
      </span>
      <button
        type="button"
        onClick={() => void ctx.setPreviewRole(null)}
        className={cn(
          'ml-auto shrink-0 rounded-control border border-destructive/50 px-2 py-0.5',
          'font-medium text-destructive hover:bg-destructive/10 focus-visible:outline-none'
        )}
      >
        Leave preview
      </button>
    </div>
  );
}
