import { createClient, ClickHouseClient } from '@clickhouse/client';

import { logger } from '../lib/logger.js';

export class ClickHouseService {
  private client: ClickHouseClient | null = null;
  private enabled: boolean;

  constructor() {
    const clickhouseUrl = process.env.CLICKHOUSE_URL;
    const clickhouseUser = process.env.CLICKHOUSE_USER || 'default';
    const clickhousePassword = process.env.CLICKHOUSE_PASSWORD || '';
    const clickhouseDatabase = process.env.CLICKHOUSE_DATABASE || 'default';

    this.enabled = !!clickhouseUrl;

    if (this.enabled) {
      try {
        this.client = createClient({
          url: clickhouseUrl!,
          username: clickhouseUser,
          password: clickhousePassword,
          database: clickhouseDatabase,
        });
        logger.info('ClickHouse client initialized');
      } catch (error) {
        logger.error('Failed to initialize ClickHouse client:', error);
        this.enabled = false;
      }
    } else {
      logger.warn('ClickHouse not configured, falling back to Postgres');
    }
  }

  isEnabled(): boolean {
    return this.enabled && this.client !== null;
  }

  async query<T = unknown>(query: string, params?: Record<string, unknown>): Promise<T[]> {
    if (!this.isEnabled() || !this.client) {
      throw new Error('ClickHouse is not enabled');
    }

    try {
      const result = await this.client.query({
        query,
        query_params: params || {},
        format: 'JSONEachRow',
      });

      const data = await result.json<T>();
      return data;
    } catch (error) {
      logger.error('ClickHouse query error:', error);
      throw error;
    }
  }

  async insert(table: string, data: unknown[]): Promise<void> {
    if (!this.isEnabled() || !this.client) {
      throw new Error('ClickHouse is not enabled');
    }

    try {
      await this.client.insert({
        table,
        values: data,
        format: 'JSONEachRow',
      });
    } catch (error) {
      logger.error('ClickHouse insert error:', error);
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
    }
  }
}

export const clickhouseService = new ClickHouseService();

