import { RateLimitError } from '../utils/errors.js';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function cleanupExpired(): void {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (entry.resetAt <= now) {
      store.delete(key);
    }
  }
}

function checkLimit(key: string, maxAttempts: number = MAX_ATTEMPTS): void {
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

export function checkLoginRateLimit(ipHash: string, emailLookupHash?: string): void {
  checkLimit(`login:ip:${ipHash}`);
  if (emailLookupHash) {
    checkLimit(`login:email:${emailLookupHash}`);
  }
}

export function checkPasswordResetRequestRateLimit(
  ipHash: string,
  emailLookupHash?: string,
): void {
  checkLimit(`reset-request:ip:${ipHash}`, 5);
  if (emailLookupHash) {
    checkLimit(`reset-request:email:${emailLookupHash}`, 3);
  }
}

export function checkPasswordResetRateLimit(ipHash: string): void {
  checkLimit(`reset:ip:${ipHash}`, 5);
}

export function resetRateLimitStore(): void {
  store.clear();
}
