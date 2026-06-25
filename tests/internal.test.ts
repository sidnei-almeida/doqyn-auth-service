import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { getSessionCookieName } from '../src/security/cookies.js';
import { createOrGetUser } from '../src/modules/users/users.service.js';
import { TEST_ENV } from './setup.js';

const INTERNAL_KEY = TEST_ENV.DOQYN_INTERNAL_API_KEY;

function authHeader(): Record<string, string> {
  return { authorization: `Bearer ${INTERNAL_KEY}` };
}

function extractCookie(setCookie: string | string[] | undefined): string {
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const cookieName = getSessionCookieName();
  const match = raw?.match(new RegExp(`${cookieName}=([^;]+)`));
  return match?.[1] ?? '';
}

describe('internal endpoints', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('sem DOQYN_INTERNAL_API_KEY retorna 403', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/users',
      payload: { email: 'internal@empresa.com' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('com DOQYN_INTERNAL_API_KEY funciona', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/users',
      headers: authHeader(),
      payload: {
        email: 'internal@empresa.com',
        firstName: 'Internal',
        temporaryPassword: 'senha-segura-123',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().user.email).toBe('internal@empresa.com');
  });

  it('/internal/sessions/verify valida sessão', async () => {
    await createOrGetUser({
      email: 'verify@empresa.com',
      temporaryPassword: 'senha-segura-123',
    });

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'verify@empresa.com',
        password: 'senha-segura-123',
      },
    });

    const sessionToken = extractCookie(loginResponse.headers['set-cookie']);

    const verifyResponse = await app.inject({
      method: 'POST',
      url: '/internal/sessions/verify',
      headers: authHeader(),
      payload: { sessionToken },
    });

    expect(verifyResponse.statusCode).toBe(200);
    expect(verifyResponse.json().ok).toBe(true);
    expect(verifyResponse.json().user.email).toBe('verify@empresa.com');
    expect(verifyResponse.json()).toHaveProperty('activeMembership');
    expect(verifyResponse.json()).toHaveProperty('memberships');
  });

  it('/internal/users cria ou reutiliza usuário', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/internal/users',
      headers: authHeader(),
      payload: {
        email: 'reuse-internal@empresa.com',
        temporaryPassword: 'senha-segura-123',
      },
    });

    const second = await app.inject({
      method: 'POST',
      url: '/internal/users',
      headers: authHeader(),
      payload: {
        email: 'reuse-internal@empresa.com',
        temporaryPassword: 'outra-senha-123',
      },
    });

    expect(first.json().user.id).toBe(second.json().user.id);
  });
});
