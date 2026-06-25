import type { FastifyReply } from 'fastify';
import { loadEnv } from '../config/env.js';

export interface CookieOptions {
  maxAgeSeconds: number;
}

export function setSessionCookie(
  reply: FastifyReply,
  token: string,
  options: CookieOptions,
): void {
  const env = loadEnv();
  const cookieOptions: {
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'strict' | 'lax' | 'none';
    path: string;
    maxAge: number;
    domain?: string;
  } = {
    httpOnly: true,
    secure: env.COOKIE_SECURE || env.NODE_ENV === 'production',
    sameSite: env.COOKIE_SAME_SITE,
    path: '/',
    maxAge: options.maxAgeSeconds,
  };

  if (env.COOKIE_DOMAIN) {
    cookieOptions.domain = env.COOKIE_DOMAIN;
  }

  reply.setCookie(env.SESSION_COOKIE_NAME, token, cookieOptions);
}

export function clearSessionCookie(reply: FastifyReply): void {
  const env = loadEnv();
  const cookieOptions: {
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'strict' | 'lax' | 'none';
    path: string;
    maxAge: number;
    domain?: string;
  } = {
    httpOnly: true,
    secure: env.COOKIE_SECURE || env.NODE_ENV === 'production',
    sameSite: env.COOKIE_SAME_SITE,
    path: '/',
    maxAge: 0,
  };

  if (env.COOKIE_DOMAIN) {
    cookieOptions.domain = env.COOKIE_DOMAIN;
  }

  reply.clearCookie(env.SESSION_COOKIE_NAME, cookieOptions);
}

export function getSessionCookieName(): string {
  return loadEnv().SESSION_COOKIE_NAME;
}

export function getSessionTtlSeconds(): number {
  const env = loadEnv();
  return env.SESSION_TTL_DAYS * 24 * 60 * 60;
}
