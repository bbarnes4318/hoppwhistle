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
  publisherAccessToRecordings?: boolean;
  buyerAccessToRecordings?: boolean;
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
        if (res.status === 401) {
          localStorage.removeItem('token');
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
  const isReadonly = userRoles.includes('READONLY');

  const isAdminOrOwner = isAdmin || isOwner;
  const hasFullAccess = isAdminOrOwner;

  const isBuyerOnly = isBuyer && !hasFullAccess;
  const isPublisherOnly = isPublisher && !hasFullAccess;
  const isAgentOnly = isAgent && !hasFullAccess;
  const isReadonlyOnly = isReadonly && !hasFullAccess;

  const isNewUser = !!user && userRoles.length === 0;

  const buyerId = user?.buyerId || null;
  const publisherId = user?.publisherId || null;
  const tenantId = user?.tenantId || null;

  // Deriving permissions client-side
  const getPermissions = (roles: string[]): string[] => {
    const list: string[] = [];
    if (roles.includes('OWNER')) {
      list.push('admin:*');
    }
    if (roles.includes('ADMIN')) {
      list.push(
        'users:read', 'users:write', 'users:delete',
        'roles:read', 'roles:write',
        'api_keys:read', 'api_keys:write', 'api_keys:delete',
        'numbers:read', 'numbers:write', 'numbers:delete',
        'campaigns:read', 'campaigns:write', 'campaigns:delete',
        'flows:read', 'flows:write', 'flows:delete', 'flows:publish',
        'calls:read', 'calls:write', 'calls:delete',
        'recordings:read', 'recordings:write', 'recordings:delete',
        'webhooks:read', 'webhooks:write', 'webhooks:delete',
        'billing:read', 'billing:write',
        'reports:read',
        'payroll:read', 'payroll:write', 'payroll:admin'
      );
    }
    if (roles.includes('ANALYST')) {
      list.push('calls:read', 'recordings:read', 'reports:read', 'campaigns:read', 'flows:read', 'numbers:read');
    }
    if (roles.includes('PUBLISHER')) {
      list.push('flows:read', 'flows:write', 'flows:publish', 'campaigns:read', 'campaigns:write', 'calls:read');
      if (user?.publisherAccessToRecordings) {
        list.push('recordings:read');
      }
    }
    if (roles.includes('BUYER')) {
      list.push('calls:read', 'calls:write', 'campaigns:read');
      if (user?.buyerAccessToRecordings) {
        list.push('recordings:read');
      }
    }
    if (roles.includes('AGENT')) {
      list.push('calls:read');
    }
    if (roles.includes('READONLY')) {
      list.push('calls:read', 'campaigns:read', 'flows:read', 'numbers:read');
    }
    return list;
  };

  const permissions = getPermissions(userRoles);

  const canViewRecordings = hasFullAccess ||
    userRoles.includes('ANALYST') ||
    (userRoles.includes('PUBLISHER') && !!user?.publisherAccessToRecordings) ||
    (userRoles.includes('BUYER') && !!user?.buyerAccessToRecordings) ||
    userRoles.includes('AGENT') ||
    (userRoles.includes('READONLY') && permissions.includes('recordings:read'));

  const canViewReports = hasFullAccess || userRoles.includes('ANALYST') || (userRoles.includes('READONLY') && permissions.includes('reports:read'));
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
    refetch: fetchUser,
  };
}
