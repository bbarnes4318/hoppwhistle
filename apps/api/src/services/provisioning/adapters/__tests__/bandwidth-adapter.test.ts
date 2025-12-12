/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock secrets before importing adapter
vi.mock('../../../secrets.js', () => ({
  secrets: {
    get: vi.fn((key: string) => {
      if (key === 'BANDWIDTH_ACCOUNT_ID') return 'test-account';
      if (key === 'BANDWIDTH_USERNAME') return 'test-user';
      if (key === 'BANDWIDTH_PASSWORD') return 'test-pass';
      if (key === 'BANDWIDTH_SITE_ID') return 'test-site';
      return undefined;
    }),
    getRequired: vi.fn((key: string) => {
      if (key === 'BANDWIDTH_ACCOUNT_ID') return 'test-account';
      if (key === 'BANDWIDTH_USERNAME') return 'test-user';
      if (key === 'BANDWIDTH_PASSWORD') return 'test-pass';
      if (key === 'BANDWIDTH_SITE_ID') return 'test-site';
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

import { BandwidthAdapter } from '../bandwidth-adapter.js';

describe('BandwidthAdapter', () => {
  let adapter: BandwidthAdapter;
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = fetchMock;
    adapter = new BandwidthAdapter();
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
        status: 200,
        headers: { get: () => '100' },
        json: () =>
          Promise.resolve([
            {
              id: '123',
              TelephoneNumber: '15551234567',
              Status: 'Inservice',
              City: 'New York',
              State: 'NY',
              SiteId: 'test-site',
            },
          ]),
      });

      const numbers = await adapter.listNumbers();

      expect(numbers).toHaveLength(1);
      expect(numbers[0].id).toBe('123');
      expect(numbers[0].number).toBe('+15551234567');
      expect(numbers[0].provider).toBe('bandwidth');
      expect(numbers[0].status).toBe('assigned');
      expect(numbers[0].features).toEqual({ voice: true, sms: true });
      expect(numbers[0].providerId).toBe('123');
      expect(numbers[0].metadata).toEqual({
        city: 'New York',
        state: 'NY',
        siteId: 'test-site',
      });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/phoneNumbers'),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: expect.stringContaining('Basic'),
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
        status: 200,
        headers: { get: () => '100' },
        json: () =>
          Promise.resolve([
            {
              TelephoneNumber: '15559998888',
              City: 'Denver',
              State: 'CO',
              RateCenter: 'DENVER',
            },
          ]),
      });

      // Mock purchase response
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: { get: () => '100' },
        json: () =>
          Promise.resolve({
            Order: {
              id: 'order-123',
              OrderStatus: 'Received',
              CompletedNumbers: {
                TelephoneNumber: ['15559998888'],
              },
            },
          }),
      });

      const result = await adapter.purchaseNumber({
        areaCode: '555',
        region: 'CO',
      });

      expect(result.number).toBe('+15559998888');
      expect(result.providerId).toBe('15559998888');
      expect(result.metadata?.orderId).toBe('order-123');

      // Verify search call
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('/availableNumbers'),
        expect.objectContaining({ method: 'GET' })
      );

      // Verify purchase call
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('/orders'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('ExistingTelephoneNumberOrderType'),
        })
      );
    });
  });

  describe('releaseNumber', () => {
    it('should release a number', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => '0' },
        json: () => Promise.resolve({}),
      } as unknown as Response);

      await adapter.releaseNumber('+15551234567');

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/phoneNumbers/5551234567'),
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('error handling', () => {
    it('should handle API errors', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve(JSON.stringify({ Description: 'Bad Request' })),
        headers: { get: () => '100' },
      } as unknown as Response);

      await expect(adapter.listNumbers()).rejects.toThrow('Bandwidth API error: Bad Request');
    });
  });
});
