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

/**
 * Chave anterior, usada apenas para DECIFRAR durante uma rotação.
 *
 * Sem isto, `DATA_ENCRYPTION_KEY` era introcável na prática: todo payload é gravado com o prefixo
 * `v1` e `decryptField` recusava qualquer outro, então trocar a chave tornava ilegível a base
 * inteira — e-mails, nomes, tudo. Uma chave que não pode ser trocada nem depois de vazamento
 * suspeito não é uma chave, é um passivo.
 *
 * Procedimento de rotação:
 *   1. `DATA_ENCRYPTION_KEY_PREVIOUS` = chave atual; `DATA_ENCRYPTION_KEY` = chave nova. Reinicia.
 *      A partir daqui tudo é gravado com a nova e o legado continua legível.
 *   2. Roda o rescrito dos campos cifrados (lê e regrava, o que os move para a chave nova).
 *   3. Remove `DATA_ENCRYPTION_KEY_PREVIOUS`. Reinicia.
 */
function getPreviousEncryptionKey(): Buffer | null {
  const raw = loadEnv().DATA_ENCRYPTION_KEY_PREVIOUS;
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  return key.length === 32 ? key : null;
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

function decryptWith(
  key: Buffer,
  iv: Buffer,
  authTag: Buffer,
  cipherText: Buffer,
): string {
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(cipherText), decipher.final()]).toString('utf8');
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

  try {
    return decryptWith(getEncryptionKey(), iv, authTag, cipherText);
  } catch (error) {
    // GCM autentica: falha aqui significa "não foi esta chave" (ou payload adulterado). Tentar a
    // chave anterior é o que permite ler o legado durante a rotação. Se não houver chave anterior,
    // o erro original sobe intacto — nunca mascarar falha de integridade.
    const previous = getPreviousEncryptionKey();
    if (!previous) throw error;
    return decryptWith(previous, iv, authTag, cipherText);
  }
}

/**
 * Verdadeiro quando o payload já está na chave corrente.
 *
 * Serve ao passo 2 da rotação: o rescrito usa isto para pular o que já foi migrado, em vez de
 * decifrar e regravar a base inteira a cada execução.
 */
export function isEncryptedWithCurrentKey(payload: string): boolean {
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) return false;

  try {
    decryptWith(
      getEncryptionKey(),
      Buffer.from(parts[1], 'base64'),
      Buffer.from(parts[2], 'base64'),
      Buffer.from(parts[3], 'base64'),
    );
    return true;
  } catch {
    return false;
  }
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

export function hashInviteToken(token: string): string {
  return hmacSha256(token, getPasswordResetTokenSecret());
}

export function hashEmailChangeToken(token: string): string {
  return hmacSha256(token, getPasswordResetTokenSecret());
}

export function hashIp(ip: string): string {
  return hmacSha256(ip, getLookupSecret());
}

export function hashUserAgent(userAgent: string): string {
  return hmacSha256(userAgent, getLookupSecret());
}
