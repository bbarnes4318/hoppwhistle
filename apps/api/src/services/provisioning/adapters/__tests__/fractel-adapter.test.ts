import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../secrets.js', () => ({
  secrets: { get: vi.fn(() => undefined), getRequired: vi.fn() },
}));

vi.mock('../../../../lib/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { FractelAdapter } from '../fractel-adapter.js';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe('FractelAdapter', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
    process.env.FONESTORM_USERNAME = 'user@example.com';
    process.env.FONESTORM_PASSWORD = 'secret';
  });

  it('searches local numbers off-net too, where FracTEL keeps nearly all of them', async () => {
    fetchMock.mockResolvedValueOnce(json({ auth: { token: 'tok' } })).mockResolvedValueOnce(
      json({
        fonenumbers: [
          { fonenumber: '6152474509', state: 'TN', rate_center: 'PLEASANTVW', tier: 'A' },
        ],
      })
    );

    const numbers = await new FractelAdapter().listNumbers({ areaCode: '615', limit: 5 });

    const url = new URL(String(fetchMock.mock.calls[1][0]));
    expect(url.pathname).toBe('/v2/fonenumbers/inventory/local');
    expect(url.searchParams.get('area_code')).toBe('615');
    expect(url.searchParams.get('include_offnet')).toBe('true');
    expect(url.searchParams.get('max')).toBe('5');
    const init = fetchMock.mock.calls[1][1] as RequestInit | undefined;
    expect((init?.headers as Record<string, string>).token).toBe('tok');

    expect(numbers).toHaveLength(1);
    expect(numbers[0]).toMatchObject({
      number: '+16152474509',
      providerId: '6152474509',
      provider: 'fractel',
      metadata: { state: 'TN', rateCenter: 'PLEASANTVW' },
    });
  });
});
