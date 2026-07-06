'use client';

import { useRouter } from 'next/navigation';
import { useEffect, ReactNode } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { Loader2 } from 'lucide-react';

interface RoleGuardProps {
  children: ReactNode;
  allowedRoles?: string[];
  allowedPermissions?: string[];
  fallbackPath?: string;
}

export function RoleGuard({
  children,
  allowedRoles,
  allowedPermissions,
  fallbackPath,
}: RoleGuardProps) {
  const { user, userRoles, permissions, hasFullAccess, loading, defaultDashboardPath } = useAuth();
  const router = useRouter();

  // OWNER/ADMIN always bypasses guards
  const hasRole = allowedRoles
    ? userRoles.some(role => allowedRoles.includes(role))
    : true;

  const hasPermission = allowedPermissions
    ? allowedPermissions.some(perm => {
        if (permissions.includes('admin:*')) return true;
        return permissions.includes(perm);
      })
    : true;

  const isAuthorized = hasFullAccess || (hasRole && hasPermission);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
      return;
    }

    if (!loading && user && !isAuthorized) {
      router.push(fallbackPath || defaultDashboardPath);
    }
  }, [loading, user, isAuthorized, router, fallbackPath, defaultDashboardPath]);

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="mt-2 text-sm text-muted-foreground">Verifying access...</p>
        </div>
      </div>
    );
  }

  if (!user || !isAuthorized) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="mt-2 text-sm text-muted-foreground">Redirecting...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
