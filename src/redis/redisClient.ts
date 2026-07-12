import { Redis } from 'ioredis';
import {
  getRedisConnectTimeoutMs,
  getRedisMaxRetries,
  getRedisUrl,
  isRateLimitRedisEnabled,
  prefixRedisKey,
} from './redisConfig.js';

type RedisCache = {
  client: Redis | null;
  promise: Promise<Redis | null> | null;
};

declare global {
  var _doqynAuthRedisCache: RedisCache | undefined;
}

const cache: RedisCache = global._doqynAuthRedisCache ?? {
  client: null,
  promise: null,
};
global._doqynAuthRedisCache = cache;

export function isRedisConfigured(): boolean {
  return isRateLimitRedisEnabled() && Boolean(getRedisUrl());
}

export async function getRedisClient(): Promise<Redis | null> {
  if (!isRedisConfigured()) return null;
  if (cache.client) return cache.client;

  if (!cache.promise) {
    cache.promise = (async () => {
      const url = getRedisUrl();
      if (!url) return null;

      const client = new Redis(url, {
        maxRetriesPerRequest: getRedisMaxRetries(),
        connectTimeout: getRedisConnectTimeoutMs(),
        lazyConnect: true,
        enableOfflineQueue: false,
        retryStrategy(times: number) {
          return Math.min(times * 200, 3_000);
        },
      });

      client.on('error', () => {
        // falha silenciosa — rate limit cai para in-memory
      });

      try {
        await client.connect();
        cache.client = client;
        return client;
      } catch {
        try {
          client.disconnect();
        } catch {
          // ignore
        }
        cache.client = null;
        return null;
      }
    })();
  }

  return cache.promise;
}

export async function connectRedisOnBoot(): Promise<void> {
  await getRedisClient();
}

export async function redisIncrWithTtl(
  key: string,
  ttlSeconds: number,
): Promise<number | null> {
  const client = await getRedisClient();
  if (!client) return null;

  const prefixed = prefixRedisKey(key);
  const value = await client.incr(prefixed);
  if (value === 1) {
    await client.expire(prefixed, ttlSeconds);
  }
  return value;
}

export async function closeRedis(): Promise<void> {
  if (cache.client) {
    await cache.client.quit();
  }
  cache.client = null;
  cache.promise = null;
}
