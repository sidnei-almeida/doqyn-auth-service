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

/**
 * A conferência de apelido é digitada, então o teto é alto — e existe mesmo assim.
 *
 * Quem escolhe um handle no cadastro dispara uma dezena de conferências entre correções. Quem
 * enumera dispara uma por handle testado: sem teto, a rota diria em minutos quais apelidos já
 * existem na base inteira. Ela não diz de quem é o handle, mas a lista dos que existem já é o
 * começo do alvo.
 */
export async function checkUsernameAvailabilityRateLimit(ipHash: string): Promise<void> {
  await checkLimit(`username-available:ip:${ipHash}`, 60);
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

/** Ver `checkEmailVerificationConfirmRateLimit`: soma-se ao contador por linha, não o substitui. */
export async function checkEmailChangeCodeRateLimit(ipHash: string): Promise<void> {
  await checkLimit(`email-change-code:ip:${ipHash}`, 20);
}

/**
 * Teto de envio, e ele protege terceiros antes de proteger a plataforma.
 *
 * O endereço que recebe o código não é de quem aperta o botão — é de quem foi digitado no
 * cadastro. Sem teto, "reenviar" vira ferramenta de flood contra uma caixa de entrada alheia, e o
 * domínio remetente paga a conta em reputação.
 */
export async function checkEmailVerificationSendRateLimit(
  ipHash: string,
  userId: string,
): Promise<void> {
  await checkLimit(`email-verification-send:ip:${ipHash}`, 10);
  await checkLimit(`email-verification-send:user:${userId}`, 5);
}

/**
 * Teto de conferência, somado ao contador por código.
 *
 * `attempts` na linha limita quem ataca um código; este limita quem pede código novo a cada
 * punhado de palpites e assim nunca esgota o contador de nenhum deles.
 */
export async function checkEmailVerificationConfirmRateLimit(ipHash: string): Promise<void> {
  await checkLimit(`email-verification-confirm:ip:${ipHash}`, 20);
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
