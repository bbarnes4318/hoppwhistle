// eslint-disable-next-line import/default
import bcrypt from 'bcryptjs';
// eslint-disable-next-line import/no-named-as-default-member
const { compare, hash } = bcrypt;
import { RoleName } from '@prisma/client';
import { FastifyInstance } from 'fastify';

import { getPrismaClient } from '../lib/prisma.js';
import { getActingUserId, resolveTenant } from '../lib/tenant-context.js';
import { authenticate } from '../middleware/auth.js';
import { createSession, generateCsrfToken } from '../middleware/session.js';
import { auditLog } from '../services/audit.js';
import { verifyGoogleToken } from '../services/google-auth.js';
import {
  ActivationGrantError,
  completeActivationGrant,
  peekActivationGrant,
  redeemActivationGrant,
} from '../services/tenant-activation.js';

// Password validation: min 8 chars, 1 uppercase, 1 number
const PASSWORD_REGEX = /^(?=.*[A-Z])(?=.*\d).{8,}$/;

interface UserRole {
  role: { name: string };
}

/**
 * Auth routes: Login, Register, Google OAuth, CSRF, Logout
 * All routes prefixed with /api for nginx routing
 */
export async function registerAuthRoutes(fastify: FastifyInstance): Promise<void> {
  const prisma = getPrismaClient();
  await Promise.resolve(); // satisfy eslint require-await

  /**
   * The role a redeemed activation grant carries, attached to the new user.
   *
   * The role is named by the grant, which was written server-side when a
   * payment or an invitation was verified. It is never read from the request:
   * an earlier version of this function asked for ADMIN, fell back to OWNER,
   * and fell back again to `findFirst()` -- whatever role row the database
   * happened to return -- so every public signup came out a platform
   * administrator, active immediately, with nobody asked.
   *
   * If the named role is missing from the `roles` table the account is left
   * with no role rather than a guessed one. A signup with no role can be given
   * one deliberately; a signup with a guessed role is the bug above.
   */
  async function assignGrantedRole(userId: string, roleName: RoleName): Promise<void> {
    const role = await prisma.role.findUnique({ where: { name: roleName } });

    if (!role) {
      fastify.log.error(
        { userId, roleName },
        'Role named by activation grant is missing; account left with no role rather than a guessed one'
      );
      return;
    }

    await prisma.userRole.create({
      data: {
        userId,
        roleId: role.id,
      },
    });
  }

  /**
   * The single answer every failed redemption gets.
   *
   * `ActivationGrantError` distinguishes "no such token" from "wrong address"
   * from "already used", and the server log records which. The caller is told
   * none of it: an attacker holding a guess learns nothing about which half of
   * it was right, and cannot use the endpoint to discover whether a given
   * address was invited to a given agency.
   */
  const ACTIVATION_REJECTED = {
    code: 'INVALID_ACTIVATION_TOKEN',
    message:
      'This activation link is not valid for this email address. ' +
      'Ask your agency administrator for a new invitation.',
  } as const;

  // ============================================================================
  // Email/Password Login
  // ============================================================================
  fastify.post('/api/auth/login', async (request, reply) => {
    const { email, password } = request.body as { email: string; password: string };

    if (!email || !password) {
      return reply.code(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Email and password are required',
        },
      });
    }

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: {
        tenant: true,
        roles: {
          include: {
            role: true,
          },
        },
      },
    });

    // Check if user exists and has a password (not Google-only)
    if (!user || !user.passwordHash) {
      await auditLog({
        tenantId: null,
        action: 'auth.login.failed',
        entityType: 'User',
        resource: '/api/auth/login',
        method: 'POST',
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        requestId: request.id,
        success: false,
        error: 'Invalid credentials',
      });

      return reply.code(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid email or password',
        },
      });
    }

    // Verify password
    if (!(await compare(password, user.passwordHash))) {
      await auditLog({
        tenantId: user.tenantId,
        action: 'auth.login.failed',
        entityType: 'User',
        resource: '/api/auth/login',
        method: 'POST',
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        requestId: request.id,
        success: false,
        error: 'Invalid password',
      });

      return reply.code(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid email or password',
        },
      });
    }

    if (user.status !== 'ACTIVE') {
      return reply.code(403).send({
        error: {
          code: user.status === 'PENDING' ? 'ACCOUNT_PENDING_APPROVAL' : 'FORBIDDEN',
          message:
            user.status === 'PENDING'
              ? 'Your account is awaiting approval by an administrator.'
              : 'User account is not active',
        },
      });
    }

    if (user.tenant && user.tenant.status !== 'ACTIVE') {
      return reply.code(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'Tenant is not active',
        },
      });
    }

    // Update last login
    await prisma.user
      .update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      })
      .catch(() => {});

    // Create JWT token
    const token = await reply.jwtSign({
      tenantId: user.tenantId,
      userId: user.id,
      email: user.email,
    });

    // Create session
    const sessionId = await createSession(reply, {
      userId: user.id,
      tenantId: user.tenantId || undefined,
      email: user.email,
    });

    // Generate CSRF token
    const csrfToken = generateCsrfToken(sessionId);

    // Audit successful login
    await auditLog({
      tenantId: user.tenantId,
      userId: user.id,
      action: 'auth.login.success',
      entityType: 'User',
      resource: '/api/auth/login',
      method: 'POST',
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      requestId: request.id,
      success: true,
    });

    return reply.send({
      token,
      csrfToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        roles: user.roles.map((ur: UserRole) => ur.role.name),
      },
    });
  });

  // ============================================================================
  // Activation link pre-flight
  // ============================================================================
  /**
   * What agency is this activation link for?
   *
   * The signup page calls this so it can say "You are joining Ridgeline
   * Insurance" before asking for a password. It consumes nothing -- the grant
   * is still single-use afterwards -- and it answers only with the tenant's
   * display name and the role, never its id, so a stolen link cannot be turned
   * into a tenant identifier to try elsewhere.
   */
  fastify.post('/api/auth/activation/preview', async (request, reply) => {
    const { email, activationToken } = request.body as {
      email?: string;
      activationToken?: string;
    };

    if (!email || !activationToken) {
      return reply.code(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Email and activationToken are required',
        },
      });
    }

    try {
      const preview = await peekActivationGrant(activationToken, email);
      return reply.send({
        agencyName: preview.tenantName,
        role: preview.roleName,
        email: email.toLowerCase(),
      });
    } catch (err) {
      if (err instanceof ActivationGrantError) {
        fastify.log.warn(
          { reason: err.reason, email: email.toLowerCase() },
          'Activation token preview rejected'
        );
        return reply.code(400).send({ error: ACTIVATION_REJECTED });
      }
      throw err;
    }
  });

  // ============================================================================
  // Email Registration
  // ============================================================================
  /**
   * Create an account inside the tenant the activation token names.
   *
   * ── What changed and why ─────────────────────────────────────────────────
   *
   * This endpoint used to work out the tenant by itself, from the `Host`,
   * `Referer` and `Origin` headers and then from row order -- ending, if all
   * else failed, at "the oldest ACTIVE tenant in the database". On one shared
   * host serving two agencies, that last step is the one that fires, so every
   * stranger who found the signup page was created inside a paying customer's
   * tenant. It then set the account PENDING and returned 202 with no token,
   * which meant a customer who had genuinely paid also had no way in.
   *
   * Both halves are fixed by the same change: the tenant now arrives with the
   * activation token, and a token only exists because the server already
   * verified a completed Stripe Checkout session or an invitation from an
   * OWNER/ADMIN of that tenant. Nothing about the request decides the tenant.
   * And because the grant *is* the approval, the account it creates is ACTIVE
   * and signed in -- there is no second, manual approval to wait on.
   */
  fastify.post('/api/auth/register', async (request, reply) => {
    const { email, password, firstName, lastName, position, activationToken } = request.body as {
      email: string;
      password: string;
      firstName?: string;
      lastName?: string;
      position?: string;
      activationToken?: string;
    };

    if (!email || !password) {
      return reply.code(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Email and password are required',
        },
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid email format',
        },
      });
    }

    // Validate password strength
    if (!PASSWORD_REGEX.test(password)) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Password must be at least 8 characters with 1 uppercase letter and 1 number',
        },
      });
    }

    const normalizedEmail = email.toLowerCase();

    // Check if email already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      if (existingUser.authMethod === 'GOOGLE' && !existingUser.passwordHash) {
        return reply.code(409).send({
          error: {
            code: 'EMAIL_EXISTS_GOOGLE',
            message: 'This email is registered with Google. Please sign in with Google.',
          },
        });
      }
      return reply.code(409).send({
        error: {
          code: 'EMAIL_EXISTS',
          message: 'An account with this email already exists',
        },
      });
    }

    // The tenant. Claimed from the activation grant before anything is written,
    // so a rejected token creates nothing at all.
    if (!activationToken) {
      return reply.code(400).send({
        error: {
          code: 'ACTIVATION_TOKEN_REQUIRED',
          message:
            'An activation link is required to create an account. ' +
            'Agencies receive one when their plan is purchased; agents receive ' +
            'one from their agency administrator.',
        },
      });
    }

    let grant;
    try {
      grant = await redeemActivationGrant(activationToken, normalizedEmail);
    } catch (err) {
      if (err instanceof ActivationGrantError) {
        // Server log rather than an AuditLog row: `audit_logs.tenantId` is a
        // foreign key to `tenants`, and a rejected activation has no tenant to
        // attribute itself to. Writing 'unknown' there produces a
        // constraint violation that `auditLog` swallows -- an audit trail that
        // reads as present and records nothing.
        fastify.log.warn(
          {
            reason: err.reason,
            email: normalizedEmail,
            ip: request.ip,
            requestId: request.id,
          },
          'Registration rejected: activation token not valid'
        );
        return reply.code(400).send({ error: ACTIVATION_REJECTED });
      }
      throw err;
    }

    // Hash password (12 salt rounds for security)
    const passwordHash = await hash(password, 12);

    const userPosition = position || 'Licensed Agent';
    const defaultScript = userPosition === 'Retention' ? 'retention' : 'sales';

    const user = await prisma.user.create({
      data: {
        // From the grant, never from the request. See the migration
        // 20260906000000_add_tenant_activation_grants for the nine-step host
        // and row-order guess this replaces.
        tenantId: grant.tenantId,
        email: normalizedEmail,
        passwordHash,
        authMethod: 'EMAIL',
        firstName: firstName?.trim() || null,
        lastName: lastName?.trim() || null,
        // The grant is the approval: it exists because a payment or an
        // administrator's invitation was verified server-side. Leaving this
        // PENDING would leave a paying customer with no way in, which is the
        // state this endpoint was previously stuck in.
        status: 'ACTIVE',
        metadata: {
          position: userPosition,
          defaultScript: defaultScript,
        },
      },
    });

    /*
     * A role is a grant INSIDE a tenant. A PLATFORM_INVITE has no tenant, so
     * there is nothing to grant a role in, and NetEnroll staff deliberately
     * hold no `UserRole` rows at all -- see docs/PLATFORM_ADMIN.md §1. Creating
     * an AGENT row here would put the operator's capability back inside the
     * tenant dimension, which is exactly what the PlatformAdmin table exists to
     * avoid.
     *
     * The account created is therefore inert: no agency, no role, nothing it
     * can read, until `platform:admins --grant` is run for it on the host.
     */
    if (grant.tenantId) {
      await assignGrantedRole(user.id, grant.roleName);
    }
    await completeActivationGrant(grant.grantId, user.id);

    // Audit registration
    await auditLog({
      tenantId: grant.tenantId,
      userId: user.id,
      action: 'auth.register.success',
      entityType: 'User',
      resource: '/api/auth/register',
      method: 'POST',
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      requestId: request.id,
      success: true,
    });

    const token = await reply.jwtSign({
      tenantId: user.tenantId,
      userId: user.id,
      email: user.email,
    });

    const sessionId = await createSession(reply, {
      userId: user.id,
      tenantId: user.tenantId || undefined,
      email: user.email,
    });

    return reply.code(201).send({
      token,
      csrfToken: generateCsrfToken(sessionId),
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        roles: grant.tenantId ? [grant.roleName] : [],
      },
    });
  });

  // ============================================================================
  // Issue an activation link (agency administrators)
  // ============================================================================
  /**
   * Invite somebody into the caller's own agency.
   *
   * The tenant is `requireTenantId(request)` -- the caller's authenticated
   * session and nothing else. There is deliberately no `tenantId` field in the
   * body: an OWNER of one agency must not be able to mint a working activation
   * link into another, and the way to guarantee that is to give them no way to
   * name one.
   *
   * The plaintext token is returned once, here, for the caller to send on. It
   * is not stored and cannot be read back.
   *
   * An agency's OWNER is not created here. NetEnroll creates it during
   * onboarding, from `POST /api/v1/platform/onboarding/agencies/:tenantId/owner`,
   * because who runs an agency account is settled in the conversation that
   * opened it. There is no self-serve purchase that mints a grant, and no
   * public checkout: see `services/tenant-activation.ts`.
   */
  fastify.post(
    '/api/v1/auth/activation-grants',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const tenantId = resolveTenant(request, reply);
      if (!tenantId) return;

      const { email, role } = request.body as { email?: string; role?: string };

      const actingUserId = getActingUserId(request);
      const acting = actingUserId
        ? await prisma.user.findUnique({
            where: { id: actingUserId },
            include: { roles: { include: { role: true } } },
          })
        : null;

      const actingRoles = acting?.roles.map((ur: UserRole) => ur.role.name) ?? [];
      const isOwner = actingRoles.includes('OWNER');

      if (!isOwner && !actingRoles.includes('ADMIN')) {
        return reply.code(403).send({
          error: {
            code: 'FORBIDDEN',
            message: 'Only an agency owner or administrator can issue activation links',
          },
        });
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!email || !emailRegex.test(email)) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'A valid email address is required' },
        });
      }

      /*
       * An agency invites AGENTS, and only agents.
       *
       * ── Why not OWNER any more ───────────────────────────────────────────
       *
       * An agency's principal is created by NetEnroll during onboarding, from
       * the platform onboarding screen, as the one act that establishes who
       * runs the account. An OWNER minting a second OWNER moves that decision
       * inside the agency, and there is then no point at which NetEnroll knows
       * who its counterparty is. A second principal is a conversation, and the
       * platform route mints the grant afterwards.
       *
       * ── What an OWNER can never do, whatever this route says ─────────────
       *
       * There is no `tenantId` field in this body and there never was: the
       * tenant is `resolveTenant(request, reply)`, the caller's own session, so
       * an OWNER of one agency cannot mint a working link into another. And a
       * platform admin is not a role at all -- it is a `PlatformAdmin` row
       * granted by a command on the host -- so no grant issued anywhere can
       * create one. Both properties are asserted rather than argued.
       */
      const requested = (role ?? 'AGENT').toUpperCase();
      if (requested !== 'AGENT') {
        return reply.code(403).send({
          error: {
            code: 'FORBIDDEN',
            message:
              'An agency can invite agents. An additional owner is arranged with NetEnroll, ' +
              'who issues that invitation.',
          },
        });
      }

      const { issueActivationGrant } = await import('../services/tenant-activation.js');
      const grant = await issueActivationGrant({
        tenantId,
        email,
        roleName: requested as RoleName,
        source: 'ADMIN_INVITE',
      });

      await auditLog({
        tenantId,
        userId: actingUserId ?? undefined,
        action: 'auth.activation_grant.issued',
        entityType: 'TenantActivationGrant',
        entityId: grant.grantId,
        resource: '/api/v1/auth/activation-grants',
        method: 'POST',
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        requestId: request.id,
        success: true,
      });

      return reply.code(201).send({
        // Shown once. Send it to the invitee; it cannot be retrieved again.
        activationToken: grant.token,
        email: email.toLowerCase(),
        role: requested,
        expiresAt: grant.expiresAt.toISOString(),
      });
    }
  );

  // ============================================================================
  // Google OAuth Login
  // ============================================================================
  fastify.post('/api/auth/google', async (request, reply) => {
    const { credential, activationToken } = request.body as {
      credential: string;
      activationToken?: string;
    };

    if (!credential) {
      return reply.code(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Google credential token is required',
        },
      });
    }

    // Verify Google token
    const result = await verifyGoogleToken(credential);

    if (!result.success) {
      await auditLog({
        tenantId: null,
        action: 'auth.google.failed',
        entityType: 'User',
        resource: '/api/auth/google',
        method: 'POST',
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        requestId: request.id,
        success: false,
        error: result.error,
      });

      return reply.code(401).send({
        error: {
          code: result.code,
          message: result.error,
        },
      });
    }

    const googleUser = result.user;
    const normalizedEmail = googleUser.email.toLowerCase();

    // Check if user exists by googleId first
    let user = await prisma.user.findUnique({
      where: { googleId: googleUser.googleId },
      include: {
        tenant: true,
        roles: {
          include: {
            role: true,
          },
        },
      },
    });

    if (!user) {
      // Check if user exists by email (Safe Account Linking)
      const existingEmailUser = await prisma.user.findUnique({
        where: { email: normalizedEmail },
        include: {
          tenant: true,
          roles: {
            include: {
              role: true,
            },
          },
        },
      });

      if (existingEmailUser) {
        // Safe Account Linking: Link Google to existing email account
        user = await prisma.user.update({
          where: { id: existingEmailUser.id },
          data: {
            googleId: googleUser.googleId,
            firstName: existingEmailUser.firstName || googleUser.firstName,
            lastName: existingEmailUser.lastName || googleUser.lastName,
            lastLoginAt: new Date(),
          },
          include: {
            tenant: true,
            roles: {
              include: {
                role: true,
              },
            },
          },
        });

        await auditLog({
          tenantId: user.tenantId,
          userId: user.id,
          action: 'auth.google.linked',
          entityType: 'User',
          resource: '/api/auth/google',
          method: 'POST',
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
          requestId: request.id,
          success: true,
        });
      } else {
        // A Google identity nobody has seen before. Same rule as the email
        // path: there is no tenant to put it in unless an activation grant
        // names one, and no amount of inspecting the request will produce a
        // safe answer. Signing in with Google is not by itself an introduction.
        if (!activationToken) {
          // Server log, not an audit row -- see the email path above.
          fastify.log.warn(
            { email: normalizedEmail, ip: request.ip, requestId: request.id },
            'Google sign-up rejected: no activation token'
          );
          return reply.code(400).send({
            error: {
              code: 'ACTIVATION_TOKEN_REQUIRED',
              message:
                'An activation link is required to create an account. ' +
                'Agencies receive one when their plan is purchased; agents ' +
                'receive one from their agency administrator.',
            },
          });
        }

        let grant;
        try {
          grant = await redeemActivationGrant(activationToken, normalizedEmail);
        } catch (err) {
          if (err instanceof ActivationGrantError) {
            fastify.log.warn(
              {
                reason: err.reason,
                email: normalizedEmail,
                ip: request.ip,
                requestId: request.id,
              },
              'Google sign-up rejected: activation token not valid'
            );
            return reply.code(400).send({ error: ACTIVATION_REJECTED });
          }
          throw err;
        }

        // Held in its own const rather than assigned straight to `user`: the
        // create() result carries no `tenant` or `roles` relation, so it does
        // not satisfy the type `user` was declared with, and every later
        // `user.id` then reads as possibly-null.
        const createdUser = await prisma.user.create({
          data: {
            tenantId: grant.tenantId,
            email: normalizedEmail,
            googleId: googleUser.googleId,
            authMethod: 'GOOGLE',
            firstName: googleUser.firstName,
            lastName: googleUser.lastName,
            // The grant is the approval; see the email path above.
            status: 'ACTIVE',
            lastLoginAt: new Date(),
          },
        });

        await assignGrantedRole(createdUser.id, grant.roleName);
        await completeActivationGrant(grant.grantId, createdUser.id);

        // Fetch user again with relation to return correctly
        const userWithRoles = await prisma.user.findUnique({
          where: { id: createdUser.id },
          include: {
            tenant: true,
            roles: {
              include: {
                role: true,
              },
            },
          },
        });
        if (!userWithRoles) {
          return reply.code(500).send({
            error: { code: 'INTERNAL_ERROR', message: 'Account creation did not complete' },
          });
        }
        user = userWithRoles;

        await auditLog({
          tenantId: grant.tenantId,
          userId: createdUser.id,
          action: 'auth.google.register',
          entityType: 'User',
          resource: '/api/auth/google',
          method: 'POST',
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
          requestId: request.id,
          success: true,
        });
      }
    } else {
      // Update last login for existing Google user
      await prisma.user
        .update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        })
        .catch(() => {});
    }

    if (user.status !== 'ACTIVE') {
      return reply.code(403).send({
        error: {
          code: user.status === 'PENDING' ? 'ACCOUNT_PENDING_APPROVAL' : 'FORBIDDEN',
          message:
            user.status === 'PENDING'
              ? 'Your account is awaiting approval by an administrator.'
              : 'User account is not active',
        },
      });
    }

    if (user.tenant && user.tenant.status !== 'ACTIVE') {
      return reply.code(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'Tenant is not active',
        },
      });
    }

    // Create JWT token
    const token = await reply.jwtSign({
      tenantId: user.tenantId,
      userId: user.id,
      email: user.email,
    });

    // Create session
    const sessionId = await createSession(reply, {
      userId: user.id,
      tenantId: user.tenantId || undefined,
      email: user.email,
    });

    // Generate CSRF token
    const csrfToken = generateCsrfToken(sessionId);

    // Audit successful Google login
    await auditLog({
      tenantId: user.tenantId,
      userId: user.id,
      action: 'auth.google.success',
      entityType: 'User',
      resource: '/api/auth/google',
      method: 'POST',
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      requestId: request.id,
      success: true,
    });

    return reply.send({
      token,
      csrfToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        roles: user.roles.map((ur: UserRole) => ur.role.name),
      },
    });
  });

  // ============================================================================
  // CSRF Token
  // ============================================================================
  fastify.get(
    '/api/auth/csrf',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const sessionId = request.cookies.sessionId || (request.headers['x-session-id'] as string);
      if (!sessionId) {
        return reply.code(400).send({
          error: {
            code: 'BAD_REQUEST',
            message: 'Session required',
          },
        });
      }

      const csrfToken = generateCsrfToken(sessionId);
      return reply.send({ csrfToken });
    }
  );

  // ============================================================================
  // Get Current User (Me)
  // ============================================================================
  fastify.get(
    '/api/auth/me',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      /*
       * ── This reads the PRINCIPAL, not just the row ────────────────────────
       *
       * The whole frontend -- the sidebar, the command palette, every RoleGuard
       * -- is built from this response. It used to answer with `user.roles` and
       * `user.tenantId` straight off the database row and ignore `request.user`
       * entirely, which had two consequences:
       *
       *   1. A platform operator inside an agency got their OWN tenantId back
       *      (for NetEnroll staff, null), not the agency they had entered. The
       *      client then held a different tenant from every request it made.
       *   2. A role preview changed nothing the operator could see. The
       *      principal carried exactly the previewed role and this endpoint
       *      kept answering with the row, so the nav, the guards and the
       *      palette all stayed as they were. The preview only became visible
       *      when a write was refused, which is the opposite of the point.
       *
       * So for a platform principal the effective roles and tenant come from
       * `request.user`, which `middleware/auth.ts` has already resolved --
       * including the preview replacement. For everyone else it is the row, as
       * it always was: an agency user's principal is derived from that row
       * anyway, and preferring the row keeps this endpoint unchanged for them.
       */
      const principal = request.user as {
        userId?: string;
        tenantId?: string;
        roles?: string[];
        isPlatformAdmin?: boolean;
        actingTenantId?: string | null;
        actingTenantName?: string | null;
        previewRole?: string | null;
        isReadOnlyPreview?: boolean;
      };
      const userId = principal?.userId as string;

      if (!userId) {
        return reply.code(401).send({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Not authenticated',
          },
        });
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          roles: {
            include: {
              role: true,
            },
          },
        },
      });

      if (!user) {
        return reply.code(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'User not found',
          },
        });
      }

      let publisherAccessToRecordings = false;
      let buyerAccessToRecordings = false;

      if (user.publisherId) {
        const pub = await prisma.publisher.findUnique({
          where: { id: user.publisherId },
          select: { accessToRecordings: true },
        });
        publisherAccessToRecordings = pub?.accessToRecordings ?? false;
      }

      if (user.buyerId) {
        const buyer = await prisma.buyer.findUnique({
          where: { id: user.buyerId },
          select: { metadata: true },
        });
        const buyerMetadata = buyer?.metadata as Record<string, unknown> | null;
        buyerAccessToRecordings = !!buyerMetadata?.accessToRecordings;
      }

      const userMetadata = user.metadata as Record<string, unknown> | null;

      const rowRoles = user.roles.map((ur: UserRole) => ur.role.name);
      const isPlatformPrincipal = principal?.isPlatformAdmin === true;

      return reply.send({
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        roles: isPlatformPrincipal ? (principal.roles ?? rowRoles) : rowRoles,
        tenantId: isPlatformPrincipal ? (principal.tenantId ?? null) : user.tenantId,
        buyerId: user.buyerId,
        publisherId: user.publisherId || (userMetadata?.publisherId as string | null) || null,
        publisherAccessToRecordings,
        buyerAccessToRecordings,
        position: userMetadata?.position || null,
        defaultScript: userMetadata?.defaultScript || null,
        customScripts: userMetadata?.customScripts || null,
        // Platform state, so the client does not have to infer who it is talking
        // to from the shape of a refusal. All false/null for an agency user.
        isPlatformAdmin: isPlatformPrincipal,
        actingTenantId: principal?.actingTenantId ?? null,
        actingTenantName: principal?.actingTenantName ?? null,
        previewRole: principal?.previewRole ?? null,
        isReadOnlyPreview: principal?.isReadOnlyPreview === true,
      });
    }
  );

  // ============================================================================
  // Update User Settings (me)
  // ============================================================================
  fastify.patch(
    '/api/auth/me/settings',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { userId } = request.user as { userId: string };
      const { position, defaultScript, customScripts } = request.body as {
        position?: string;
        defaultScript?: string;
        customScripts?: Record<string, string>;
      };

      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        return reply.code(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'User not found',
          },
        });
      }

      const currentMetadata = (user.metadata as Record<string, any>) || {};
      const newMetadata = {
        ...currentMetadata,
      };

      if (position !== undefined) newMetadata.position = position;
      if (defaultScript !== undefined) newMetadata.defaultScript = defaultScript;
      if (customScripts !== undefined) {
        newMetadata.customScripts = {
          ...((currentMetadata.customScripts as Record<string, string>) || {}),
          ...customScripts,
        };
      }

      const updated = await prisma.user.update({
        where: { id: userId },
        data: { metadata: newMetadata },
      });

      return reply.send({
        success: true,
        metadata: updated.metadata,
      });
    }
  );

  // ============================================================================
  // Logout
  // ============================================================================
  fastify.post(
    '/api/auth/logout',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const sessionId = request.cookies.sessionId;
      if (sessionId) {
        const { deleteSession } = await import('../middleware/session.js');
        await deleteSession(sessionId);
        void reply.clearCookie('sessionId');
      }

      await auditLog({
        tenantId: (request.user as { tenantId?: string })?.tenantId ?? null,
        userId: (request.user as { userId: string }).userId,
        action: 'auth.logout',
        entityType: 'User',
        resource: '/api/auth/logout',
        method: 'POST',
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        requestId: request.id,
        success: true,
      });

      return reply.send({ success: true });
    }
  );
}
