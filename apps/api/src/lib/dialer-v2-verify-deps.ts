/**
 * Dialer V2 — the production wiring for `verifyDialerV2Auth`.
 *
 * `dialer-v2-auth.ts` is deliberately pure: every dependency is injected, so
 * each branch is testable with no server and no database. This module is the
 * one place those dependencies are bound to Fastify and Prisma.
 *
 * It exists as its own file because the shadow routes and the reconciliation
 * routes both need exactly the same bindings. They previously built them
 * separately, which is how a change to one could silently leave the other
 * behind.
 */

import { createHash } from 'node:crypto';

import { FastifyInstance } from 'fastify';

import { type ApiKeyRecord, type UserRoleRecord, type VerifyDeps } from './dialer-v2-auth.js';
import { getPrismaClient } from './prisma.js';

export function buildDialerV2VerifyDeps(fastify: FastifyInstance): VerifyDeps {
  return {
    verifyJwt: token => fastify.jwt.verify(token),
    hashApiKey: raw => createHash('sha256').update(raw).digest('hex'),
    now: () => new Date(),

    lookupApiKey: async (keyHash: string): Promise<ApiKeyRecord | null> => {
      const prisma = getPrismaClient();
      const key = await prisma.apiKey.findUnique({
        where: { keyHash },
        include: { tenant: true },
      });
      if (!key) return null;
      return {
        id: key.id,
        tenantId: key.tenantId,
        status: key.status,
        expiresAt: key.expiresAt,
        scopes: key.scopes,
        tenantStatus: key.tenant.status,
      };
    },

    /**
     * Resolves roles the same way the platform's own middleware does — by
     * joining `user_roles` to `roles` and taking the names — rather than
     * reading a claim the login tokens do not carry.
     */
    lookupUserRoles: async (userId: string): Promise<UserRoleRecord | null> => {
      const prisma = getPrismaClient();
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          status: true,
          tenantId: true,
          roles: { select: { role: { select: { name: true } } } },
        },
      });
      if (!user) return null;
      return {
        status: user.status,
        tenantId: user.tenantId,
        roles: user.roles.map(ur => ur.role.name),
      };
    },
  };
}
