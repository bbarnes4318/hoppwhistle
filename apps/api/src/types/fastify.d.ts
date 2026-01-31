/**
 * Global type augmentations for Fastify and @fastify/jwt
 */
import { AuthenticatedUser } from '../middleware/auth.js';

// JWT payload structure for signing - matches what we pass to jwtSign
// Note: tenantId can be null for users without a tenant assignment
export interface JwtPayload {
  tenantId: string | null;
  userId?: string;
  email?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }

  interface FastifyReply {
    // Override jwtSign to accept our payload type
    jwtSign(payload: JwtPayload): Promise<string>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload;
    user: AuthenticatedUser;
  }
}
