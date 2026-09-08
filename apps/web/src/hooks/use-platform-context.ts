'use client';

import { useCallback, useEffect, useState } from 'react';

import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';

/**
 * Who the signed-in user is to the platform, and which agency they are inside.
 *
 * ── Why this hook exists ────────────────────────────────────────────────────
 *
 * Phase 1b built the acting-tenant switch as an API and shipped no way to reach
 * it. A platform admin therefore had no agency selected, every agency-scoped
 * route refused them, the client read that as a dead session and bounced to
 * /login, and the loop only ended when the selection row was deleted from the
 * production database by hand.
 *
 * This is the state the switcher renders from. It is fetched once per page
 * load, from `/api/v1/platform/context`, which is authenticated but not
 * capability-gated: an agency user gets `{ isPlatformAdmin: false }` and the
 * switcher renders nothing at all.
 *
 * Entering and leaving go through the existing endpoints. Neither takes effect
 * on the request that makes it — the server writes a row that later requests
 * read — so both reload the page rather than pretending the current one has
 * moved.
 *
 * ── Every read here goes through `payload()` ─────────────────────────────────
 *
 * `apiClient`'s `data` is the response BODY, not the payload inside it, and
 * every platform route answers `{ data: ... }`. This hook read `/tenants` as
 * though the body were the array, so `tenants` became an object, the switcher
 * called `.map` on it, and the exception unmounted the dashboard layout — a
 * platform admin saw "Application error" and could not reach any agency.
 *
 * `payload()` names the unwrap and types it, so the mistake is visible rather
 * than a silent cast. See `ApiResponse` in `@/lib/api`.
 */

export interface ActingTenant {
  id: string;
  name: string | null;
}

export interface PlatformTenant {
  id: string;
  name: string;
  slug: string;
  status: string;
}

export interface PlatformContextState {
  isPlatformAdmin: boolean;
  actingTenant: ActingTenant | null;
  /** True until the first fetch settles. Render nothing rather than "All agencies". */
  loading: boolean;
  /**
   * True for a platform admin who has entered no agency. The condition the
   * cross-agency view exists for, and the one that must never be mistaken for
   * "signed out".
   */
  needsAgency: boolean;
  tenants: PlatformTenant[];
  tenantsLoading: boolean;
  loadTenants: () => Promise<void>;
  enterTenant: (tenantId: string) => Promise<void>;
  leaveTenant: () => Promise<void>;
  error: string | null;
}

export function usePlatformContext(): PlatformContextState {
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [actingTenant, setActingTenant] = useState<ActingTenant | null>(null);
  const [loading, setLoading] = useState(true);
  const [tenants, setTenants] = useState<PlatformTenant[]>([]);
  const [tenantsLoading, setTenantsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      // No token means nobody is signed in; asking would only produce a 401 the
      // client would act on.
      if (typeof window !== 'undefined' && !localStorage.getItem('token')) {
        if (!cancelled) setLoading(false);
        return;
      }

      const response = await apiClient.get<
        Envelope<{ isPlatformAdmin: boolean; actingTenant: ActingTenant | null }>
      >('/api/v1/platform/context');

      if (cancelled) return;

      const context = payload(response);
      if (context) {
        setIsPlatformAdmin(context.isPlatformAdmin === true);
        setActingTenant(context.actingTenant ?? null);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const loadTenants = useCallback(async () => {
    setTenantsLoading(true);
    const response =
      await apiClient.get<Envelope<PlatformTenant[]>>('/api/v1/platform/tenants');

    /*
     * `Array.isArray` and not just `?? []`. The crash this replaces was a
     * non-null, non-array value reaching state and the switcher calling `.map`
     * on it — so the guard has to be about the SHAPE, not about presence. An
     * unexpected body leaves the list empty and the menu says so; it does not
     * take the page down.
     */
    const tenants = payload(response);
    setTenants(Array.isArray(tenants) ? tenants : []);
    setTenantsLoading(false);
  }, []);

  const enterTenant = useCallback(async (tenantId: string) => {
    setError(null);
    const response = await apiClient.post('/api/v1/platform/acting-tenant', { tenantId });

    if (response.error) {
      setError(response.error.message);
      return;
    }

    // The selection applies from the NEXT request, so a client-side navigation
    // would render the new agency's chrome around the old agency's data. A full
    // reload is the honest way to change whose data is on the screen.
    if (typeof window !== 'undefined') window.location.reload();
  }, []);

  const leaveTenant = useCallback(async () => {
    setError(null);
    const response = await apiClient.delete('/api/v1/platform/acting-tenant');

    if (response.error) {
      setError(response.error.message);
      return;
    }

    if (typeof window !== 'undefined') window.location.reload();
  }, []);

  return {
    isPlatformAdmin,
    actingTenant,
    loading,
    needsAgency: isPlatformAdmin && actingTenant === null,
    tenants,
    tenantsLoading,
    loadTenants,
    enterTenant,
    leaveTenant,
    error,
  };
}
