'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

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
 * The role preview works the same way and for the same reason. `setPreviewRole`
 * posts the role, the server writes it onto the acting-tenant row, and the page
 * reloads: the principal for the request that asked was built before the row
 * changed, so there is no honest way to re-render in place.
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
 *
 * ── One fetch, one answer, for the whole tree ────────────────────────────────
 *
 * This was a plain hook. Every caller therefore got its own `useState` and its
 * own request: the dashboard layout, the page inside it, the topbar switcher
 * and the prompt each asked `/api/v1/platform/context` separately and each
 * settled at its own moment. Eight requests on one page load, and — for the
 * time between the first settling and the last — components on the same screen
 * genuinely disagreed about whether an agency was required. The layout would
 * decide "this page needs an agency" from a state the page had already moved
 * past.
 *
 * It is a provider now, mounted once at the root. One request, one state, and
 * `loading` means the same thing everywhere. `usePlatformContext()` keeps its
 * signature, so no call site changed.
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

/** The roles a platform operator may preview an agency as. */
export type PreviewRole = 'OWNER' | 'AGENT';

export interface PlatformContextState {
  isPlatformAdmin: boolean;
  actingTenant: ActingTenant | null;
  /**
   * The agency role this operator is previewing, or null for "as NetEnroll
   * staff". Reported by the server rather than chosen here: the principal, the
   * nav and the refusals all come from the same row.
   */
  previewRole: PreviewRole | null;
  /**
   * True while a preview is active: the server refuses every non-GET request.
   * Taken from the server's answer rather than derived from `previewRole`, so
   * the client cannot disagree with it about what a preview costs.
   */
  readOnly: boolean;
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
  /** Start previewing as a role, or pass null to stop. Reloads on success. */
  setPreviewRole: (role: PreviewRole | null) => Promise<void>;
  error: string | null;
}

function usePlatformContextState(): PlatformContextState {
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [actingTenant, setActingTenant] = useState<ActingTenant | null>(null);
  const [previewRole, setPreviewRoleState] = useState<PreviewRole | null>(null);
  const [readOnly, setReadOnly] = useState(false);
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

      /*
       * Retried, because a failed answer here is read as "not staff".
       *
       * When this request failed -- and it did, when ten duplicate auth
       * requests exhausted the API's connection pool -- `isPlatformAdmin`
       * stayed false, so a NetEnroll operator with no agency was handed the
       * one-agency delivery panel, which polled two agency-scoped endpoints
       * that could only answer 409 for as long as the tab was open. One
       * transient 500 became a page of refusals.
       *
       * Three attempts over about two seconds, which covers a pool blip
       * without leaving anybody staring at a blank shell. If all three fail we
       * stop asking and settle as "not staff": that is the right default for
       * the overwhelming majority of users, who are not, and the switcher's
       * absence is a visible symptom rather than a silent one.
       */
      const attempts = [0, 500, 1500];
      for (const wait of attempts) {
        if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
        if (cancelled) return;

        const response = await apiClient.get<
          Envelope<{
            isPlatformAdmin: boolean;
            actingTenant: ActingTenant | null;
            previewRole: PreviewRole | null;
            readOnly: boolean;
          }>
        >('/api/v1/platform/context');

        if (cancelled) return;

        const context = payload(response);
        if (context) {
          setIsPlatformAdmin(context.isPlatformAdmin === true);
          setActingTenant(context.actingTenant ?? null);
          setPreviewRoleState(context.previewRole ?? null);
          setReadOnly(context.readOnly === true);
          break;
        }

        // A 401 is a dead session, not a busy server. Asking twice more would
        // only add two more of them to the console.
        if (response.error?.code === 'UNAUTHORIZED') break;
      }

      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const loadTenants = useCallback(async () => {
    setTenantsLoading(true);
    const response = await apiClient.get<Envelope<PlatformTenant[]>>('/api/v1/platform/tenants');

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

  const setPreviewRole = useCallback(async (role: PreviewRole | null) => {
    setError(null);
    const response = await apiClient.post('/api/v1/platform/acting-tenant/preview', {
      previewRole: role,
    });

    if (response.error) {
      setError(response.error.message);
      return;
    }

    // Same reason enter and leave reload: the preview applies from the next
    // request, and the nav, the guards and every disabled control are built from
    // a principal this page has already been rendered with.
    if (typeof window !== 'undefined') window.location.reload();
  }, []);

  return useMemo(
    () => ({
      isPlatformAdmin,
      actingTenant,
      previewRole,
      readOnly,
      loading,
      needsAgency: isPlatformAdmin && actingTenant === null,
      tenants,
      tenantsLoading,
      loadTenants,
      enterTenant,
      leaveTenant,
      setPreviewRole,
      error,
    }),
    [
      isPlatformAdmin,
      actingTenant,
      previewRole,
      readOnly,
      loading,
      tenants,
      tenantsLoading,
      loadTenants,
      enterTenant,
      leaveTenant,
      setPreviewRole,
      error,
    ]
  );
}

const PlatformContext = createContext<PlatformContextState | null>(null);

/** Mounted once, at the root, above everything that asks. */
export function PlatformContextProvider({ children }: { children: ReactNode }): JSX.Element {
  const state = usePlatformContextState();
  return <PlatformContext.Provider value={state}>{children}</PlatformContext.Provider>;
}

/**
 * Who the signed-in user is to the platform.
 *
 * Falls back to a settled, non-platform state when no provider is above the
 * caller. That is what an agency user's context looks like anyway, so a
 * component rendered outside the provider degrades to "not staff, nothing to
 * switch" rather than throwing and taking the page down — which is the failure
 * mode this file already exists to have stopped happening once.
 */
export function usePlatformContext(): PlatformContextState {
  return useContext(PlatformContext) ?? OUTSIDE_PROVIDER;
}

const OUTSIDE_PROVIDER: PlatformContextState = {
  isPlatformAdmin: false,
  actingTenant: null,
  previewRole: null,
  // `false` is the right default outside the provider: a component that cannot
  // read the context must not disable its Save button on a guess. The server
  // hook is the guarantee either way.
  readOnly: false,
  loading: false,
  needsAgency: false,
  tenants: [],
  tenantsLoading: false,
  loadTenants: async () => {},
  enterTenant: async () => {},
  leaveTenant: async () => {},
  setPreviewRole: async () => {},
  error: null,
};
