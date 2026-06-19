'use client';

import { useEffect, useState, useCallback } from 'react';

interface UserData {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  roles: string[];
  buyerId?: string;
  publisherId?: string;
  tenantId: string;
}

interface UseAuthReturn {
  user: UserData | null;
  userRoles: string[];
  /** User has BUYER role (may also have other roles) */
  isBuyer: boolean;
  /** User is ONLY a buyer - no ADMIN/OWNER privileges */
  isBuyerOnly: boolean;
  /** User has PUBLISHER role */
  isPublisher: boolean;
  /** User is ONLY a publisher - no ADMIN/OWNER privileges */
  isPublisherOnly: boolean;
  isAdmin: boolean;
  isOwner: boolean;
  isAgent: boolean;
  /** User has ADMIN or OWNER (full access) */
  hasFullAccess: boolean;
  /** New signup with no roles assigned — gets restricted nav */
  isNewUser: boolean;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useAuth(): UseAuthReturn {
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
        // Token might be expired
        if (res.status === 401) {
          localStorage.removeItem('token');
        }
        setError('Failed to fetch user data');
        setLoading(false);
        return;
      }

      const data = await res.json();

      // Normalize roles (might come as data.roles or data.data.roles)
      const roles = (data?.roles || data?.data?.roles || []).map((r: string) => r.toUpperCase());

      setUser({
        id: data.id || data.data?.id,
        email: data.email || data.data?.email,
        firstName: data.firstName || data.data?.firstName,
        lastName: data.lastName || data.data?.lastName,
        roles,
        buyerId: data.buyerId || data.data?.buyerId,
        publisherId: data.publisherId || data.data?.publisherId,
        tenantId: data.tenantId || data.data?.tenantId,
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

  const userRoles = user?.roles || [];

  // Role checks
  const isAdmin = userRoles.includes('ADMIN');
  const isOwner = userRoles.includes('OWNER');
  const isBuyer = userRoles.includes('BUYER');
  const isPublisher = userRoles.includes('PUBLISHER');
  const isAgent = userRoles.includes('AGENT');

  // CRITICAL: hasFullAccess means ADMIN or OWNER - they see EVERYTHING
  const hasFullAccess = isAdmin || isOwner;

  // isBuyerOnly = has BUYER role but NOT admin/owner (restricted view)
  const isBuyerOnly = isBuyer && !hasFullAccess;

  // isPublisherOnly = has PUBLISHER role but NOT admin/owner (restricted view)
  const isPublisherOnly = isPublisher && !hasFullAccess;

  // New user = authenticated but has zero roles (new signup, not yet assigned any role)
  const isNewUser = !!user && userRoles.length === 0;

  return {
    user,
    userRoles,
    isBuyer,
    isBuyerOnly,
    isPublisher,
    isPublisherOnly,
    isAdmin,
    isOwner,
    isAgent,
    hasFullAccess,
    isNewUser,
    loading,
    error,
    refetch: fetchUser,
  };
}
