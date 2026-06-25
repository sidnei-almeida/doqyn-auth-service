import { randomBytes } from 'node:crypto';

const TOKEN_BYTES = 32;

export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function generatePasswordResetToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function generateEmailVerificationToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}
