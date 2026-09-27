/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- assertions run over parsed JSON responses, which are dynamically typed */
import Fastify, { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';
import { registerStaffOnly } from '../middleware/staff-only.js';
import { clearPublicBrandCache, normaliseHost } from '../routes/public-brand.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * The brand before sign-in: `GET /api/v1/public/brand?host=`.
 *
 * A branded agency on its own domain is answered with its theme and name, and
 * with nothing else -- no id, no tenant name, no slug. Any other host, and a
 * domain whose tenant has no brand, answer `{ data: null }`. No credential is
 * needed, and the answer may be cached.
 */

describe('normaliseHost', () => {
  it('lower-cases, and strips the port and a trailing dot', () => {
    expect(normaliseHost('Portal.LifeLeadsPlus.test:443')).toBe('portal.lifeleadsplus.test');
    expect(normaliseHost('portal.lifeleadsplus.test.')).toBe('portal.lifeleadsplus.test');
  });

  it('answers null for anything that is not a host', () => {
    expect(normaliseHost(undefined)).toBeNull();
    expect(normaliseHost('')).toBeNull();
    expect(normaliseHost('[::1]:3000')).toBeNull();
    expect(normaliseHost("x' OR 1=1")).toBeNull();
  });
});

const gate = databaseGate();
announceSkip('Public brand', gate);

describe('Public brand suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `public brand suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)('GET /api/v1/public/brand', () => {
  let app: FastifyInstance;

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: 'public-brand-suite-secret' });
    registerApiV1Auth(instance);
    registerStaffOnly(instance);
    const { registerPublicBrandRoutes } = await import('../routes/public-brand.js');
    await instance.register(registerPublicBrandRoutes);
    await instance.ready();
    return instance;
  }

  const brandOf = (host: string) =>
    app.inject({ method: 'GET', url: `/api/v1/public/brand?host=${encodeURIComponent(host)}` });

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  let tenantId: string;

  beforeEach(async () => {
    clearPublicBrandCache();
    const prisma = getPrismaClient();
    for (const table of ['audit_logs', 'roles', 'tenants']) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`).catch(() => {});
    }
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    tenantId = (
      await prisma.tenant.create({
        data: {
          name: 'LLP Holdings Internal',
          slug: `llp-${stamp}`,
          status: 'ACTIVE',
          whiteLabel: true,
          domain: 'portal.lifeleadsplus.test',
          brandTheme: 'life-leads-plus',
          brandName: 'Life Leads Plus',
        },
      })
    ).id;
    await prisma.tenant.create({
      data: {
        name: 'Plain Agency',
        slug: `plain-${stamp}`,
        status: 'ACTIVE',
        domain: 'plain.agency.test',
      },
    });
  });

  it('answers the brand of the tenant that owns the host, with no credential', async () => {
    const response = await brandOf('Portal.LifeLeadsPlus.test:3000');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: { theme: 'life-leads-plus', name: 'Life Leads Plus' },
    });
    expect(response.headers['cache-control']).toMatch(/public, max-age=\d+/);
  });

  it('leaks nothing else about the tenant', async () => {
    const response = await brandOf('portal.lifeleadsplus.test');
    expect(Object.keys(response.json().data).sort()).toEqual(['name', 'theme']);
    expect(response.body).not.toContain(tenantId);
    expect(response.body).not.toContain('LLP Holdings Internal');
    expect(response.body).not.toContain('llp-');
  });

  it('answers null for an unknown host, an unbranded tenant and no host at all', async () => {
    for (const host of ['agents.netenroll.com', 'plain.agency.test', 'nobody.example.test']) {
      const response = await brandOf(host);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ data: null });
    }
    const none = await app.inject({ method: 'GET', url: '/api/v1/public/brand' });
    expect(none.json()).toEqual({ data: null });
  });
});
