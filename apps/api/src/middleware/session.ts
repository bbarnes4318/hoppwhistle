import { randomBytes } from 'crypto';

import { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';

import { getRedisClient } from '../services/redis.js';
import { secrets } from '../services/secrets.js';

const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Generate session ID
 */
function generateSessionId(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Set secure session cookie
 */
export function setSessionCookie(
  reply: FastifyReply,
  sessionId: string,
  options: {
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'strict' | 'lax' | 'none';
    maxAge?: number;
  } = {}
): void {
  const isProduction = process.env.NODE_ENV === 'production';
  
  reply.setCookie('sessionId', sessionId, {
    httpOnly: options.httpOnly ?? true,
    secure: options.secure ?? isProduction,
    sameSite: options.sameSite ?? 'strict',
    maxAge: options.maxAge ?? SESSION_DURATION / 1000,
    path: '/',
  });
}

/**
 * Get session from Redis
 */
export async function getSession(sessionId: string): Promise<Record<string, unknown> | null> {
  const redis = getRedisClient();
  try {
    const data = await redis.get(`session:${sessionId}`);
    if (!data) {
      return null;
    }
    return JSON.parse(data);
  } catch (error) {
    console.error('Failed to get session:', error);
    return null;
  }
}

/**
 * Set session in Redis
 */
export async function setSession(
  sessionId: string,
  data: Record<string, unknown>,
  ttl: number = SESSION_DURATION / 1000
): Promise<void> {
  const redis = getRedisClient();
  try {
    await redis.setex(`session:${sessionId}`, ttl, JSON.stringify(data));
  } catch (error) {
    console.error('Failed to set session:', error);
  }
}

/**
 * Delete session
 */
export async function deleteSession(sessionId: string): Promise<void> {
  const redis = getRedisClient();
  try {
    await redis.del(`session:${sessionId}`);
  } catch (error) {
    console.error('Failed to delete session:', error);
  }
}

/**
 * Create new session
 */
export async function createSession(
  reply: FastifyReply,
  data: Record<string, unknown>
): Promise<string> {
  const sessionId = generateSessionId();
  await setSession(sessionId, data);
  setSessionCookie(reply, sessionId);
  return sessionId;
}

/**
 * Register session plugin
 */
export async function registerSession(fastify: FastifyInstance): Promise<void> {
  await fastify.register(import('@fastify/cookie'), {
    secret: secrets.getRequired('JWT_SECRET'),
  });
}

