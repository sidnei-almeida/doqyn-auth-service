import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

describe('Onda 2 — rate limit signup', () => {
  it('rateLimit exporta checkSignupRateLimit e checkAccessRequestRateLimit', () => {
    const source = read('src/security/rateLimit.ts');
    expect(source).toContain('checkSignupRateLimit');
    expect(source).toContain('checkAccessRequestRateLimit');
  });

  it('auth.routes aplica rate limit em signup e access-request', () => {
    const source = read('src/modules/auth/auth.routes.ts');
    expect(source).toContain('checkSignupRateLimit');
    expect(source).toContain('checkAccessRequestRateLimit');
    expect(source).toContain("'/auth/company-signups'");
    expect(source).toContain("'/auth/individual-signups'");
    expect(source).toContain("'/auth/access-requests'");
  });
});
