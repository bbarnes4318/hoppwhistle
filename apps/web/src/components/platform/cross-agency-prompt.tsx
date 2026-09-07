'use client';

import { Building2, Globe, Loader2 } from 'lucide-react';
import * as React from 'react';

import { usePlatformContext } from '@/hooks/use-platform-context';
import type { PlatformContextState } from '@/hooks/use-platform-context';

/**
 * Where a platform operator lands when they have entered no agency.
 *
 * ── The failure this replaces ────────────────────────────────────────────────
 *
 * An agency-scoped page asked an agency-scoped route, the route answered 401
 * because the operator had no acting tenant, the client read 401 as "signed
 * out", cleared the token and went to /login. The login page loaded the app and
 * it happened again.
 *
 * Two things fix that, and both are needed. The server now answers
 * NO_ACTING_TENANT rather than 401, so the client never treats it as a dead
 * session. And an agency page rendered by an operator with no agency shows
 * this instead of an empty table or a spinner that never resolves: the
 * condition, and the one action that resolves it.
 */
export function CrossAgencyPrompt({
  state,
  what = 'This page',
}: {
  state?: PlatformContextState;
  /** What is waiting on an agency, e.g. "Calls". Used in the sentence. */
  what?: string;
}) {
  const own = usePlatformContext();
  const ctx = state ?? own;

  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (open && ctx.tenants.length === 0 && !ctx.tenantsLoading) void ctx.loadTenants();
  }, [open, ctx]);

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-md rounded-lg border border-rule bg-surface p-6">
        <div className="mb-3 flex items-center gap-2 text-ink-2">
          <Globe aria-hidden className="h-4 w-4" />
          <span className="t-meta font-medium uppercase tracking-wide">Cross-agency view</span>
        </div>

        <h2 className="t-title mb-2 text-ink">Choose an agency</h2>
        <p className="t-body mb-4 text-ink-2">
          {what} shows one agency&rsquo;s data, and you have not entered one. You are still
          signed in &mdash; nothing here needs you to sign in again.
        </p>

        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-control border border-rule bg-paper px-3 py-1.5 t-body text-ink hover:border-rule-strong"
          >
            Pick an agency
          </button>
        )}

        {open && ctx.tenantsLoading && (
          <div className="flex items-center gap-2 t-body text-ink-3">
            <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
            Loading agencies&hellip;
          </div>
        )}

        {open && !ctx.tenantsLoading && (
          <ul className="divide-y divide-rule rounded-control border border-rule">
            {ctx.tenants.length === 0 && (
              <li className="px-3 py-2 t-body text-ink-3">No agencies</li>
            )}
            {ctx.tenants.map(tenant => (
              <li key={tenant.id}>
                <button
                  type="button"
                  disabled={tenant.status !== 'ACTIVE'}
                  onClick={() => void ctx.enterTenant(tenant.id)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left t-body text-ink hover:bg-sunken disabled:opacity-50"
                >
                  <Building2 aria-hidden className="h-3.5 w-3.5 shrink-0 text-ink-3" />
                  <span className="flex-1 truncate">{tenant.name}</span>
                  {tenant.status !== 'ACTIVE' && (
                    <span className="t-meta text-ink-3">{tenant.status.toLowerCase()}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        {ctx.error && <p className="mt-3 t-meta text-red-600">{ctx.error}</p>}
      </div>
    </div>
  );
}
