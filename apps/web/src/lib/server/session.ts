import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { SESSION_COOKIE } from '@/lib/session-token';

import { apiGet } from './api';

/**
 * The session, resolved on the server from the mirrored token cookie.
 *
 * Roles come back from the API, not from anything the browser asserted, so a
 * page can gate on them before it renders a single row. The client-side
 * RoleGuard stays useful for chrome, but this is the check that decides whether
 * a buyer's data is fetched at all.
 */

export interface SessionUser {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  roles: string[];
  tenantId: string;
  buyerId: string | null;
  publisherId: string | null;
  buyerAccessToRecordings: boolean;
}

export interface Session {
  token: string;
  user: SessionUser;
}

interface MeResponse {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  roles?: string[] | null;
  tenantId: string;
  buyerId?: string | null;
  publisherId?: string | null;
  buyerAccessToRecordings?: boolean | null;
}

export async function getSession(): Promise<Session | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    const me = await apiGet<MeResponse>('/api/auth/me', token);
    if (!me?.id) return null;
    return {
      token,
      user: {
        id: me.id,
        email: me.email,
        firstName: me.firstName ?? null,
        lastName: me.lastName ?? null,
        roles: (me.roles ?? []).map(r => r.toUpperCase()),
        tenantId: me.tenantId,
        buyerId: me.buyerId ?? null,
        publisherId: me.publisherId ?? null,
        buyerAccessToRecordings: !!me.buyerAccessToRecordings,
      },
    };
  } catch {
    // An expired or malformed token is a signed-out user, not a broken page.
    return null;
  }
}

export interface BuyerScope extends Session {
  /**
   * Null for an admin or owner who is not attached to a buyer record. They are
   * allowed on these pages — every panel renders an explicit "no buyer
   * attached" state rather than an empty one that looks like zero spend.
   */
  buyerId: string | null;
  canViewRecordings: boolean;
}

/**
 * Gate for every page under /buyer. Sends a signed-out visitor to the login
 * page and anyone without a buyer-facing role back to their own dashboard,
 * before any buyer data is fetched.
 */
export async function requireBuyerScope(): Promise<BuyerScope> {
  const session = await getSession();
  if (!session) redirect('/login');

  const { roles } = session.user;
  const isAdminOrOwner = roles.includes('ADMIN') || roles.includes('OWNER');
  const isBuyer = roles.includes('BUYER');

  if (!isAdminOrOwner && !isBuyer) {
    redirect(roles.includes('PUBLISHER') ? '/publisher/dashboard' : '/dashboard');
  }

  return {
    ...session,
    buyerId: session.user.buyerId,
    canViewRecordings: isAdminOrOwner || session.user.buyerAccessToRecordings,
  };
}
