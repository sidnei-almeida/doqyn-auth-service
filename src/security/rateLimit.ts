import { RateLimitError } from '../utils/errors.js';
import { redisIncrWithTtl } from '../redis/redisClient.js';
import { prefixRedisKey } from '../redis/redisConfig.js';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

const WINDOW_MS = 15 * 60 * 1000;
const WINDOW_SECONDS = Math.floor(WINDOW_MS / 1000);
const MAX_ATTEMPTS = 10;

function cleanupExpired(): void {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (entry.resetAt <= now) {
      store.delete(key);
    }
  }
}

function checkLimitMemory(key: string, maxAttempts: number = MAX_ATTEMPTS): void {
  cleanupExpired();
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || entry.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }

  if (entry.count >= maxAttempts) {
    throw new RateLimitError();
  }

  entry.count += 1;
}

async function checkLimit(key: string, maxAttempts: number = MAX_ATTEMPTS): Promise<void> {
  const count = await redisIncrWithTtl(`auth:ratelimit:${key}`, WINDOW_SECONDS);
  if (count !== null) {
    if (count > maxAttempts) throw new RateLimitError();
    return;
  }

  checkLimitMemory(key, maxAttempts);
}

export async function checkLoginRateLimit(ipHash: string, emailLookupHash?: string): Promise<void> {
  await checkLimit(`login:ip:${ipHash}`);
  if (emailLookupHash) {
    await checkLimit(`login:email:${emailLookupHash}`);
  }
}

export async function checkPasswordResetRequestRateLimit(
  ipHash: string,
  emailLookupHash?: string,
): Promise<void> {
  await checkLimit(`reset-request:ip:${ipHash}`, 5);
  if (emailLookupHash) {
    await checkLimit(`reset-request:email:${emailLookupHash}`, 3);
  }
}

export async function checkPasswordResetRateLimit(ipHash: string): Promise<void> {
  await checkLimit(`reset:ip:${ipHash}`, 5);
}

export async function checkOAuthRateLimit(ipHash: string): Promise<void> {
  await checkLimit(`oauth:ip:${ipHash}`, 20);
}

export async function checkInviteCreateRateLimit(ipHash: string): Promise<void> {
  await checkLimit(`invite-create:ip:${ipHash}`, 30);
}

export async function checkInviteAcceptRateLimit(ipHash: string): Promise<void> {
  await checkLimit(`invite-accept:ip:${ipHash}`, 15);
}

export async function checkSignupRateLimit(ipHash: string): Promise<void> {
  await checkLimit(`signup:ip:${ipHash}`, 8);
}

export async function checkAccessRequestRateLimit(ipHash: string): Promise<void> {
  await checkLimit(`access-request:ip:${ipHash}`, 10);
}

export async function checkEmailChangeRequestRateLimit(
  ipHash: string,
  userId: string,
): Promise<void> {
  await checkLimit(`email-change-request:ip:${ipHash}`, 10);
  await checkLimit(`email-change-request:user:${userId}`, 5);
}

export async function checkEmailChangeConfirmRateLimit(ipHash: string): Promise<void> {
  await checkLimit(`email-change-confirm:ip:${ipHash}`, 15);
}

export function resetRateLimitStore(): void {
  store.clear();
}

export async function resetRateLimitRedis(): Promise<void> {
  const { getRedisClient } = await import('../redis/redisClient.js');
  const client = await getRedisClient();
  if (!client) return;

  const pattern = prefixRedisKey('auth:ratelimit:*');
  let cursor = '0';
  do {
    const [nextCursor, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = nextCursor;
    if (keys.length > 0) {
      await client.del(...keys);
    }
  } while (cursor !== '0');
}
