import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HopwhistleClient } from '../client.js';

/**
 * Covers what HopwhistleClient actually does to a request on its way out and
 * to a response on its way back: auth header, idempotency header, query
 * building, and the shape thrown on a non-2xx. `fetch` is stubbed, so this
 * needs no network and no running API.
 */
describe('HopwhistleClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  const ok = (body: unknown): Response =>
    ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve(body),
    }) as unknown as Response;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(ok({}));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const lastCall = () => {
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return { url, init, headers: init.headers as Record<string, string> };
  };

  it('sends the API key as X-API-Key when one is configured', async () => {
    const client = new HopwhistleClient({ baseUrl: 'https://api.example.com', apiKey: 'sk-test' });

    await client.health();

    const { url, init, headers } = lastCall();
    expect(url).toBe('https://api.example.com/health');
    expect(init.method).toBe('GET');
    expect(headers['X-API-Key']).toBe('sk-test');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('omits X-API-Key entirely when no key is configured', async () => {
    const client = new HopwhistleClient({ baseUrl: 'https://api.example.com' });

    await client.health();

    expect(lastCall().headers).not.toHaveProperty('X-API-Key');
  });

  it('sends no body on a GET', async () => {
    const client = new HopwhistleClient({ baseUrl: 'https://api.example.com' });

    await client.health();

    expect(lastCall().init.body).toBeUndefined();
  });

  it('builds the query string from the params that were supplied, and only those', async () => {
    const client = new HopwhistleClient({ baseUrl: 'https://api.example.com' });

    await client.listNumbers({ page: 2, status: 'ACTIVE' });

    const { url } = lastCall();
    const query = new URL(url).searchParams;
    expect(query.get('page')).toBe('2');
    expect(query.get('status')).toBe('ACTIVE');
    expect(query.has('limit')).toBe(false);
    expect(query.has('search')).toBe(false);
  });

  it('serialises the body and attaches Idempotency-Key only when one is given', async () => {
    const client = new HopwhistleClient({ baseUrl: 'https://api.example.com' });

    await client.provisionNumber({ areaCode: '415' } as never, 'key-123');
    expect(lastCall().headers['Idempotency-Key']).toBe('key-123');
    expect(lastCall().init.body).toBe(JSON.stringify({ areaCode: '415' }));

    fetchMock.mockClear();
    await client.provisionNumber({ areaCode: '415' } as never);
    expect(lastCall().headers).not.toHaveProperty('Idempotency-Key');
  });

  it("throws the API's own error body on a non-2xx", async () => {
    const apiError = { error: { code: 'NOT_FOUND', message: 'No such number' } };
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: () => Promise.resolve(apiError),
    } as unknown as Response);

    const client = new HopwhistleClient({ baseUrl: 'https://api.example.com' });

    await expect(client.getNumber('num-1')).rejects.toEqual(apiError);
  });

  it('synthesises an HTTP_ERROR when a failed response carries no JSON body', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      json: () => Promise.reject(new Error('not json')),
    } as unknown as Response);

    const client = new HopwhistleClient({ baseUrl: 'https://api.example.com' });

    await expect(client.getNumber('num-1')).rejects.toEqual({
      error: { code: 'HTTP_ERROR', message: 'HTTP 502: Bad Gateway' },
    });
  });
});
