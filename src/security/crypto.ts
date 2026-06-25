import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { loadEnv } from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const VERSION = 'v1';

function getEncryptionKey(): Buffer {
  const env = loadEnv();
  const key = Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64');
  if (key.length !== 32) {
    throw new Error('DATA_ENCRYPTION_KEY must be 32 bytes in base64');
  }
  return key;
}

function getLookupSecret(): string {
  return loadEnv().LOOKUP_HASH_SECRET;
}

function getSessionTokenSecret(): string {
  return loadEnv().SESSION_TOKEN_HASH_SECRET;
}

function getPasswordResetTokenSecret(): string {
  return loadEnv().PASSWORD_RESET_TOKEN_HASH_SECRET;
}

function hmacSha256(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

export function encryptField(value: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptField(payload: string): string {
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Invalid encrypted payload');
  }

  const [, ivB64, authTagB64, cipherB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const cipherText = Buffer.from(cipherB64, 'base64');

  const decipher = createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(cipherText), decipher.final()]);
  return decrypted.toString('utf8');
}

export function hashLookup(value: string): string {
  return hmacSha256(value, getLookupSecret());
}

export function hashSessionToken(token: string): string {
  return hmacSha256(token, getSessionTokenSecret());
}

export function hashPasswordResetToken(token: string): string {
  return hmacSha256(token, getPasswordResetTokenSecret());
}

export function hashIp(ip: string): string {
  return hmacSha256(ip, getLookupSecret());
}

export function hashUserAgent(userAgent: string): string {
  return hmacSha256(userAgent, getLookupSecret());
}
