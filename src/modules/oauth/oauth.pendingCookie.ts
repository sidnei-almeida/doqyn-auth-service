import type { FastifyReply, FastifyRequest } from 'fastify';
import { decryptField, encryptField } from '../../security/crypto.js';
import type { OAuthPendingPayload } from './oauth.types.js';

export const OAUTH_PENDING_COOKIE = 'doqyn_oauth_pending';
const OAUTH_PENDING_TTL_SECONDS = 600;

export type { OAuthPendingPayload };

export function setOAuthPendingCookie(
  reply: FastifyReply,
  payload: OAuthPendingPayload,
): void {
  const encrypted = encryptField(JSON.stringify(payload));
  reply.setCookie(OAUTH_PENDING_COOKIE, encrypted, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true',
    sameSite: (process.env.COOKIE_SAME_SITE as 'lax' | 'strict' | 'none' | undefined) ?? 'lax',
    path: '/',
    maxAge: OAUTH_PENDING_TTL_SECONDS,
  });
}

export function readOAuthPendingCookie(request: FastifyRequest): OAuthPendingPayload | null {
  const raw = request.cookies[OAUTH_PENDING_COOKIE];
  if (!raw) return null;

  try {
    const parsed = JSON.parse(decryptField(raw)) as OAuthPendingPayload;
    if (!parsed?.provider || !parsed.state || !parsed.nonce || !parsed.codeVerifier) {
      return null;
    }

    const ageMs = Date.now() - (parsed.createdAt ?? 0);
    if (ageMs > OAUTH_PENDING_TTL_SECONDS * 1000) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function clearOAuthPendingCookie(reply: FastifyReply): void {
  reply.clearCookie(OAUTH_PENDING_COOKIE, {
    httpOnly: true,
    path: '/',
  });
}
