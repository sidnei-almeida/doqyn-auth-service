import { randomBytes, randomInt } from 'node:crypto';

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

/**
 * Os 6 dígitos que a pessoa digita.
 *
 * `randomInt` e não `Math.random()`: o código é um segredo, e o gerador previsível entregaria a
 * sequência inteira a quem observasse alguns valores. O `padStart` é o que faz `000042` valer —
 * sem ele o espaço cairia de 10^6 para 900 mil e os códigos baixos nunca sairiam.
 */
export function generateEmailVerificationCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function generateInviteToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function generateEmailChangeToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}
