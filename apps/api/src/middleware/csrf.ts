import { randomBytes, createHmac } from 'crypto';

import { FastifyRequest, FastifyReply } from 'fastify';

import { auditLog } from '../services/audit.js';
import { secrets } from '../services/secrets.js';

const CSRF_SECRET = secrets.get('CSRF_SECRET') || secrets.getRequired('JWT_SECRET');

/**
 * Generate CSRF token
 */
export function generateCsrfToken(sessionId: string): string {
  const token = randomBytes(32).toString('hex');
  const hmac = createHmac('sha256', CSRF_SECRET);
  hmac.update(`${sessionId}:${token}`);
  const signature = hmac.digest('hex');
  return `${token}:${signature}`;
}

/**
 * Verify CSRF token
 */
export function verifyCsrfToken(token: string, sessionId: string): boolean {
  const [tokenPart, signature] = token.split(':');
  if (!tokenPart || !signature) {
    return false;
  }

  const hmac = createHmac('sha256', CSRF_SECRET);
  hmac.update(`${sessionId}:${tokenPart}`);
  const expectedSignature = hmac.digest('hex');

  return signature === expectedSignature;
}

/**
 * CSRF protection middleware for state-changing operations
 */
export async function csrfProtection(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Only protect state-changing methods
  const protectedMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
  if (!protectedMethods.includes(request.method)) {
    return;
  }

  // Skip for API key authentication (CSRF is for browser sessions)
  if (request.user?.apiKeyId) {
    return;
  }

  // Get session ID from cookie or header
  const sessionId = request.cookies.sessionId || request.headers['x-session-id'];
  if (!sessionId) {
    await auditLog({
      tenantId: request.user?.tenantId || 'unknown',
      userId: request.user?.userId,
      action: 'csrf.missing_session',
      entityType: 'CSRF',
      resource: request.url,
      method: request.method,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      requestId: request.id,
      success: false,
      error: 'Missing session ID',
    });

    reply.code(403).send({
      error: {
        code: 'FORBIDDEN',
        message: 'CSRF protection: Missing session',
      },
    });
    return;
  }

  // Get CSRF token from header
  const csrfToken = request.headers['x-csrf-token'] as string;
  if (!csrfToken) {
    await auditLog({
      tenantId: request.user?.tenantId || 'unknown',
      userId: request.user?.userId,
      action: 'csrf.missing_token',
      entityType: 'CSRF',
      resource: request.url,
      method: request.method,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      requestId: request.id,
      success: false,
      error: 'Missing CSRF token',
    });

    reply.code(403).send({
      error: {
        code: 'FORBIDDEN',
        message: 'CSRF protection: Missing token',
      },
    });
    return;
  }

  // Verify token
  if (!verifyCsrfToken(csrfToken, sessionId)) {
    await auditLog({
      tenantId: request.user?.tenantId || 'unknown',
      userId: request.user?.userId,
      action: 'csrf.invalid_token',
      entityType: 'CSRF',
      resource: request.url,
      method: request.method,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      requestId: request.id,
      success: false,
      error: 'Invalid CSRF token',
    });

    reply.code(403).send({
      error: {
        code: 'FORBIDDEN',
        message: 'CSRF protection: Invalid token',
      },
    });
    return;
  }
}

