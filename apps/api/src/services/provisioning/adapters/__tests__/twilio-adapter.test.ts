import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../secrets.js', () => ({
  secrets: { get: vi.fn(() => undefined), getRequired: vi.fn(() => '') },
}));

vi.mock('../../../../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { TwilioAdapter } from '../twilio-adapter.js';

/** Twilio answers JSON; every endpoint here is read through `fetch`. */
function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

describe('TwilioAdapter', () => {
  const fetchMock = vi.fn();
  const ENV_KEYS = [
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_API_KEY_SID',
    'TWILIO_API_KEY_SECRET',
    'TWILIO_API_KEY',
    'TWILIO_API_SECRET',
    'TWILIO_TRUNK_SID',
    'TWILIO_VOICE_URL',
  ];
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = fetchMock as unknown as typeof fetch;
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    process.env.TWILIO_ACCOUNT_SID = 'AC123';
    process.env.TWILIO_AUTH_TOKEN = 'auth-token';
    process.env.TWILIO_TRUNK_SID = 'TK999';
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  describe('configuration', () => {
    it('is configured from account SID and auth token', () => {
      expect(new TwilioAdapter().isConfigured()).toBe(true);
    });

    it('accepts an API key pair in place of the auth token', () => {
      delete process.env.TWILIO_AUTH_TOKEN;
      process.env.TWILIO_API_KEY_SID = 'SK123';
      process.env.TWILIO_API_KEY_SECRET = 'sk-secret';
      expect(new TwilioAdapter().isConfigured()).toBe(true);
    });

    // The platform's carrier and CNAM lookups already use these names for a
    // Twilio API key. Reusing them here means one credential, not two.
    it('falls back to the TWILIO_API_KEY / TWILIO_API_SECRET names', async () => {
      delete process.env.TWILIO_AUTH_TOKEN;
      process.env.TWILIO_API_KEY = 'SK456';
      process.env.TWILIO_API_SECRET = 'legacy-secret';

      const adapter = new TwilioAdapter();
      expect(adapter.isConfigured()).toBe(true);

      fetchMock.mockResolvedValueOnce(jsonResponse({ incoming_phone_numbers: [] }));
      await adapter.listNumbers();

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const auth = (init.headers as Record<string, string>).Authorization;
      expect(Buffer.from(auth.replace('Basic ', ''), 'base64').toString()).toBe(
        'SK456:legacy-secret'
      );
    });

    it('is not configured without credentials', () => {
      delete process.env.TWILIO_AUTH_TOKEN;
      expect(new TwilioAdapter().isConfigured()).toBe(false);
    });
  });

  describe('listNumbers', () => {
    it('maps owned numbers onto the provisioning shape', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          incoming_phone_numbers: [
            {
              sid: 'PN1',
              phone_number: '+15551234567',
              friendly_name: 'Main line',
              status: 'in-use',
              date_created: 'Tue, 02 Jan 2024 00:00:00 +0000',
              trunk_sid: 'TK999',
              voice_url: null,
              capabilities: { voice: true, sms: true, mms: false, fax: false },
            },
          ],
        })
      );

      const numbers = await new TwilioAdapter().listNumbers();

      expect(numbers).toHaveLength(1);
      expect(numbers[0]).toMatchObject({
        id: 'PN1',
        number: '+15551234567',
        provider: 'twilio',
        status: 'assigned',
        providerId: 'PN1',
        features: { voice: true, sms: true, mms: false, fax: false },
      });
      expect(numbers[0].metadata).toMatchObject({ trunkSid: 'TK999' });

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/Accounts/AC123/IncomingPhoneNumbers.json');
      expect(init.method).toBe('GET');
      expect((init.headers as Record<string, string>).Authorization).toBe(
        `Basic ${Buffer.from('AC123:auth-token').toString('base64')}`
      );
    });

    // Twilio's owned-number filter is a pattern with `*` per digit, not an
    // AreaCode parameter — that one only exists on the availability search.
    it('filters by area code with a wildcard pattern', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ incoming_phone_numbers: [] }));

      await new TwilioAdapter().listNumbers({ areaCode: '212' });

      const [url] = fetchMock.mock.calls[0] as [string];
      expect(decodeURIComponent(url)).toContain('PhoneNumber=+1212*******');
    });
  });

  describe('purchaseNumber', () => {
    it('searches, buys, and points the number at the SIP trunk', async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse({
            available_phone_numbers: [
              { phone_number: '+15559998888', region: 'NY', capabilities: { voice: true } },
            ],
          })
        )
        .mockResolvedValueOnce(
          jsonResponse({
            sid: 'PN2',
            phone_number: '+15559998888',
            status: 'in-use',
            date_created: 'Tue, 02 Jan 2024 00:00:00 +0000',
            trunk_sid: 'TK999',
            capabilities: { voice: true, sms: true },
          })
        );

      const result = await new TwilioAdapter().purchaseNumber({
        areaCode: '555',
        country: 'US',
        features: { voice: true },
      });

      expect(result).toMatchObject({
        number: '+15559998888',
        provider: 'twilio',
        providerId: 'PN2',
        status: 'assigned',
      });

      const [searchUrl] = fetchMock.mock.calls[0] as [string];
      expect(searchUrl).toContain('/AvailablePhoneNumbers/US/Local.json');
      expect(searchUrl).toContain('AreaCode=555');

      const [buyUrl, buyInit] = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(buyUrl).toContain('/IncomingPhoneNumbers.json');
      expect(buyInit.method).toBe('POST');
      // Form-encoded, not JSON: a JSON body is rejected with a 400 that names
      // no field.
      expect((buyInit.headers as Record<string, string>)['Content-Type']).toBe(
        'application/x-www-form-urlencoded'
      );
      const body = new URLSearchParams(buyInit.body as string);
      expect(body.get('PhoneNumber')).toBe('+15559998888');
      expect(body.get('TrunkSid')).toBe('TK999');
    });

    it('buys a specific number without searching first', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ sid: 'PN3', phone_number: '+15551112222', status: 'in-use' })
      );

      const result = await new TwilioAdapter().purchaseNumber({ number: '+15551112222' });

      expect(result.number).toBe('+15551112222');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    // A DID with no routing answers with Twilio's demo message. Refusing the
    // purchase is better than landing a number that bills and never rings here.
    it('refuses to buy when no inbound routing is configured', async () => {
      delete process.env.TWILIO_TRUNK_SID;

      await expect(new TwilioAdapter().purchaseNumber({ areaCode: '555' })).rejects.toThrow(
        /TWILIO_TRUNK_SID/
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reports when the search comes back empty', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ available_phone_numbers: [] }));

      await expect(new TwilioAdapter().purchaseNumber({ areaCode: '999' })).rejects.toThrow(
        'No available Twilio numbers found for area code 999'
      );
    });
  });

  describe('releaseNumber', () => {
    it('deletes the number and tolerates the empty 204 body', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 204,
        statusText: 'No Content',
        text: () => Promise.resolve(''),
      });

      await new TwilioAdapter().releaseNumber('PN1');

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/IncomingPhoneNumbers/PN1.json');
      expect(init.method).toBe('DELETE');
    });
  });

  describe('getNumber', () => {
    it('returns null for a number Twilio does not know', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ message: 'The requested resource was not found', code: 20404 }, 404)
      );

      expect(await new TwilioAdapter().getNumber('PN-missing')).toBeNull();
    });
  });

  describe('configureNumber', () => {
    it('re-points an existing number at the trunk', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ sid: 'PN1', phone_number: '+15551234567' }));

      await new TwilioAdapter().configureNumber('PN1', { voice: true });

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/IncomingPhoneNumbers/PN1.json');
      expect(init.method).toBe('POST');
      expect(new URLSearchParams(init.body as string).get('TrunkSid')).toBe('TK999');
    });
  });

  describe('error handling', () => {
    it('surfaces the Twilio error message and code', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ message: 'Invalid area code', code: 21452 }, 400)
      );

      await expect(new TwilioAdapter().listNumbers()).rejects.toThrow(
        'Twilio API error: Invalid area code [21452] (400)'
      );
    });

    it('names authentication failures for what they are', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'Authenticate' }, 401));

      await expect(new TwilioAdapter().listNumbers()).rejects.toThrow(
        'Twilio authentication failed. Check credentials.'
      );
    });
  });
});
