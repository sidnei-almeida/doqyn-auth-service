import argon2 from 'argon2';
import { loadEnv } from '../config/env.js';

const ARGON2_OPTIONS: argon2.Options & { type: typeof argon2.argon2id } = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
};

function applyPepper(password: string): string {
  const pepper = loadEnv().PASSWORD_PEPPER;
  return pepper ? `${password}${pepper}` : password;
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(applyPepper(password), ARGON2_OPTIONS);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  try {
    return await argon2.verify(passwordHash, applyPepper(password));
  } catch {
    return false;
  }
}

export function isArgon2idHash(hash: string): boolean {
  return hash.startsWith('$argon2id$');
}

export const MIN_PASSWORD_LENGTH = 8;

export function validatePasswordStrength(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `A senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  }
  return null;
}
