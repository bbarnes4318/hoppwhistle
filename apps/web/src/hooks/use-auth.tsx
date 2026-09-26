'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';

import type { ServerBrand } from '@/lib/brand-themes';
import { homePathForRoles } from '@/lib/roles';
import { clearSessionToken, persistSessionToken } from '@/lib/session-token';

import { usePlatformContext } from './use-platform-context';

/**
 * The signed-in user, fetched once for the whole tree.
 *
 * ── Why the fetch is not in the hook any more ────────────────────────────────
 *
 * `useAuth` is called from twenty-one components, and it used to hold its own
 * `useState` and run its own `GET /api/auth/me`. One dashboard page load
 * therefore fired ten identical auth requests in the same thirty milliseconds.
 *
 * That is not merely wasteful. Ten concurrent requests, on top of everything
 * else a page load asks for, exhausted the API's connection pool: the tenth
 * answered 500, and so did the platform-context request behind it. The client
 * read that failure as "not a platform admin", rendered the agency delivery
 * panel to a NetEnroll operator who has no agency, and that panel then polled
 * two agency-scoped endpoints which answered 409 for as long as the page was
 * open. A duplicated fetch turned into a refused page.
 *
 * So the request and its state live here, once, and the hook below derives
 * roles and permissions from it -- those are pure functions of the user, so
 * every call site keeps its own cheap copy and nothing else changed.
 */
/**
 * What is known about the session right now.
 *
 * ── Why three outcomes and not a boolean ─────────────────────────────────────
 *
 * `user === null` used to mean all of: still asking, nobody is signed in, and
 * the request failed. The sidebar dispatches on role flags derived from `user`,
 * so all three rendered the same thing -- the catch-all, a single Dashboard
 * entry. That is indistinguishable, to the person looking at it, from an
 * account whose roles were taken away, and it is the state the reported
 * incident ended in.
 *
 * A 429 was enough to produce it. The rate limiter keys on `request.ip`, which
 * is nginx for every request because Fastify runs without `trustProxy`, so the
 * whole platform shares one 100-per-minute budget; when it trips,
 * `/api/auth/me` answers 429, and an agent who was working a moment ago is
 * looking at a one-item nav.
 *
 * So the states are named, and the chrome renders differently for each:
 *
 *   resolving       nothing is known yet. Render no navigation at all -- not
 *                   an administrator's, not a fallback.
 *   authenticated   the server answered. `user.roles` is the truth, including
 *                   when it is empty.
 *   anonymous       no credential. The layout sends them to /login.
 *   failed          the server did not answer. NOT "signed out" and NOT "no
 *                   roles": say so and offer a retry.
 */
export type SessionStatus = 'resolving' | 'authenticated' | 'anonymous' | 'failed';

interface AuthSession {
  user: UserData | null;
  status: SessionStatus;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

const AuthSessionContext = createContext<AuthSession | null>(null);

/** Renew once the session has less than this left. Matches REFRESH_WINDOW_MS on the API. */
const RENEW_WITHIN_MS = 24 * 60 * 60 * 1000;

/** How often an open tab re-checks. The window is a day wide; hourly is ample. */
const RENEW_CHECK_INTERVAL_MS = 60 * 60 * 1000;

interface UserData {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  roles: string[];
  /**
   * The capabilities the server will actually honour, sent by `/api/auth/me`.
   * Advisory: it decides what the screen offers, never what the API allows.
   */
  permissions: string[];
  buyerId?: string;
  publisherId?: string;
  tenantId: string;
  publisherAccessToRecordings?: boolean;
  buyerAccessToRecordings?: boolean;
  position?: string | null;
  defaultScript?: string | null;
  customScripts?: Record<string, string> | null;
  /**
   * Platform state, from `/api/auth/me`.
   *
   * `roles` above are the EFFECTIVE roles: for NetEnroll staff inside an agency
   * that is the agency's administrator roles, and under a role preview it is
   * exactly the previewed role. Which is why `isPlatformAdmin` has to travel
   * beside them — it cannot be read off the role list any more, and the nav
   * choice depends on it.
   */
  isPlatformAdmin?: boolean;
  actingTenantId?: string | null;
  actingTenantName?: string | null;
  previewRole?: string | null;
  isReadOnlyPreview?: boolean;
  /** ISO timestamp from `/api/auth/me`, or null for a token minted before expiry existed. */
  sessionExpiresAt?: string | null;
  /**
   * The agency's brand theme, resolved by the server from the principal: the
   * user's own agency, or the one a platform admin has entered. Null for the
   * default NetEnroll look. See `lib/brand-themes.ts`.
   */
  brand?: ServerBrand | null;
  /**
   * The acting tenant is on the white-label tier, from `/api/auth/me`. A fact
   * about the AGENCY; `isWhiteLabel` below is what the person may do with it.
   */
  whiteLabel?: boolean;
}

interface UseAuthReturn {
  user: UserData | null;
  userRoles: string[];
  roles: string[];
  isBuyer: boolean;
  isBuyerOnly: boolean;
  isPublisher: boolean;
  isPublisherOnly: boolean;
  isAdmin: boolean;
  isOwner: boolean;
  isAdminOrOwner: boolean;
  isAgent: boolean;
  isAgentOnly: boolean;
  isReadonlyOnly: boolean;
  hasFullAccess: boolean;
  /**
   * NetEnroll staff. Checked BEFORE `hasFullAccess` wherever the two could both
   * be true — staff inside an agency carry its ADMIN and OWNER, so an order that
   * tested `hasFullAccess` first would hand them the agency's nav. See
   * `components/layout/sidebar.tsx`.
   */
  isPlatformAdmin: boolean;
  /**
   * A white-label agency's OWNER or ADMIN: the agency is on the white-label
   * tier AND this person holds one of those two roles. An agent of the same
   * agency is not. A previewing platform admin follows the previewed role,
   * because under a preview the roles ARE the previewed one.
   *
   * Navigation and screen state only. The API decides on its own.
   */
  isWhiteLabel: boolean;
  /**
   * This session is a platform operator previewing an agency as one of its own
   * roles, and the server refuses every write. Save, submit and delete controls
   * render disabled and say so, which is how the operator learns it from the UI
   * rather than from a 403.
   *
   * Advisory ONLY. The server's global hook is the guarantee; this is so the
   * screen does not lie about what will happen.
   */
  isReadOnlyPreview: boolean;
  isNewUser: boolean;
  buyerId: string | null;
  publisherId: string | null;
  tenantId: string | null;
  permissions: string[];
  canViewRecordings: boolean;
  canViewReports: boolean;
  canViewBilling: boolean;
  canViewPayouts: boolean;
  canManageBuyers: boolean;
  canManagePublishers: boolean;
  canManageCampaigns: boolean;
  canManageNumbers: boolean;
  canDisputeConversions: boolean;
  defaultDashboardPath: string;
  /** See `SessionStatus`. The chrome renders a different thing for each. */
  status: SessionStatus;
  /**
   * True until the first answer. While this is true NOTHING may render a
   * navigation: not an administrator's, and not a fallback that looks like an
   * account with no roles.
   */
  loading: boolean;
  /**
   * The server answered and this account genuinely holds no role. Distinct
   * from `loading` and from `status === 'failed'`, both of which used to look
   * identical to it on screen.
   */
  hasResolvedNoRole: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/** Mounted once, at the root, above everything that calls `useAuth`. */
export function AuthSessionProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<UserData | null>(null);
  const [status, setStatus] = useState<SessionStatus>('resolving');
  const [error, setError] = useState<string | null>(null);

  const fetchUser = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        setUser(null);
        setStatus('anonymous');
        return;
      }

      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });

      if (!res.ok) {
        if (res.status === 401) {
          // The credential is genuinely dead. Clear both stores: a dead token
          // left in the cookie would keep the server render trying to
          // authenticate with it on every navigation.
          clearSessionToken();
          setUser(null);
          setStatus('anonymous');
          setError(null);
          return;
        }

        /*
         * Anything else -- 429, 500, a proxy error page -- is the server
         * failing to answer, not the person failing to be someone. Leaving the
         * previous `user` in place means a transient failure does not take the
         * navigation away from somebody mid-task; `failed` is what the chrome
         * renders its retry from.
         */
        setError(`Could not load your account (HTTP ${res.status}).`);
        setStatus('failed');
        return;
      }

      const data = await res.json();
      const rawUser = data?.data || data;

      // Normalize roles
      const roles = (rawUser?.roles || []).map((r: string) => r.toUpperCase());

      setUser({
        id: rawUser.id,
        email: rawUser.email,
        firstName: rawUser.firstName,
        lastName: rawUser.lastName,
        roles,
        permissions: Array.isArray(rawUser?.permissions) ? rawUser.permissions : [],
        buyerId: rawUser.buyerId,
        publisherId: rawUser.publisherId,
        tenantId: rawUser.tenantId,
        publisherAccessToRecordings: rawUser.publisherAccessToRecordings,
        buyerAccessToRecordings: rawUser.buyerAccessToRecordings,
        position: rawUser.position,
        defaultScript: rawUser.defaultScript,
        customScripts: rawUser.customScripts,
        isPlatformAdmin: rawUser.isPlatformAdmin === true,
        actingTenantId: rawUser.actingTenantId ?? null,
        actingTenantName: rawUser.actingTenantName ?? null,
        previewRole: rawUser.previewRole ?? null,
        isReadOnlyPreview: rawUser.isReadOnlyPreview === true,
        sessionExpiresAt: rawUser.sessionExpiresAt ?? null,
        brand:
          rawUser.brand && typeof rawUser.brand.theme === 'string'
            ? { theme: rawUser.brand.theme, name: rawUser.brand.name ?? null }
            : null,
        whiteLabel: rawUser.whiteLabel === true,
      });
      setStatus('authenticated');
      setError(null);
    } catch (err) {
      // The network, not the server. Same reasoning as a 5xx: the person is
      // not signed out, we simply do not know anything right now.
      console.error('Auth fetch error:', err);
      setError(err instanceof Error ? err.message : 'Could not reach the server.');
      setStatus('failed');
    }
  }, []);

  useEffect(() => {
    void fetchUser();
  }, [fetchUser]);

  /*
   * Renew the session before it lapses.
   *
   * The API issues seven-day tokens and `/api/auth/me` reports when this one
   * stops being accepted. Inside the last day, exchange it for a fresh one --
   * `POST /api/auth/refresh` re-signs the same three claims from the
   * authenticated principal, so this cannot change who the session belongs to.
   *
   * Checked when the session resolves and once an hour after, which is enough:
   * the window is a day wide, and a tab left open for a week gets its chance.
   * A failure is silent by design -- the token is still valid for up to another
   * day, and the next check or the next page load tries again. What must not
   * happen is a renewal failure reading as a sign-out.
   */
  useEffect(() => {
    if (!user?.sessionExpiresAt) return;

    const renewIfDue = async () => {
      const expiresAt = Date.parse(user.sessionExpiresAt as string);
      if (!Number.isFinite(expiresAt)) return;
      if (expiresAt - Date.now() > RENEW_WITHIN_MS) return;

      try {
        const token = localStorage.getItem('token');
        if (!token) return;

        const res = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          credentials: 'include',
        });
        if (!res.ok) return;

        const body = await res.json();
        if (typeof body?.token !== 'string') return;

        persistSessionToken(body.token);
        await fetchUser();
      } catch {
        // Still valid for up to another day; the next check tries again.
      }
    };

    void renewIfDue();
    const timer = setInterval(() => void renewIfDue(), RENEW_CHECK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [user?.sessionExpiresAt, fetchUser]);

  return (
    <AuthSessionContext.Provider
      value={{ user, status, loading: status === 'resolving', error, refetch: fetchUser }}
    >
      {children}
    </AuthSessionContext.Provider>
  );
}

/**
 * A settled, signed-out session, for a component rendered with no provider
 * above it. The provider is in the root layout, so in the app this cannot
 * happen; a test that renders one component in isolation gets a sane answer
 * rather than a thrown error that unmounts what it was trying to look at.
 */
const NO_SESSION: AuthSession = {
  user: null,
  status: 'anonymous',
  loading: false,
  error: null,
  refetch: async () => {},
};

export function useAuth(): UseAuthReturn {
  const { user, status, loading, error, refetch } = useContext(AuthSessionContext) ?? NO_SESSION;

  /*
   * The platform half of the answer, from the one fetch that already asks for it.
   *
   * `/api/auth/me` reports both flags too, and either source is correct. The
   * platform context is preferred for the read-only flag because it is the state
   * the preview switcher and the banner render from, and a Save button disabled
   * from one source while the banner above it is drawn from another is exactly
   * the kind of skew this codebase has paid for before.
   *
   * Outside the provider it degrades to "not staff, not previewing", which is
   * what an agency user's context looks like anyway.
   */
  const platform = usePlatformContext();

  const userRoles = user?.roles || [];

  // Role checks
  const isAdmin = userRoles.includes('ADMIN');
  const isOwner = userRoles.includes('OWNER');
  const isBuyer = userRoles.includes('BUYER');
  const isPublisher = userRoles.includes('PUBLISHER');
  const isAgent = userRoles.includes('AGENT');
  const isReadonly = userRoles.includes('READONLY');

  const isAdminOrOwner = isAdmin || isOwner;
  const hasFullAccess = isAdminOrOwner;
  const isWhiteLabel = user?.whiteLabel === true && isAdminOrOwner;

  // Either source answers; `/api/auth/me` is preferred for the capability
  // because it arrives with the role list it has to be read alongside.
  const isPlatformAdmin = user?.isPlatformAdmin === true || platform.isPlatformAdmin;
  const isReadOnlyPreview = platform.readOnly || user?.isReadOnlyPreview === true;

  const isBuyerOnly = isBuyer && !hasFullAccess;
  const isPublisherOnly = isPublisher && !hasFullAccess;
  const isAgentOnly = isAgent && !hasFullAccess;
  const isReadonlyOnly = isReadonly && !hasFullAccess;

  const isNewUser = !!user && userRoles.length === 0;
  const hasResolvedNoRole = status === 'authenticated' && userRoles.length === 0;

  const buyerId = user?.buyerId || null;
  const publisherId = user?.publisherId || null;
  const tenantId = user?.tenantId || null;

  /*
   * What the server says this principal may do.
   *
   * ── Why this is no longer derived here ──────────────────────────────────
   *
   * This hook used to carry its own copy of the permission table and rebuild
   * it in the browser from the role list. It drifted, as a second copy of an
   * authorization rule always does: the server gives AGENT nine capabilities
   * and this copy gave it exactly one, `calls:read`. `/reports` is guarded on
   * `reports:read`, which the server grants an agent -- so the page turned
   * agents away from something the API would have served them, and nothing
   * anywhere said the two disagreed.
   *
   * `/api/auth/me` now sends the list, computed by `effectivePermissionsFor`,
   * which is the same function `checkPermission()` gates on. There is one
   * table, on the server, and the browser renders from its answer.
   *
   * `?? []` is for a response that predates the field -- a client left open
   * across a deploy. Empty means "no capabilities", which every check below
   * reads as denied; it never means "assume the old table".
   */
  const permissions = user?.permissions ?? [];

  const can = (permission: string): boolean =>
    permissions.includes('admin:*') || permissions.includes(permission);

  /*
   * Display capabilities, derived from the server's permission list rather than
   * from role names.
   *
   * These were a ladder of role checks -- `hasFullAccess || ANALYST || (BUYER
   * && flag) || AGENT || ...` -- rebuilt in the browser beside the permission
   * table that has now moved to the server. A role ladder is the same drift in
   * a different shape: it has to be edited every time a role's capabilities
   * change, and nothing fails when somebody forgets.
   *
   * The two per-account recording flags stay as role checks because they are
   * not capabilities: `publisherAccessToRecordings` is a toggle on one
   * publisher's row, so it narrows a capability the role already has rather
   * than granting one. The server's `checkRecordingAccess` applies the same
   * narrowing, and this only keeps the screen honest about it.
   */
  const canViewRecordings =
    can('recordings:read') &&
    (!isPublisherOnly || !!user?.publisherAccessToRecordings) &&
    (!isBuyerOnly || !!user?.buyerAccessToRecordings);

  const canViewReports = can('reports:read');
  const canViewBilling = can('billing:read');
  const canViewPayouts = can('billing:read') || isPublisher;
  const canManageBuyers = can('campaigns:write') && hasFullAccess;
  const canManagePublishers = can('campaigns:write') && hasFullAccess;
  const canManageCampaigns = can('campaigns:write');
  const canManageNumbers = can('numbers:write');
  const canDisputeConversions = hasFullAccess || isBuyer;

  /**
   * Where this principal lands after signing in.
   *
   * One definition, shared with the login page and the dashboard layout. There
   * used to be two: `lib/roles.ts#getRedirectPath` sent an agent to /dashboard
   * and this sent them to /call-center, so every agent login was a redirect
   * immediately followed by a second one.
   */
  const defaultDashboardPath = homePathForRoles(userRoles);

  return {
    user,
    userRoles,
    roles: userRoles,
    isBuyer,
    isBuyerOnly,
    isPublisher,
    isPublisherOnly,
    isAdmin,
    isOwner,
    isAdminOrOwner,
    isAgent,
    isAgentOnly,
    isReadonlyOnly,
    hasFullAccess,
    isPlatformAdmin,
    isWhiteLabel,
    isReadOnlyPreview,
    isNewUser,
    buyerId,
    publisherId,
    tenantId,
    permissions,
    canViewRecordings,
    canViewReports,
    canViewBilling,
    canViewPayouts,
    canManageBuyers,
    canManagePublishers,
    canManageCampaigns,
    canManageNumbers,
    canDisputeConversions,
    defaultDashboardPath,
    status,
    loading,
    hasResolvedNoRole,
    error,
    refetch,
  };
}
