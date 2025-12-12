import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock secrets before importing adapter
vi.mock('../../../secrets.js', () => ({
  secrets: {
    get: vi.fn((key: string) => {
      if (key === 'TELNYX_API_KEY') return 'test-api-key';
      if (key === 'TELNYX_CONNECTION_ID') return 'test-connection-id';
      return undefined;
    }),
    getRequired: vi.fn((key: string) => {
      if (key === 'TELNYX_API_KEY') return 'test-api-key';
      if (key === 'TELNYX_CONNECTION_ID') return 'test-connection-id';
      throw new Error(`Missing secret ${key}`);
    }),
  },
}));

// Mock logger
vi.mock('../../../../lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

import { TelnyxAdapter } from '../telnyx-adapter.js';

describe('TelnyxAdapter', () => {
  let adapter: TelnyxAdapter;
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = fetchMock;
    adapter = new TelnyxAdapter();
  });

  describe('configuration', () => {
    it('should be configured when secrets are present', () => {
      expect(adapter.isConfigured()).toBe(true);
    });
  });

  describe('listNumbers', () => {
    it('should list numbers and map response correctly', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              id: '123',
              phone_number: '+15551234567',
              status: 'active',
              connection_id: 'conn-1',
              created_at: '2023-01-01T00:00:00Z',
              tags: ['tag1'],
            },
          ],
        }),
      });

      const numbers = await adapter.listNumbers();

      expect(numbers).toHaveLength(1);
      expect(numbers[0]).toEqual({
        id: '123',
        number: '+15551234567',
        provider: 'telnyx',
        status: 'assigned',
        features: { voice: true, sms: true, mms: true },
        providerId: '123',
        purchasedAt: expect.any(Date),
        metadata: {
          connectionId: 'conn-1',
          tags: ['tag1'],
        },
      });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/phone_numbers'),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
          }),
        })
      );
    });
  });

  describe('purchaseNumber', () => {
    it('should search and purchase a number', async () => {
      // Mock search response
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              phone_number: '+15559998888',
              region_information: {
                region_name: 'NY',
                region_code: 'NY',
              },
            },
          ],
        }),
      });

      // Mock purchase response
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            id: 'new-id',
            phone_number: '+15559998888',
            status: 'active',
            connection_id: 'test-connection-id',
            created_at: '2023-01-02T00:00:00Z',
          },
        }),
      });

      const result = await adapter.purchaseNumber({
        areaCode: '555',
        country: 'US',
      });

      expect(result.number).toBe('+15559998888');
      expect(result.providerId).toBe('new-id');
      expect(result.metadata?.connectionId).toBe('test-connection-id');

      // Verify search call
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('/available_phone_numbers'),
        expect.objectContaining({ method: 'GET' })
      );

      // Verify purchase call
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('/phone_numbers'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            phone_number: '+15559998888',
            connection_id: 'test-connection-id',
          }),
        })
      );
    });

    it('should throw if no numbers available', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      });

      await expect(adapter.purchaseNumber({ areaCode: '999' })).rejects.toThrow(
        'No available numbers found'
      );
    });
  });

  describe('releaseNumber', () => {
    it('should release a number', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      await adapter.releaseNumber('123');

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/phone_numbers/123'),
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('error handling', () => {
    it('should handle API errors', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ errors: [{ detail: 'Invalid request' }] }),
      });

      await expect(adapter.listNumbers()).rejects.toThrow('Telnyx API error: Invalid request');
    });
  });
});
