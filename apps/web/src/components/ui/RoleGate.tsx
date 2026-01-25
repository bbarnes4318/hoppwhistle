'use client';

/**
 * Project Cortex | Role Gate
 *
 * Conditional rendering based on user role.
 */

import { ReactNode } from 'react';

import { useUser, UserRole } from '@/contexts/UserContext';

interface RoleGateProps {
  children: ReactNode;
  allow?: UserRole[]; // Only these roles can see
  deny?: UserRole[]; // These roles cannot see
  fallback?: ReactNode; // What to show if denied
}

/**
 * RoleGate - Show content only to allowed roles
 *
 * @example
 * // Only operators and admins see this
 * <RoleGate allow={['operator', 'admin']}>
 *   <NetMarginDisplay />
 * </RoleGate>
 *
 * @example
 * // Hidden from publishers
 * <RoleGate deny={['publisher']}>
 *   <BuyerDetails />
 * </RoleGate>
 */
export function RoleGate({ children, allow, deny, fallback = null }: RoleGateProps) {
  const { user } = useUser();

  if (!user) return fallback;

  // If deny list is specified and user's role is in it
  if (deny && deny.includes(user.role)) {
    return fallback;
  }

  // If allow list is specified and user's role is NOT in it
  if (allow && !allow.includes(user.role)) {
    return fallback;
  }

  return <>{children}</>;
}

/**
 * PublisherOnly - Show content only to publishers
 */
export function PublisherOnly({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return (
    <RoleGate allow={['publisher']} fallback={fallback}>
      {children}
    </RoleGate>
  );
}

/**
 * OperatorOnly - Show content only to operators and admins
 */
export function OperatorOnly({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return (
    <RoleGate allow={['operator', 'admin']} fallback={fallback}>
      {children}
    </RoleGate>
  );
}

/**
 * HideFromPublisher - Hide content from publishers
 */
export function HideFromPublisher({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return (
    <RoleGate deny={['publisher']} fallback={fallback}>
      {children}
    </RoleGate>
  );
}

export default RoleGate;
