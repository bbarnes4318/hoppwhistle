'use client';

import { useCallback } from 'react';

import { useAuth } from './use-auth';

/**
 * The call centre's view of the signed-in user.
 *
 * ── This used to be a third model of who you are ─────────────────────────────
 *
 * It held its own `useState`, ran its own `GET /api/auth/me`, and declared its
 * own `RoleName` union -- which did not contain AGENT. Every `hasRole` and
 * `hasAnyRole` call through this hook was therefore untypeable for the one role
 * that uses the call centre, and `useScriptAccess` worked an agent's job title
 * out by elimination ("not an admin, so an agent") rather than by asking.
 *
 * Meanwhile `use-auth.tsx` held a second model with a second permission table,
 * and `lib/roles.ts` a third opinion about where an agent belongs. Three
 * answers to "who is this and what may they do", none of them authoritative,
 * all of them able to drift from the server and from each other.
 *
 * So this is now a view over `useAuth()`, which reads the one fetch the root
 * provider makes and the capability list the server sends with it. Every call
 * site keeps its signature; what changed is that they all describe the same
 * user now, and there is one request instead of one per component.
 */

/**
 * Every role this schema has, AGENT included.
 *
 * Kept in step with `RoleName` in apps/api/prisma/schema.prisma. AGENT's
 * absence here was not cosmetic: it is the role the call centre exists for.
 */
export type RoleName = 'OWNER' | 'ADMIN' | 'AGENT' | 'ANALYST' | 'PUBLISHER' | 'BUYER' | 'READONLY';

interface UserProfile {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  roles: RoleName[];
  tenantId: string | null;
  position?: string | null;
  defaultScript?: string | null;
  customScripts?: Record<string, string> | null;
}

interface UseUserRolesReturn {
  user: UserProfile | null;
  roles: RoleName[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  // Role check helpers
  isOwner: boolean;
  isAdmin: boolean;
  isAdminOrOwner: boolean;
  isAgent: boolean;
  hasRole: (role: RoleName) => boolean;
  hasAnyRole: (...roles: RoleName[]) => boolean;
}

/**
 * The current user's roles, from the one session the whole tree shares.
 */
export function useUserRoles(): UseUserRolesReturn {
  const { user, userRoles, loading, error, refetch, isOwner, isAdmin, isAdminOrOwner, isAgent } =
    useAuth();

  const roles = userRoles as RoleName[];

  const hasRole = useCallback((role: RoleName) => roles.includes(role), [roles]);

  const hasAnyRole = useCallback(
    (...checkRoles: RoleName[]) => checkRoles.some(r => roles.includes(r)),
    [roles]
  );

  const profile: UserProfile | null = user
    ? {
        id: user.id,
        email: user.email,
        firstName: user.firstName ?? null,
        lastName: user.lastName ?? null,
        roles,
        tenantId: user.tenantId ?? null,
        position: user.position ?? null,
        defaultScript: user.defaultScript ?? null,
        customScripts: user.customScripts ?? null,
      }
    : null;

  return {
    user: profile,
    roles,
    loading,
    error,
    refetch,
    isOwner,
    isAdmin,
    isAdminOrOwner,
    isAgent,
    hasRole,
    hasAnyRole,
  };
}

/**
 * Maps database roles to Call Center script access levels.
 */
export function useScriptAccess() {
  const { user, roles, loading, error, isAdminOrOwner, isAgent, refetch } = useUserRoles();

  // Script access logic:
  // - Sales Script: Everyone has access
  // - Retention Script: Available to all agents
  const canAccessSalesScript = true;
  const canAccessRetentionScript = true;

  /*
   * The job title shown on screen.
   *
   * `position` is what the person chose at registration and wins when set.
   * Failing that this used to read "Admin if isAdminOrOwner, otherwise Agent",
   * which called a publisher, a buyer and an analyst an agent -- the only
   * answer available to a hook whose role union had no AGENT in it. It now
   * names the role it actually found.
   */
  const derivedJobTitle =
    user?.position || (isAdminOrOwner ? 'Admin' : isAgent ? 'Agent' : (roles[0] ?? 'User'));

  return {
    user,
    roles,
    loading,
    error,
    canAccessSalesScript,
    canAccessRetentionScript,
    derivedJobTitle,
    isAdminOrOwner,
    position: user?.position || null,
    defaultScript: user?.defaultScript || null,
    customScripts: user?.customScripts || null,
    refetch,
  };
}
