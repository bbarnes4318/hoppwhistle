'use client';

import { useEffect, useState, useCallback } from 'react';

interface UserData {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  roles: string[];
  buyerId?: string;
  tenantId: string;
}

interface UseAuthReturn {
  user: UserData | null;
  userRoles: string[];
  isBuyer: boolean;
  isAdmin: boolean;
  isOwner: boolean;
  isAgent: boolean;
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

  return {
    user,
    userRoles,
    isBuyer: userRoles.includes('BUYER'),
    isAdmin: userRoles.includes('ADMIN'),
    isOwner: userRoles.includes('OWNER'),
    isAgent: userRoles.includes('AGENT'),
    loading,
    error,
    refetch: fetchUser,
  };
}
