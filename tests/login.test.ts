import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';
import { getSessionCookieName } from '../src/security/cookies.js';
import { createOrGetUser } from '../src/modules/users/users.service.js';
import { disableUser } from '../src/modules/users/users.service.js';
import { createTestMembership, createTestTenant } from './helpers.js';
import { TEST_ENV } from './setup.js';

describe('login', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('login com senha correta cria sessão', async () => {
    const user = await createOrGetUser({
      email: 'login@empresa.com',
      temporaryPassword: 'senha-segura-123',
    });
    const tenant = await createTestTenant('tenant_login_ok');
    await createTestMembership(user.id, tenant.id, 'active');

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'login@empresa.com',
        password: 'senha-segura-123',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.user.email).toBe('login@empresa.com');

    const cookieName = getSessionCookieName();
    const setCookie = response.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    expect(String(setCookie)).toContain(`${cookieName}=`);

    const sessions = await prisma.authSession.count();
    expect(sessions).toBe(1);
  });

  it('login com senha errada falha', async () => {
    await createOrGetUser({
      email: 'errado@empresa.com',
      temporaryPassword: 'senha-segura-123',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'errado@empresa.com',
        password: 'senha-errada',
      },
    });

    expect(response.statusCode).toBe(401);
    const body = response.json();
    expect(body.message).toBe('E-mail ou senha inválidos.');
    expect(body.code).toBe('INVALID_CREDENTIALS');
  });

  it('usuário disabled não loga', async () => {
    const user = await createOrGetUser({
      email: 'disabled@empresa.com',
      temporaryPassword: 'senha-segura-123',
    });
    await disableUser(user.id);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'disabled@empresa.com',
        password: 'senha-segura-123',
      },
    });

    expect(response.statusCode).toBe(403);
    const body = response.json();
    expect(body.code).toBe('USER_DISABLED');
    expect(body.message).toMatch(/desativada/i);
  });

  it('resposta não expõe hash/encrypted', async () => {
    await createOrGetUser({
      email: 'expose@empresa.com',
      temporaryPassword: 'senha-segura-123',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'expose@empresa.com',
        password: 'senha-segura-123',
      },
    });

    const serialized = JSON.stringify(response.json());
    expect(serialized).not.toContain('passwordHash');
    expect(serialized).not.toContain('Encrypted');
    expect(serialized).not.toContain('LookupHash');
  });

  it('auth_login_attempts registra tentativa', async () => {
    await createOrGetUser({
      email: 'attempt@empresa.com',
      temporaryPassword: 'senha-segura-123',
    });

    await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'attempt@empresa.com',
        password: 'senha-errada',
      },
    });

    const attempts = await prisma.authLoginAttempt.findMany();
    expect(attempts.length).toBeGreaterThan(0);
    expect(attempts[0]?.success).toBe(false);
  });
});
