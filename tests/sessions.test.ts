import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';
import { getSessionCookieName } from '../src/security/cookies.js';
import { hashSessionToken } from '../src/security/crypto.js';
import { createOrGetUser } from '../src/modules/users/users.service.js';
import { TEST_ENV } from './setup.js';

function extractCookie(setCookie: string | string[] | undefined): string {
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const cookieName = getSessionCookieName();
  const match = raw?.match(new RegExp(`${cookieName}=([^;]+)`));
  return match?.[1] ?? '';
}

describe('sessions', () => {
  let app: FastifyInstance;
  const cookieName = getSessionCookieName();

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  async function loginAndGetCookie(): Promise<string> {
    await createOrGetUser({
      email: 'session@empresa.com',
      temporaryPassword: 'senha-segura-123',
    });

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'session@empresa.com',
        password: 'senha-segura-123',
      },
    });

    return extractCookie(loginResponse.headers['set-cookie']);
  }

  it('/auth/session valida sessão', async () => {
    const token = await loginAndGetCookie();

    const response = await app.inject({
      method: 'GET',
      url: '/auth/session',
      headers: {
        cookie: `${cookieName}=${token}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.user.email).toBe('session@empresa.com');
    expect(body).toHaveProperty('memberships');
    expect(body).toHaveProperty('activeMembership');
  });

  it('logout revoga sessão', async () => {
    const token = await loginAndGetCookie();

    const logoutResponse = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: {
        cookie: `${cookieName}=${token}`,
      },
    });

    expect(logoutResponse.statusCode).toBe(200);

    const sessionResponse = await app.inject({
      method: 'GET',
      url: '/auth/session',
      headers: {
        cookie: `${cookieName}=${token}`,
      },
    });

    expect(sessionResponse.json().ok).toBe(false);
  });

  it('sessão revogada não valida', async () => {
    const token = await loginAndGetCookie();
    const tokenHash = hashSessionToken(token);

    await prisma.authSession.update({
      where: { sessionTokenHash: tokenHash },
      data: { revokedAt: new Date() },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/auth/session',
      headers: {
        cookie: `${cookieName}=${token}`,
      },
    });

    expect(response.json().ok).toBe(false);
  });

  it('sessão expirada não valida', async () => {
    const token = await loginAndGetCookie();
    const tokenHash = hashSessionToken(token);

    await prisma.authSession.update({
      where: { sessionTokenHash: tokenHash },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/auth/session',
      headers: {
        cookie: `${cookieName}=${token}`,
      },
    });

    expect(response.json().code).toBe('INVALID_SESSION');
  });

  it('session token não aparece cru no banco', async () => {
    const token = await loginAndGetCookie();

    const sessions = await prisma.authSession.findMany();
    const serialized = JSON.stringify(sessions);

    expect(serialized).not.toContain(token);
    expect(sessions[0]?.sessionTokenHash).toBe(hashSessionToken(token));
  });
});
