import { describe, it, expect, beforeEach } from 'vitest';
import {
  decryptField,
  encryptField,
  hashLookup,
} from '../src/security/crypto.js';
import { normalizeEmail } from '../src/utils/normalize.js';
import { resetEnvCache } from '../src/config/env.js';
import { TEST_ENV } from './setup.js';

describe('crypto', () => {
  beforeEach(() => {
    Object.assign(process.env, TEST_ENV);
    resetEnvCache();
  });

  it('encryptField/decryptField funciona', () => {
    const value = 'usuario@empresa.com';
    const encrypted = encryptField(value);
    const decrypted = decryptField(encrypted);
    expect(decrypted).toBe(value);
  });

  it('encryptField gera resultado diferente para o mesmo valor', () => {
    const value = 'usuario@empresa.com';
    const a = encryptField(value);
    const b = encryptField(value);
    expect(a).not.toBe(b);
    expect(decryptField(a)).toBe(value);
    expect(decryptField(b)).toBe(value);
  });

  it('hashLookup gera mesmo resultado para mesmo e-mail normalizado', () => {
    const a = hashLookup(normalizeEmail('Usuario@Empresa.COM'));
    const b = hashLookup(normalizeEmail('usuario@empresa.com'));
    expect(a).toBe(b);
  });

  it('hashLookup muda se o secret mudar', () => {
    const original = hashLookup('usuario@empresa.com');
    process.env.LOOKUP_HASH_SECRET = 'outro-secret';
    resetEnvCache();
    const changed = hashLookup('usuario@empresa.com');
    expect(changed).not.toBe(original);
  });

  it('decryptField falha com payload inválido', () => {
    expect(() => decryptField('invalid')).toThrow();
    expect(() => decryptField('v1:bad:bad:bad')).toThrow();
  });
});

describe('crypto key validation', () => {
  it('rejeita DATA_ENCRYPTION_KEY inválida', () => {
    process.env.DATA_ENCRYPTION_KEY = Buffer.from('short').toString('base64');
    resetEnvCache();
    expect(() => encryptField('test')).toThrow('32 bytes');
  });
});
