import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  isArgon2idHash,
} from '../src/security/password.js';

describe('password', () => {
  it('passwordHash usa Argon2id', async () => {
    const hash = await hashPassword('senha-segura-123');
    expect(isArgon2idHash(hash)).toBe(true);
  });

  it('senha correta valida', async () => {
    const password = 'senha-segura-123';
    const hash = await hashPassword(password);
    const valid = await verifyPassword(password, hash);
    expect(valid).toBe(true);
  });

  it('senha errada falha', async () => {
    const hash = await hashPassword('senha-segura-123');
    const valid = await verifyPassword('senha-errada', hash);
    expect(valid).toBe(false);
  });
});
