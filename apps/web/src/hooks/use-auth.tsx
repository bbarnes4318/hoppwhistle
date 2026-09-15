'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';

import { usePlatformContext } from './use-platform-context';

import { homePathForRoles } from '@/lib/roles';
import { clearSessionToken } from '@/lib/session-token';

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
interface AuthSession {
  user: UserData | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

const AuthSessionContext = createContext<AuthSession | null>(null);

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
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/** Mounted once, at the root, above everything that calls `useAuth`. */
export function AuthSessionProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUser = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        setLoading(false);
        return;
      }

      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });

      if (!res.ok) {
        if (res.status === 401) {
          // Clear both stores: a dead token left in the cookie would keep the
          // server render trying to authenticate with it on every navigation.
          clearSessionToken();
        }
        setError('Failed to fetch user data');
        setLoading(false);
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
      });
      setError(null);
    } catch (err) {
      console.error('Auth fetch error:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchUser();
  }, [fetchUser]);

  return (
    <AuthSessionContext.Provider value={{ user, loading, error, refetch: fetchUser }}>
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
  loading: false,
  error: null,
  refetch: async () => {},
};

export function useAuth(): UseAuthReturn {
  const { user, loading, error, refetch } = useContext(AuthSessionContext) ?? NO_SESSION;

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

  // Either source answers; `/api/auth/me` is preferred for the capability
  // because it arrives with the role list it has to be read alongside.
  const isPlatformAdmin = user?.isPlatformAdmin === true || platform.isPlatformAdmin;
  const isReadOnlyPreview = platform.readOnly || user?.isReadOnlyPreview === true;

  const isBuyerOnly = isBuyer && !hasFullAccess;
  const isPublisherOnly = isPublisher && !hasFullAccess;
  const isAgentOnly = isAgent && !hasFullAccess;
  const isReadonlyOnly = isReadonly && !hasFullAccess;

  const isNewUser = !!user && userRoles.length === 0;

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
    loading,
    error,
    refetch,
  };
}
