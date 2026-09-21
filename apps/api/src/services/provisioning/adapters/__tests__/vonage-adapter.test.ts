import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../secrets.js', () => ({
  secrets: { get: vi.fn(() => undefined), getRequired: vi.fn(() => '') },
}));

vi.mock('../../../../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { VonageAdapter } from '../vonage-adapter.js';

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

describe('VonageAdapter', () => {
  const fetchMock = vi.fn();
  const ENV_KEYS = [
    'VONAGE_API_KEY',
    'VONAGE_API_SECRET',
    'VONAGE_APPLICATION_ID',
    'VONAGE_SIP_URI',
    'VONAGE_DEFAULT_COUNTRY',
  ];
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = fetchMock as unknown as typeof fetch;
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    process.env.VONAGE_API_KEY = 'vk123';
    process.env.VONAGE_API_SECRET = 'vs456';
    process.env.VONAGE_APPLICATION_ID = 'app-789';
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  describe('configuration', () => {
    it('is configured from the API key pair', () => {
      expect(new VonageAdapter().isConfigured()).toBe(true);
    });

    it('is not configured without a secret', () => {
      delete process.env.VONAGE_API_SECRET;
      expect(new VonageAdapter().isConfigured()).toBe(false);
    });
  });

  describe('listNumbers', () => {
    // Vonage returns bare MSISDNs; everything downstream here is E.164.
    it('maps MSISDNs to E.164 and features to capabilities', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          count: 1,
          numbers: [
            {
              country: 'US',
              msisdn: '15551234567',
              type: 'mobile-lvn',
              features: ['VOICE', 'SMS'],
              voiceCallbackType: 'app',
              voiceCallbackValue: 'app-789',
            },
          ],
        })
      );

      const numbers = await new VonageAdapter().listNumbers();

      expect(numbers).toHaveLength(1);
      expect(numbers[0]).toMatchObject({
        id: '15551234567',
        number: '+15551234567',
        provider: 'vonage',
        status: 'assigned',
        providerId: '15551234567',
        features: { voice: true, sms: true, mms: false },
      });
      expect(numbers[0].metadata).toMatchObject({ country: 'US' });

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/account/numbers');
      expect(url).toContain('api_key=vk123');
      expect(init.method).toBe('GET');
    });

    it('turns an area code into a starts-with pattern', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ count: 0, numbers: [] }));

      await new VonageAdapter().listNumbers({ areaCode: '415' });

      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toContain('pattern=1415');
      expect(url).toContain('search_pattern=0');
    });
  });

  describe('purchaseNumber', () => {
    it('searches, buys, then links the number to the voice application', async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse({
            count: 1,
            numbers: [
              { country: 'US', msisdn: '15559998888', type: 'mobile-lvn', features: ['VOICE'] },
            ],
          })
        )
        .mockResolvedValueOnce(jsonResponse({ 'error-code': '200', 'error-code-label': 'success' }))
        .mockResolvedValueOnce(
          jsonResponse({ 'error-code': '200', 'error-code-label': 'success' })
        );

      const result = await new VonageAdapter().purchaseNumber({ areaCode: '555', country: 'US' });

      expect(result).toMatchObject({
        number: '+15559998888',
        provider: 'vonage',
        providerId: '15559998888',
        status: 'assigned',
      });

      const [searchUrl] = fetchMock.mock.calls[0] as [string];
      expect(searchUrl).toContain('/number/search');

      const [buyUrl, buyInit] = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(buyUrl).toContain('/number/buy');
      expect(buyInit.method).toBe('POST');
      const buyBody = new URLSearchParams(buyInit.body as string);
      // No `+`: Vonage matches nothing when one is sent.
      expect(buyBody.get('msisdn')).toBe('15559998888');
      expect(buyBody.get('country')).toBe('US');

      const [updateUrl, updateInit] = fetchMock.mock.calls[2] as [string, RequestInit];
      expect(updateUrl).toContain('/number/update');
      expect(new URLSearchParams(updateInit.body as string).get('app_id')).toBe('app-789');
    });

    it('routes to a SIP URI when no application is configured', async () => {
      delete process.env.VONAGE_APPLICATION_ID;
      process.env.VONAGE_SIP_URI = 'sip:inbound@sbc.example.com';

      fetchMock
        .mockResolvedValueOnce(jsonResponse({ 'error-code': '200' }))
        .mockResolvedValueOnce(jsonResponse({ 'error-code': '200' }));

      await new VonageAdapter().purchaseNumber({ number: '+15551112222' });

      const [, updateInit] = fetchMock.mock.calls[1] as [string, RequestInit];
      const body = new URLSearchParams(updateInit.body as string);
      expect(body.get('voiceCallbackType')).toBe('sip');
      expect(body.get('voiceCallbackValue')).toBe('sip:inbound@sbc.example.com');
    });

    it('refuses to buy a number it cannot route', async () => {
      delete process.env.VONAGE_APPLICATION_ID;

      await expect(new VonageAdapter().purchaseNumber({ areaCode: '555' })).rejects.toThrow(
        /VONAGE_APPLICATION_ID or VONAGE_SIP_URI/
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    // Buying and routing are two calls, and the number is already billing by
    // the time the second one runs — so the failure has to name it.
    it('names the purchased number when routing it fails', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ 'error-code': '200' }))
        .mockResolvedValueOnce(
          jsonResponse({ 'error-code': '420', 'error-code-label': 'method failed' })
        );

      await expect(new VonageAdapter().purchaseNumber({ number: '15551112222' })).rejects.toThrow(
        '+15551112222 was purchased but could not be routed'
      );
    });

    it('reports an empty search', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ count: 0, numbers: [] }));

      await expect(new VonageAdapter().purchaseNumber({ areaCode: '999' })).rejects.toThrow(
        'No available Vonage numbers found for area code 999'
      );
    });
  });

  describe('releaseNumber', () => {
    // `/number/cancel` needs the country and providerId cannot carry it, so it
    // is read back before cancelling.
    it('looks the country up before cancelling', async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse({ count: 1, numbers: [{ country: 'GB', msisdn: '447700900000' }] })
        )
        .mockResolvedValueOnce(jsonResponse({ 'error-code': '200' }));

      await new VonageAdapter().releaseNumber('447700900000');

      const [cancelUrl, cancelInit] = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(cancelUrl).toContain('/number/cancel');
      const body = new URLSearchParams(cancelInit.body as string);
      expect(body.get('country')).toBe('GB');
      expect(body.get('msisdn')).toBe('447700900000');
    });

    it('falls back to the default country when the lookup finds nothing', async () => {
      process.env.VONAGE_DEFAULT_COUNTRY = 'CA';
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ count: 0, numbers: [] }))
        .mockResolvedValueOnce(jsonResponse({ 'error-code': '200' }));

      await new VonageAdapter().releaseNumber('15551234567');

      const [, cancelInit] = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(new URLSearchParams(cancelInit.body as string).get('country')).toBe('CA');
    });
  });

  describe('getNumber', () => {
    // `search_pattern=1` is a contains match, so the response can carry
    // neighbours of the number asked for.
    it('returns only the exact match', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          count: 2,
          numbers: [
            { country: 'US', msisdn: '15551234560', features: ['VOICE'] },
            { country: 'US', msisdn: '15551234567', features: ['VOICE'] },
          ],
        })
      );

      const result = await new VonageAdapter().getNumber('+1 (555) 123-4567');
      expect(result?.number).toBe('+15551234567');
    });

    it('returns null when the account does not hold the number', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ count: 0, numbers: [] }));
      expect(await new VonageAdapter().getNumber('15550000000')).toBeNull();
    });
  });

  describe('error handling', () => {
    // Vonage reports write failures in the body and leaves the status line at
    // 200, so a bare `response.ok` check would read those as successes.
    it('treats a non-200 error-code in a 200 response as a failure', async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse({ count: 1, numbers: [{ country: 'US', msisdn: '15551234567' }] })
        )
        .mockResolvedValueOnce(
          jsonResponse({ 'error-code': '401', 'error-code-label': 'authentication failed' })
        );

      await expect(new VonageAdapter().releaseNumber('15551234567')).rejects.toThrow(
        'Vonage API error: authentication failed (401)'
      );
    });

    it('names authentication failures for what they are', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ 'error-code-label': 'nope' }, 401));

      await expect(new VonageAdapter().listNumbers()).rejects.toThrow(
        'Vonage authentication failed. Check credentials.'
      );
    });
  });
});
