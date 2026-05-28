'use client';

import { useState, useEffect, useCallback } from 'react';

import { apiClient } from '@/lib/api';

export type RoleName = 'OWNER' | 'ADMIN' | 'ANALYST' | 'PUBLISHER' | 'BUYER' | 'READONLY';

interface UserProfile {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  roles: RoleName[];
  tenantId: string | null;
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
  hasRole: (role: RoleName) => boolean;
  hasAnyRole: (...roles: RoleName[]) => boolean;
}

/**
 * Hook to fetch and manage the current user's roles from the database.
 * Provides role-checking helpers for authorization decisions.
 */
export function useUserRoles(): UseUserRolesReturn {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUser = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.get<UserProfile>('/api/auth/me');

      if (response.error) {
        setError(response.error.message);
        setUser(null);
      } else if (response.data) {
        setUser(response.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch user');
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchUser();
  }, [fetchUser]);

  const roles = user?.roles ?? [];

  const hasRole = useCallback((role: RoleName) => roles.includes(role), [roles]);

  const hasAnyRole = useCallback(
    (...checkRoles: RoleName[]) => checkRoles.some(r => roles.includes(r)),
    [roles]
  );

  const isOwner = roles.includes('OWNER');
  const isAdmin = roles.includes('ADMIN');
  const isAdminOrOwner = isOwner || isAdmin;

  return {
    user,
    roles,
    loading,
    error,
    refetch: fetchUser,
    isOwner,
    isAdmin,
    isAdminOrOwner,
    hasRole,
    hasAnyRole,
  };
}

/**
 * Maps database roles to Call Center script access levels.
 * - OWNER/ADMIN: Full access to all scripts (Sales + Retention)
 * - Other roles: Access to Sales script only
 */
export function useScriptAccess() {
  const { roles, loading, error, isAdminOrOwner } = useUserRoles();

  // Script access logic:
  // - Sales Script: Everyone has access
  // - Retention Script: Available to all agents
  const canAccessSalesScript = true;
  const canAccessRetentionScript = true;

  // Derive job title from role for display purposes
  const derivedJobTitle = isAdminOrOwner ? 'Admin' : 'Agent';

  return {
    roles,
    loading,
    error,
    canAccessSalesScript,
    canAccessRetentionScript,
    derivedJobTitle,
    isAdminOrOwner,
  };
}
