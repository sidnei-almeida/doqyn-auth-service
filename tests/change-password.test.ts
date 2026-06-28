import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';
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

describe('change password', () => {
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

  async function loginAndGetCookie(email: string, password: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password },
    });
    expect(response.statusCode).toBe(200);
    return extractCookie(response.headers['set-cookie']);
  }

  it('usuário logado troca senha com sucesso', async () => {
    const user = await createOrGetUser({
      email: 'changepw@empresa.com',
      temporaryPassword: 'senha-atual-123',
    });

    const cookie = await loginAndGetCookie('changepw@empresa.com', 'senha-atual-123');

    const response = await app.inject({
      method: 'POST',
      url: '/auth/change-password',
      headers: { cookie: `${cookieName}=${cookie}` },
      payload: {
        currentPassword: 'senha-atual-123',
        newPassword: 'nova-senha-456',
        confirmPassword: 'nova-senha-456',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.message).toContain('sucesso');
    expect(JSON.stringify(body)).not.toMatch(/senha-atual|nova-senha|passwordHash|\$argon2/);

    const credential = await getUserCredential(user.id);
    expect(await verifyPassword('nova-senha-456', credential!.passwordHash)).toBe(true);
  });

  it('usuário não logado recebe 401', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/change-password',
      payload: {
        currentPassword: 'a',
        newPassword: 'nova-senha-123',
        confirmPassword: 'nova-senha-123',
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('UNAUTHORIZED');
  });

  it('senha atual errada retorna erro controlado', async () => {
    await createOrGetUser({
      email: 'wrongcurrent@empresa.com',
      temporaryPassword: 'senha-atual-123',
    });
    const cookie = await loginAndGetCookie('wrongcurrent@empresa.com', 'senha-atual-123');

    const response = await app.inject({
      method: 'POST',
      url: '/auth/change-password',
      headers: { cookie: `${cookieName}=${cookie}` },
      payload: {
        currentPassword: 'senha-errada-999',
        newPassword: 'nova-senha-456',
        confirmPassword: 'nova-senha-456',
      },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.ok).toBe(false);
    expect(body.message).toBe('Senha atual incorreta.');
    expect(body.code).toBe('INVALID_CURRENT_PASSWORD');
    expect(JSON.stringify(body)).not.toContain('senha-errada');
  });

  it('confirmação diferente retorna erro de validação', async () => {
    await createOrGetUser({
      email: 'mismatch@empresa.com',
      temporaryPassword: 'senha-atual-123',
    });
    const cookie = await loginAndGetCookie('mismatch@empresa.com', 'senha-atual-123');

    const response = await app.inject({
      method: 'POST',
      url: '/auth/change-password',
      headers: { cookie: `${cookieName}=${cookie}` },
      payload: {
        currentPassword: 'senha-atual-123',
        newPassword: 'nova-senha-456',
        confirmPassword: 'outra-senha-789',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('VALIDATION_ERROR');
  });

  it('senha fraca é rejeitada', async () => {
    await createOrGetUser({
      email: 'weak@empresa.com',
      temporaryPassword: 'senha-atual-123',
    });
    const cookie = await loginAndGetCookie('weak@empresa.com', 'senha-atual-123');

    const response = await app.inject({
      method: 'POST',
      url: '/auth/change-password',
      headers: { cookie: `${cookieName}=${cookie}` },
      payload: {
        currentPassword: 'senha-atual-123',
        newPassword: '12345678',
        confirmPassword: '12345678',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('WEAK_PASSWORD');
  });

  it('nova senha igual à atual é rejeitada', async () => {
    await createOrGetUser({
      email: 'same@empresa.com',
      temporaryPassword: 'senha-atual-123',
    });
    const cookie = await loginAndGetCookie('same@empresa.com', 'senha-atual-123');

    const response = await app.inject({
      method: 'POST',
      url: '/auth/change-password',
      headers: { cookie: `${cookieName}=${cookie}` },
      payload: {
        currentPassword: 'senha-atual-123',
        newPassword: 'senha-atual-123',
        confirmPassword: 'senha-atual-123',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('PASSWORD_UNCHANGED');
  });

  it('após trocar senha, login com senha antiga falha e com nova funciona', async () => {
    await createOrGetUser({
      email: 'loginflow@empresa.com',
      temporaryPassword: 'senha-atual-123',
    });
    const cookie = await loginAndGetCookie('loginflow@empresa.com', 'senha-atual-123');

    await app.inject({
      method: 'POST',
      url: '/auth/change-password',
      headers: { cookie: `${cookieName}=${cookie}` },
      payload: {
        currentPassword: 'senha-atual-123',
        newPassword: 'nova-senha-456',
        confirmPassword: 'nova-senha-456',
      },
    });

    const oldLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'loginflow@empresa.com', password: 'senha-atual-123' },
    });
    expect(oldLogin.statusCode).toBe(401);

    const newLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'loginflow@empresa.com', password: 'nova-senha-456' },
    });
    expect(newLogin.statusCode).toBe(200);
  });

  it('revoga outras sessões e mantém a sessão atual', async () => {
    await createOrGetUser({
      email: 'multisession@empresa.com',
      temporaryPassword: 'senha-atual-123',
    });

    const cookieA = await loginAndGetCookie('multisession@empresa.com', 'senha-atual-123');
    const cookieB = await loginAndGetCookie('multisession@empresa.com', 'senha-atual-123');

    const changeResponse = await app.inject({
      method: 'POST',
      url: '/auth/change-password',
      headers: { cookie: `${cookieName}=${cookieA}` },
      payload: {
        currentPassword: 'senha-atual-123',
        newPassword: 'nova-senha-456',
        confirmPassword: 'nova-senha-456',
      },
    });

    expect(changeResponse.statusCode).toBe(200);
    expect(changeResponse.json().revokedOtherSessions).toBeGreaterThanOrEqual(1);

    const sessionA = await app.inject({
      method: 'GET',
      url: '/auth/session',
      headers: { cookie: `${cookieName}=${cookieA}` },
    });
    expect(sessionA.json().ok).toBe(true);

    const sessionB = await app.inject({
      method: 'GET',
      url: '/auth/session',
      headers: { cookie: `${cookieName}=${cookieB}` },
    });
    expect(sessionB.json().ok).toBe(false);
  });

  it('cria audit log password.updated sem payload sensível', async () => {
    await createOrGetUser({
      email: 'auditpw@empresa.com',
      temporaryPassword: 'senha-atual-123',
    });
    const cookie = await loginAndGetCookie('auditpw@empresa.com', 'senha-atual-123');

    await app.inject({
      method: 'POST',
      url: '/auth/change-password',
      headers: { cookie: `${cookieName}=${cookie}` },
      payload: {
        currentPassword: 'senha-atual-123',
        newPassword: 'nova-senha-456',
        confirmPassword: 'nova-senha-456',
      },
    });

    const logs = await prisma.authAuditLog.findMany({
      where: { action: 'password.updated' },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    expect(logs.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(logs[0]);
    expect(serialized).not.toMatch(/senha-atual|nova-senha|\$argon2|passwordHash/i);
  });
});
