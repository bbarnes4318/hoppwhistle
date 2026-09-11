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
  const {
    user,
    userRoles,
    permissions,
    hasFullAccess,
    isPlatformAdmin,
    isReadOnlyPreview,
    loading,
    defaultDashboardPath,
  } = useAuth();
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

  /*
   * NetEnroll staff pass every guard, except while previewing a role.
   *
   * Several guarded pages have a second reading for platform staff -- /rating,
   * /delivery and /delivery/settlements each render a cross-agency view when no
   * agency is entered. An operator in that view holds NO roles at all (see
   * ACTING_TENANT_ROLES: "administrator of every agency at once" is not a state
   * this system has), so a guard that only looked at roles would turn them away
   * from the platform-wide screens those pages exist to show.
   *
   * The exception is a read-only role preview. There the operator has explicitly
   * asked to be shown what a narrower role sees, and being turned away from a
   * page that role cannot reach is the answer they asked for -- so the bypass is
   * withdrawn for exactly as long as the preview lasts.
   *
   * This is a navigation guard, not a security boundary. The server decides what
   * is served either way: `requirePlatformAdmin` for the platform screens,
   * `requireAgencyPrincipal` for the agency money routes, and the global
   * read-only hook for every write during a preview.
   */
  const isStaffBypass = isPlatformAdmin && !isReadOnlyPreview;

  const isAuthorized = isStaffBypass || hasFullAccess || (hasRole && hasPermission);

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
