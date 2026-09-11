'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';

import { clearSessionToken } from '@/lib/session-token';

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

/**
 * Per-account recording grants, which are not carried by a role.
 *
 * A publisher or buyer only reads recordings if their own account row says so,
 * so the two flags have to travel alongside the role list rather than be
 * derived from it.
 */
export interface RecordingAccess {
  publisher?: boolean;
  buyer?: boolean;
}

/**
 * The permissions a role list carries, derived client-side.
 *
 * ── Why this is module scope and exported ────────────────────────────────────
 *
 * This list is one half of a rule; `RoleGuard`'s `allowedPermissions` is the
 * other, and `role-guard.tsx` requires BOTH (`hasRole && hasPermission`). A role
 * named in a page's `allowedRoles` that is not granted that page's permission
 * here is refused by the guard while the page's own source reads as if it were
 * welcome. READONLY on `/reports` was exactly that for as long as both existed,
 * and nothing compared the two files.
 *
 * `readonly-reports-access.test.ts` now does, by CALLING this rather than
 * reading it out of the hook with a regex -- which is why it lives here instead
 * of inside `useAuth`.
 */
export function getPermissions(roles: string[], recordingAccess: RecordingAccess = {}): string[] {
  const list: string[] = [];
  if (roles.includes('OWNER')) {
    list.push('admin:*');
  }
  if (roles.includes('ADMIN')) {
    list.push(
      'users:read',
      'users:write',
      'users:delete',
      'roles:read',
      'roles:write',
      'api_keys:read',
      'api_keys:write',
      'api_keys:delete',
      'numbers:read',
      'numbers:write',
      'numbers:delete',
      'campaigns:read',
      'campaigns:write',
      'campaigns:delete',
      'flows:read',
      'flows:write',
      'flows:delete',
      'flows:publish',
      'calls:read',
      'calls:write',
      'calls:delete',
      'recordings:read',
      'recordings:write',
      'recordings:delete',
      'webhooks:read',
      'webhooks:write',
      'webhooks:delete',
      'billing:read',
      'billing:write',
      'reports:read',
      'payroll:read',
      'payroll:write',
      'payroll:admin'
    );
  }
  if (roles.includes('ANALYST')) {
    list.push(
      'calls:read',
      'recordings:read',
      'reports:read',
      'campaigns:read',
      'flows:read',
      'numbers:read'
    );
  }
  if (roles.includes('PUBLISHER')) {
    list.push(
      'flows:read',
      'flows:write',
      'flows:publish',
      'campaigns:read',
      'campaigns:write',
      'calls:read'
    );
    if (recordingAccess.publisher) {
      list.push('recordings:read');
    }
  }
  if (roles.includes('BUYER')) {
    list.push('calls:read', 'calls:write', 'campaigns:read');
    if (recordingAccess.buyer) {
      list.push('recordings:read');
    }
  }
  if (roles.includes('AGENT')) {
    list.push('calls:read');
  }
  /*
   * READONLY gets NEITHER `reports:read` NOR `recordings:read`, and both
   * omissions are deliberate.
   *
   * `apps/api/src/middleware/rbac.ts` does list both for READONLY, and
   * `docs/SECURITY.md` repeats that table -- but no route on the API reads
   * either permission. Grep `reports:read` across `apps/api/src` and the only
   * hits are the table declaring it. What actually guards the three endpoints
   * `/reports` fetches is a role test, in `apps/api/src/routes/index.ts`:
   *
   *   publisher-revenue      ADMIN/OWNER, or PUBLISHER for their own rows
   *   buyer-costs            ADMIN/OWNER, or BUYER for their own rows
   *   campaign-profitability ADMIN/OWNER only
   *
   * Each answers 403 to anyone else, the `/export.csv` pair alongside them too.
   * The proof that `reports:read` was never the gate for money data is ANALYST:
   * it holds `reports:read` in BOTH tables and is still refused by all three.
   * So granting it here would not hand READONLY revenue and cost figures -- it
   * would hand them a page that 403s on every tab.
   *
   * `recordings:read` is withheld for a nearer reason. A user holding READONLY
   * alongside BUYER or PUBLISHER is `isBuyerOnly`/`isPublisherOnly` in
   * `sidebar.tsx`, so granting it by role would show them recordings with their
   * account's `buyerAccessToRecordings` flag switched off -- straight past the
   * per-account toggle. `lib/server/session.ts` computes the same capability
   * server-side as `isAdminOrOwner || buyerAccessToRecordings`, with no role
   * clause at all, and this stays equal to it.
   */
  if (roles.includes('READONLY')) {
    list.push('calls:read', 'campaigns:read', 'flows:read', 'numbers:read');
  }
  return list;
}

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

  const permissions = getPermissions(userRoles, {
    publisher: user?.publisherAccessToRecordings,
    buyer: user?.buyerAccessToRecordings,
  });

  const canViewRecordings =
    hasFullAccess ||
    userRoles.includes('ANALYST') ||
    (userRoles.includes('PUBLISHER') && !!user?.publisherAccessToRecordings) ||
    (userRoles.includes('BUYER') && !!user?.buyerAccessToRecordings) ||
    userRoles.includes('AGENT');

  /*
   * Read at ONE call site: the READONLY-only branch of `sidebar.tsx`, which is
   * the only nav that consults it -- every other role returns from an earlier
   * branch. So this decides exactly one thing, whether a READONLY user is shown
   * the Reports link, and the answer is no, for the reasons recorded against
   * READONLY in `getPermissions` above.
   *
   * It used to end in `(READONLY && permissions.includes('reports:read'))`,
   * which read as though it granted something. It never could: READONLY is not
   * granted `reports:read`, so the clause was false in every session that ever
   * evaluated it. `/reports` and this expression are pinned equal by
   * `app/__tests__/readonly-reports-access.test.ts`.
   */
  const canViewReports = hasFullAccess || userRoles.includes('ANALYST');
  const canViewBilling = hasFullAccess;
  const canViewPayouts = hasFullAccess || userRoles.includes('PUBLISHER');
  const canManageBuyers = hasFullAccess;
  const canManagePublishers = hasFullAccess;
  const canManageCampaigns = hasFullAccess;
  const canManageNumbers = hasFullAccess;
  const canDisputeConversions = hasFullAccess || userRoles.includes('BUYER');

  // Default dashboard paths
  let defaultDashboardPath = '/dashboard';
  if (hasFullAccess) {
    defaultDashboardPath = '/dashboard';
  } else if (userRoles.includes('PUBLISHER')) {
    defaultDashboardPath = '/publisher/dashboard';
  } else if (userRoles.includes('BUYER')) {
    defaultDashboardPath = '/buyer/dashboard';
  } else if (userRoles.includes('AGENT')) {
    defaultDashboardPath = '/call-center';
  } else if (userRoles.includes('READONLY')) {
    defaultDashboardPath = '/dashboard';
  }

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
