import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';
import { hashPasswordResetToken } from '../src/security/crypto.js';
import { getSessionCookieName } from '../src/security/cookies.js';
import { verifyPassword } from '../src/security/password.js';
import { createOrGetUser, getUserCredential } from '../src/modules/users/users.service.js';
import { TEST_ENV } from './setup.js';

function extractCookie(setCookie: string | string[] | undefined): string {
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const cookieName = getSessionCookieName();
  const match = raw?.match(new RegExp(`${cookieName}=([^;]+)`));
  return match?.[1] ?? '';
}

describe('password reset', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('request-password-reset gera tokenHash', async () => {
    await createOrGetUser({
      email: 'reset@empresa.com',
      temporaryPassword: 'senha-segura-123',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/request-password-reset',
      payload: { email: 'reset@empresa.com' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.resetToken).toBeDefined();

    const resets = await prisma.authPasswordReset.findMany();
    expect(resets.length).toBe(1);
    expect(resets[0]?.tokenHash).toBe(hashPasswordResetToken(body.resetToken));
  });

  it('reset-password atualiza senha', async () => {
    const user = await createOrGetUser({
      email: 'newpass@empresa.com',
      temporaryPassword: 'senha-antiga-123',
    });

    const requestResponse = await app.inject({
      method: 'POST',
      url: '/auth/request-password-reset',
      payload: { email: 'newpass@empresa.com' },
    });

    const resetToken = requestResponse.json().resetToken;

    const resetResponse = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: {
        token: resetToken,
        newPassword: 'nova-senha-123',
      },
    });

    expect(resetResponse.statusCode).toBe(200);

    const credential = await getUserCredential(user.id);
    expect(credential).not.toBeNull();
    const valid = await verifyPassword('nova-senha-123', credential!.passwordHash);
    expect(valid).toBe(true);
  });

  it('token usado não pode ser reutilizado', async () => {
    await createOrGetUser({
      email: 'reuse@empresa.com',
      temporaryPassword: 'senha-antiga-123',
    });

    const requestResponse = await app.inject({
      method: 'POST',
      url: '/auth/request-password-reset',
      payload: { email: 'reuse@empresa.com' },
    });

    const resetToken = requestResponse.json().resetToken;

    await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: {
        token: resetToken,
        newPassword: 'nova-senha-123',
      },
    });

    const secondAttempt = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: {
        token: resetToken,
        newPassword: 'outra-senha-123',
      },
    });

    expect(secondAttempt.statusCode).toBe(400);
  });

  it('reset revoga sessões antigas', async () => {
    await createOrGetUser({
      email: 'revoke@empresa.com',
      temporaryPassword: 'senha-antiga-123',
    });

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'revoke@empresa.com',
        password: 'senha-antiga-123',
      },
    });

    const cookieName = getSessionCookieName();
    const token = extractCookie(loginResponse.headers['set-cookie']);

    const requestResponse = await app.inject({
      method: 'POST',
      url: '/auth/request-password-reset',
      payload: { email: 'revoke@empresa.com' },
    });

    await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: {
        token: requestResponse.json().resetToken,
        newPassword: 'nova-senha-123',
      },
    });

    const sessionResponse = await app.inject({
      method: 'GET',
      url: '/auth/session',
      headers: {
        cookie: `${cookieName}=${token}`,
      },
    });

    expect(sessionResponse.json().ok).toBe(false);
  });

  it('reset token não aparece cru no banco', async () => {
    await createOrGetUser({
      email: 'tokenhash@empresa.com',
      temporaryPassword: 'senha-antiga-123',
    });

    const requestResponse = await app.inject({
      method: 'POST',
      url: '/auth/request-password-reset',
      payload: { email: 'tokenhash@empresa.com' },
    });

    const resetToken = requestResponse.json().resetToken;
    const resets = await prisma.authPasswordReset.findMany();
    const serialized = JSON.stringify(resets);

    expect(serialized).not.toContain(resetToken);
  });
});
