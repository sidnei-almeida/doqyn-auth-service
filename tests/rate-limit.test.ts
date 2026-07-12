import { describe, expect, it } from 'vitest';
import { RateLimitError } from '../src/utils/errors.js';
import {
  checkLoginRateLimit,
  resetRateLimitStore,
} from '../src/security/rateLimit.js';

describe('rateLimit — in-memory fallback', () => {
  it('bloqueia após exceder tentativas de login por IP', async () => {
    resetRateLimitStore();
    const ipHash = 'test-ip-hash-rate-limit';

    for (let i = 0; i < 10; i += 1) {
      await checkLoginRateLimit(ipHash);
    }

    await expect(checkLoginRateLimit(ipHash)).rejects.toBeInstanceOf(RateLimitError);
  });
});
