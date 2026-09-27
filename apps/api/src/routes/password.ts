/**
 * Changing and resetting a password.
 *
 *   PATCH /api/auth/me/password           signed in: { currentPassword, newPassword }
 *   POST  /api/auth/password-reset        signed out: { email }, always 202
 *   POST  /api/auth/password-reset/confirm             { token, newPassword }
 *
 * Every role has these, buyers and publishers included: a password is the
 * person's, not the agency's.
 *
 * Both a change and a reset bump `User.metadata.tokenVersion`, which every
 * authenticator compares with the `tv` claim on the session token
 * (`lib/token-version.ts`). So a changed password signs the user out
 * everywhere else. The change route hands back a fresh token for the session
 * that made the change, so the person doing it stays signed in.
 */

import { Prisma } from '@prisma/client';
// eslint-disable-next-line import/default
import bcrypt from 'bcryptjs';
import { FastifyInstance } from 'fastify';

import { getPrismaClient } from '../lib/prisma.js';
import { tokenVersionOf } from '../lib/token-version.js';
import { authenticate } from '../middleware/auth.js';
import { auditLog } from '../services/audit.js';
import {
  consumePasswordResetToken,
  issuePasswordResetToken,
  MIN_PASSWORD_LENGTH,
  sendPasswordResetEmail,
} from '../services/password-reset.js';

import { SESSION_TOKEN_TTL } from './auth.js';

// eslint-disable-next-line import/no-named-as-default-member
const { compare, hash } = bcrypt;

/** bcrypt cost for every password this file writes. */
const BCRYPT_COST = 12;

const TOO_SHORT = {
  code: 'VALIDATION_ERROR',
  message: `The new password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
} as const;

const RESET_REJECTED = {
  code: 'INVALID_RESET_TOKEN',
  message: 'This reset link is not valid or has expired. Ask for a new one.',
} as const;

/** The user's metadata with the token version moved on by one. */
function bumpedMetadata(metadata: unknown): Prisma.InputJsonObject {
  const current =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};
  const next: Record<string, unknown> = { ...current, tokenVersion: tokenVersionOf(metadata) + 1 };
  // A temporary-password flag from the retired invite route is moot once the
  // person has chosen their own.
  delete next.tempPassword;
  return next as Prisma.InputJsonObject;
}

export async function registerPasswordRoutes(fastify: FastifyInstance): Promise<void> {
  await Promise.resolve();
  const prisma = getPrismaClient();

  // ==========================================================================
  // Change my password
  // ==========================================================================
  fastify.patch('/api/auth/me/password', { preHandler: [authenticate] }, async (request, reply) => {
    const principal = request.user as { userId?: string } | undefined;
    if (!principal?.userId) {
      return reply.code(401).send({
        error: { code: 'UNAUTHORIZED', message: 'Not authenticated' },
      });
    }

    const { currentPassword, newPassword } = (request.body ?? {}) as {
      currentPassword?: string;
      newPassword?: string;
    };

    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'currentPassword and newPassword are required',
        },
      });
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return reply.code(400).send({ error: TOO_SHORT });
    }

    const user = await prisma.user.findUnique({
      where: { id: principal.userId },
      select: { id: true, email: true, tenantId: true, passwordHash: true, metadata: true },
    });
    if (!user) {
      return reply.code(401).send({
        error: { code: 'UNAUTHORIZED', message: 'Not authenticated' },
      });
    }

    if (!user.passwordHash || !(await compare(currentPassword, user.passwordHash))) {
      await auditLog({
        tenantId: user.tenantId,
        userId: user.id,
        action: 'auth.password.change_failed',
        entityType: 'User',
        entityId: user.id,
        resource: '/api/auth/me/password',
        method: 'PATCH',
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        requestId: request.id,
        success: false,
        error: 'Current password did not match',
      });
      return reply.code(400).send({
        error: {
          code: 'INVALID_CURRENT_PASSWORD',
          message: user.passwordHash
            ? 'The current password is not right.'
            : 'This account signs in with Google and has no password. Use "Forgot password?" to set one.',
        },
      });
    }

    const metadata = bumpedMetadata(user.metadata);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hash(newPassword, BCRYPT_COST), metadata },
    });

    await auditLog({
      tenantId: user.tenantId,
      userId: user.id,
      action: 'auth.password.changed',
      entityType: 'User',
      entityId: user.id,
      resource: '/api/auth/me/password',
      method: 'PATCH',
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      requestId: request.id,
      changes: { sessionsRevoked: true },
      success: true,
    });

    // Every other session is now refused. This one continues on a new token.
    const token = await reply.jwtSign(
      {
        tenantId: user.tenantId,
        userId: user.id,
        email: user.email,
        tv: tokenVersionOf(metadata),
      },
      { expiresIn: SESSION_TOKEN_TTL }
    );

    return reply.send({ ok: true, token });
  });

  // ==========================================================================
  // Forgot my password
  // ==========================================================================
  fastify.post('/api/auth/password-reset', async (request, reply) => {
    const { email } = (request.body ?? {}) as { email?: string };

    /*
     * 202 whatever happens below, including a malformed address. The answer
     * must not say whether an account exists; the only difference between an
     * address we know and one we do not is whether a message is sent.
     */
    const accepted = {
      ok: true,
      message: 'If that address has an account, a link to reset its password is on its way.',
    };

    if (typeof email !== 'string' || !email.trim()) {
      return reply.code(202).send(accepted);
    }

    const normalized = email.trim().toLowerCase();
    try {
      const user = await prisma.user.findUnique({
        where: { email: normalized },
        select: { id: true, email: true, tenantId: true, status: true },
      });

      if (user && user.status === 'ACTIVE') {
        const { token } = await issuePasswordResetToken(user.id);
        await sendPasswordResetEmail({ email: user.email, tenantId: user.tenantId, token });
        await auditLog({
          tenantId: user.tenantId,
          userId: user.id,
          action: 'auth.password.reset_requested',
          entityType: 'User',
          entityId: user.id,
          resource: '/api/auth/password-reset',
          method: 'POST',
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
          requestId: request.id,
          success: true,
        });
      }
    } catch (error) {
      request.log.error({ err: error }, 'password reset request failed');
    }

    return reply.code(202).send(accepted);
  });

  // ==========================================================================
  // Set a new password from a reset link
  // ==========================================================================
  fastify.post('/api/auth/password-reset/confirm', async (request, reply) => {
    const { token, newPassword } = (request.body ?? {}) as {
      token?: string;
      newPassword?: string;
    };

    if (typeof token !== 'string' || !token.trim() || typeof newPassword !== 'string') {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'token and newPassword are required' },
      });
    }
    // Checked before the token is consumed, so a too-short attempt does not
    // burn the link.
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return reply.code(400).send({ error: TOO_SHORT });
    }

    const result = await consumePasswordResetToken(token);
    if ('failure' in result) {
      request.log.warn({ reason: result.failure }, 'password reset confirm rejected');
      return reply.code(400).send({ error: RESET_REJECTED });
    }

    const user = await prisma.user.findUnique({
      where: { id: result.userId },
      select: { id: true, tenantId: true, metadata: true, status: true },
    });
    if (!user || user.status !== 'ACTIVE') {
      return reply.code(400).send({ error: RESET_REJECTED });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hash(newPassword, BCRYPT_COST),
        metadata: bumpedMetadata(user.metadata),
      },
    });

    // Any other outstanding link for this person is now moot.
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    await auditLog({
      tenantId: user.tenantId,
      userId: user.id,
      action: 'auth.password.reset',
      entityType: 'User',
      entityId: user.id,
      resource: '/api/auth/password-reset/confirm',
      method: 'POST',
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      requestId: request.id,
      changes: { sessionsRevoked: true },
      success: true,
    });

    return reply.send({ ok: true });
  });
}
