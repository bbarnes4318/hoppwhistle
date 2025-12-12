import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import { secrets } from '../../secrets.js';
import { BandwidthAdapter } from '../adapters/bandwidth-adapter.js';
import { TelnyxAdapter } from '../adapters/telnyx-adapter.js';

// Mock secrets
vi.mock('../../secrets.js', () => ({
  secrets: {
    getRequired: vi.fn((key: string) => {
      const mocks: Record<string, string> = {
        TELNYX_API_KEY: 'mock-telnyx-key',
        BANDWIDTH_ACCOUNT_ID: 'mock-bw-account',
        BANDWIDTH_USERNAME: 'mock-bw-user',
        BANDWIDTH_PASSWORD: 'mock-bw-pass',
        BANDWIDTH_APPLICATION_ID: 'mock-bw-app',
        BANDWIDTH_SITE_ID: 'mock-bw-site',
      };
      return mocks[key] || 'mock-value';
    }),
    get: vi.fn((key: string) => {
      const mocks: Record<string, string> = {
        TELNYX_API_KEY: 'mock-telnyx-key',
        BANDWIDTH_ACCOUNT_ID: 'mock-bw-account',
        BANDWIDTH_USERNAME: 'mock-bw-user',
        BANDWIDTH_PASSWORD: 'mock-bw-pass',
        BANDWIDTH_SITE_ID: 'mock-bw-site',
      };
      return mocks[key];
    }),
  },
}));

// Mock global fetch
const globalFetch = global.fetch;
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Provisioning Adapters', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('TelnyxAdapter', () => {
    const adapter = new TelnyxAdapter();

    it('should be configured', () => {
      expect(adapter.isConfigured()).toBe(true);
    });

    it('should list numbers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              id: '123',
              phone_number: '+15551234567',
              status: 'active',
              connection_id: 'conn-1',
              tags: ['voice'],
              created_at: '2023-01-01T00:00:00Z',
            },
          ],
        }),
        headers: new Headers(),
      });

      const numbers = await adapter.listNumbers();
      expect(numbers).toHaveLength(1);
      expect(numbers[0].number).toBe('+15551234567');
      expect(numbers[0].provider).toBe('telnyx');
    });

    it('should purchase a number', async () => {
      // Mock search response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              phone_number: '+15559998888',
              region_information: { region_name: 'NY' },
            },
          ],
        }),
        headers: new Headers(),
      });

      // Mock purchase response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            id: 'new-id',
            phone_number: '+15559998888',
            status: 'active',
            connection_id: 'conn-1',
            created_at: '2023-01-01T00:00:00Z',
          },
        }),
        headers: new Headers(),
      });

      const result = await adapter.purchaseNumber({
        areaCode: '555',
        features: { voice: true },
      });

      expect(result.number).toBe('+15559998888');
      expect(mockFetch).toHaveBeenCalledTimes(2);
      // Check search url
      expect(mockFetch.mock.calls[0][0]).toContain('available_phone_numbers');
      // Check purchase url
      expect(mockFetch.mock.calls[1][0]).toContain('phone_numbers');
      expect(mockFetch.mock.calls[1][1]?.method).toBe('POST');
    });
  });

  describe('BandwidthAdapter', () => {
    const adapter = new BandwidthAdapter();

    it('should be configured', () => {
      expect(adapter.isConfigured()).toBe(true);
    });

    it('should list numbers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            City: 'RALEIGH',
            Lata: '426',
            RateCenter: 'RALEIGH',
            State: 'NC',
            TelephoneNumber: '5551112222',
            id: 'bw-123',
            accountId: '123',
            applicationId: 'app-1',
            siteId: 'site-1',
          },
        ],
        headers: new Headers(),
      });

      const numbers = await adapter.listNumbers();
      expect(numbers).toHaveLength(1);
      expect(numbers[0].number).toBe('+15551112222');
      expect(numbers[0].provider).toBe('bandwidth');
    });

    it('should purchase a number', async () => {
      // Mock search response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            City: 'DENVER',
            Lata: '656',
            RateCenter: 'DENVER',
            State: 'CO',
            TelephoneNumber: '5553334444',
            national_number: '5553334444',
          },
        ],
        headers: new Headers(),
      });

      // Mock order response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          Order: {
            id: 'order-1',
            OrderType: 'new_number_orders',
            OrderStatus: 'COMPLETE',
            CompletedNumbers: {
              TelephoneNumber: ['5553334444'],
            },
          },
        }),
        headers: new Headers(),
      });

      const result = await adapter.purchaseNumber({
        areaCode: '555',
      });

      expect(result.number).toBe('+15553334444');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
