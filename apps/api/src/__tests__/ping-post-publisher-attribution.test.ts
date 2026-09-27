import Fastify, { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Ping and post credit the key's own publisher.
 *
 * Both routes resolved the publisher as `apiKey.metadata.publisherId ||
 * tenant.publishers[0]`. Keys minted by the portal store it in the
 * `publisherId` COLUMN and never in metadata, so every key fell through to the
 * tenant's first active publisher: every publisher's traffic, and every payout
 * it earned, was credited to one of them.
 */

interface KeyRow {
  id: string;
  tenantId: string;
  status: string;
  expiresAt: Date | null;
  publisherId: string | null;
  metadata: Record<string, unknown> | null;
  tenant?: unknown;
}

const keys = new Map<string, KeyRow>();

const prisma = {
  apiKey: {
    findFirst: vi.fn(({ where }: { where: { keyHash: string } }) =>
      Promise.resolve(keys.get(where.keyHash) ?? null)
    ),
    update: vi.fn(() => Promise.resolve({})),
  },
};

const processPing = vi.fn((publisherId: string) =>
  Promise.resolve({ ping_id: 'ping-1', bid: 0, publisherId })
);
const processPost = vi.fn((_token: string, publisherId: string) =>
  Promise.resolve({ accepted: true, publisherId })
);

vi.mock('../lib/prisma.js', () => ({ getPrismaClient: () => prisma }));
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../services/auction-service.js', () => ({
  auctionService: { processPing: (id: string) => processPing(id) },
}));
vi.mock('../services/post-service.js', () => ({
  postService: { processPost: (t: string, id: string) => processPost(t, id) },
}));
vi.mock('../services/number-pool-service.js', () => ({ numberPoolService: {} }));

const { createHash } = await import('crypto');
const hashOf = (raw: string) => createHash('sha256').update(raw).digest('hex');

function addKey(raw: string, row: Omit<KeyRow, 'status' | 'expiresAt' | 'tenantId'>) {
  keys.set(hashOf(raw), {
    tenantId: 'tenant-1',
    status: 'ACTIVE',
    expiresAt: null,
    // If the route still read `tenant.publishers[0]`, this is what it would
    // find -- and what every assertion below would wrongly see.
    tenant: { publishers: [{ id: 'pub-first' }] },
    ...row,
  });
}

describe('Ping and post publisher attribution', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    const { registerPingRoutes } = await import('../routes/ping.js');
    const { registerPostRoutes } = await import('../routes/post.js');
    await app.register(registerPingRoutes);
    await app.register(registerPostRoutes);
    await app.ready();

    addKey('key-column', { id: 'k1', publisherId: 'pub-column', metadata: null });
    addKey('key-metadata', {
      id: 'k2',
      publisherId: null,
      metadata: { publisherId: 'pub-metadata' },
    });
    addKey('key-both', {
      id: 'k3',
      publisherId: 'pub-column',
      metadata: { publisherId: 'pub-stale' },
    });
    addKey('key-none', { id: 'k4', publisherId: null, metadata: {} });
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    processPing.mockClear();
    processPost.mockClear();
  });

  const ping = (key: string) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/ping',
      headers: { 'x-api-key': key },
      payload: { caller: { state: 'TN' } },
    });

  const post = (key: string) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/post',
      headers: { 'x-api-key': key },
      payload: { token: 'bid-token' },
    });

  it("credits a ping to the publisher in the key's own column", async () => {
    const res = await ping('key-column');
    expect(res.statusCode).toBe(200);
    expect(processPing).toHaveBeenCalledWith('pub-column');
  });

  it("credits a post to the publisher in the key's own column", async () => {
    const res = await post('key-column');
    expect(res.statusCode).toBe(200);
    expect(processPost).toHaveBeenCalledWith('bid-token', 'pub-column');
  });

  it('still reads an older key that carries the publisher in metadata', async () => {
    await ping('key-metadata');
    expect(processPing).toHaveBeenCalledWith('pub-metadata');
    await post('key-metadata');
    expect(processPost).toHaveBeenCalledWith('bid-token', 'pub-metadata');
  });

  it('prefers the column over metadata', async () => {
    await ping('key-both');
    expect(processPing).toHaveBeenCalledWith('pub-column');
  });

  it('refuses a ping from a key with no publisher, rather than crediting the first one', async () => {
    const res = await ping('key-none');
    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('PUBLISHER_KEY_REQUIRED');
    expect(processPing).not.toHaveBeenCalled();
  });

  it('refuses a post from a key with no publisher', async () => {
    const res = await post('key-none');
    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('PUBLISHER_KEY_REQUIRED');
    expect(processPost).not.toHaveBeenCalled();
  });
});
