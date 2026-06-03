import Redis from 'ioredis';

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      connectTimeout: 5000,
      commandTimeout: 3000,
      retryStrategy: (times) => {
        // Never give up reconnecting — exponential backoff capped at 5s
        const delay = Math.min(times * 200, 5000);
        console.warn(`[Redis] Reconnecting attempt ${times}, next retry in ${delay}ms`);
        return delay;
      },
      reconnectOnError: (err) => {
        // Auto-reconnect on connection-related errors
        const targetErrors = ['READONLY', 'ECONNRESET', 'ECONNREFUSED'];
        return targetErrors.some(e => err.message.includes(e));
      },
      lazyConnect: false,
    });

    redisClient.on('error', (err) => {
      console.error('[Redis] Client Error:', err.message);
    });

    redisClient.on('connect', () => {
      console.log('✅ Redis connected');
    });

    redisClient.on('reconnecting', () => {
      console.warn('[Redis] Reconnecting...');
    });
  }

  return redisClient;
}

export async function closeRedisClient(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}

