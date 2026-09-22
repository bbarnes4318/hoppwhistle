import { describe, it, expect, beforeEach } from 'vitest';

import { getPrismaClient } from '../lib/prisma.js';
import { ensureCarrierCatalog, splitStatements } from '../services/carrier-catalog.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * The carrier catalog reaches the database.
 *
 * ── What this is guarding ───────────────────────────────────────────────────
 *
 * Twilio and Vonage were added as a data-only Prisma migration and appeared on
 * no database at all -- not production, not CI, not a fresh checkout -- because
 * nothing in this repository runs migration SQL: `prisma migrate deploy` is
 * refused, `db push` never reads a migration, and the deploy script applies
 * only the files it names. The page that is meant to switch carriers on and
 * off had nothing to show.
 *
 * So the property worth testing is not "the SQL is valid" but "a booting API
 * converges the catalog, twice, without disturbing what an operator chose".
 */

const gate = databaseGate();
announceSkip('the carrier catalog', gate);

describe('splitStatements', () => {
  it('splits on statement boundaries', () => {
    expect(splitStatements('SELECT 1; SELECT 2;')).toEqual(['SELECT 1', 'SELECT 2']);
  });

  // The one way a naive split on `;` gets this wrong. The real file's prose
  // mentions file names and shell commands.
  it('ignores a semicolon inside a comment', () => {
    const sql = ['-- a comment; with a semicolon', 'SELECT 1;'].join('\n');
    expect(splitStatements(sql)).toEqual(['SELECT 1']);
  });

  it('drops trailing whitespace and empty fragments', () => {
    expect(splitStatements('SELECT 1;\n\n  \n')).toEqual(['SELECT 1']);
  });
});

describe.skipIf(!gate.available)('the carrier catalog', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let tenantId: string;

  beforeEach(async () => {
    prisma = getPrismaClient();
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "carrier_route_steps", "carrier_routes", "carrier_gateways", "carriers", "tenants" CASCADE;'
    );
    const tenant = await prisma.tenant.create({
      data: { name: 'Catalog Tenant', slug: `catalog-${Date.now()}`, status: 'ACTIVE' },
    });
    tenantId = tenant.id;
  });

  it('gives a new tenant Twilio and Vonage, switched off', async () => {
    await ensureCarrierCatalog();

    const carriers = await prisma.carrier.findMany({
      where: { tenantId, code: { in: ['TWILIO', 'VONAGE'] } },
      orderBy: { code: 'asc' },
    });
    expect(carriers.map(c => c.code)).toEqual(['TWILIO', 'VONAGE']);

    // Both refuse a From number the account does not own, so they have to
    // present a DID they issued rather than carry the previous carrier's.
    expect(carriers.every(c => c.callerIdStrategy === 'POOL')).toBe(true);

    const steps = await prisma.carrierRouteStep.findMany({
      where: { carrierId: { in: carriers.map(c => c.id) } },
    });
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.every(s => s.enabled)).toBe(false);
  });

  // Twilio takes +1XXXXXXXXXX and Vonage takes 1XXXXXXXXXX; each rejects the
  // other's spelling, so a wrong format is a dead call on a healthy carrier.
  it('gives each gateway the dial format its carrier accepts', async () => {
    await ensureCarrierCatalog();

    const gateways = await prisma.carrierGateway.findMany({
      where: { tenantId, name: { in: ['twilio', 'vonage'] } },
    });
    const byName = Object.fromEntries(gateways.map(g => [g.name, g.numberFormat]));
    expect(byName).toEqual({ twilio: 'E164', vonage: 'NANP11' });
  });

  it('is idempotent across boots', async () => {
    await ensureCarrierCatalog();
    await ensureCarrierCatalog();
    await ensureCarrierCatalog();

    const steps = await prisma.carrierRouteStep.findMany({
      select: { routeId: true, carrierId: true },
    });
    const pairs = new Set(steps.map(s => `${s.routeId}:${s.carrierId}`));
    expect(pairs.size).toBe(steps.length);
  });

  // The whole point of being append-only: an operator's waterfall is theirs.
  it('leaves an operator-configured waterfall alone', async () => {
    await ensureCarrierCatalog();

    const route = await prisma.carrierRoute.findFirstOrThrow({
      where: { tenantId, callType: 'INBOUND' },
    });
    const bulkvs = await prisma.carrier.findFirstOrThrow({
      where: { tenantId, code: 'BULKVS' },
    });

    // Promote BulkVS to the top and switch it on, as an operator would during
    // an outage, then boot again.
    await prisma.carrierRouteStep.updateMany({
      where: { routeId: route.id },
      data: { position: { increment: 100 } },
    });
    await prisma.carrierRouteStep.updateMany({
      where: { routeId: route.id, carrierId: bulkvs.id },
      data: { position: 0, enabled: true },
    });

    await ensureCarrierCatalog();

    const promoted = await prisma.carrierRouteStep.findFirstOrThrow({
      where: { routeId: route.id, carrierId: bulkvs.id },
    });
    expect(promoted.position).toBe(0);
    expect(promoted.enabled).toBe(true);
  });
});
