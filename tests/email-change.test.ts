import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';
import { decryptField, hashEmailChangeToken } from '../src/security/crypto.js';
import { getSessionCookieName } from '../src/security/cookies.js';
import { loginUser, setupAdminUser } from './helpers.js';
import { TEST_ENV } from './setup.js';

const cookieName = getSessionCookieName();

async function loginAsAdmin(
  app: FastifyInstance,
  email: string,
  tenantId: string,
): Promise<{ cookie: string; userId: string; membershipId: string }> {
  const { membership, user } = await setupAdminUser(email, 'senha-segura-123', tenantId, [
    'company_admin',
  ]);
  const { token } = await loginUser(app, email, 'senha-segura-123', cookieName);
  const cookie = `${cookieName}=${token}`;
  await app.inject({
    method: 'POST',
    url: '/auth/select-tenant',
    headers: { cookie },
    payload: { membershipId: membership.id },
  });
  return { cookie, userId: user.id, membershipId: membership.id };
}

describe('email change', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    Object.assign(process.env, {
      ...TEST_ENV,
      EMAIL_ENABLED: 'false',
      EMAIL_CHANGE_ENABLED: 'true',
    });
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('solicita troca de e-mail com senha válida', async () => {
    const { cookie } = await loginAsAdmin(app, 'placeholder@demo.test', 'tenant_email_change');

    const response = await app.inject({
      method: 'POST',
      url: '/auth/account/email-change/request',
      headers: { cookie },
      payload: {
        newEmail: 'admin@empresa.test',
        password: 'senha-segura-123',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.pendingEmail).toBe('admin@empresa.test');
    expect(body.confirmToken).toBeTruthy();
  });

  it('confirma troca de e-mail via token', async () => {
    const { cookie, userId } = await loginAsAdmin(
      app,
      'confirm.placeholder@demo.test',
      'tenant_email_change_confirm',
    );

    const request = await app.inject({
      method: 'POST',
      url: '/auth/account/email-change/request',
      headers: { cookie },
      payload: {
        newEmail: 'confirmado@empresa.test',
        password: 'senha-segura-123',
      },
    });
    const confirmToken = request.json().confirmToken as string;

    const response = await app.inject({
      method: 'POST',
      url: `/auth/account/email-change/${confirmToken}/confirm`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().user.email).toBe('confirmado@empresa.test');

    const user = await prisma.authUser.findUnique({ where: { id: userId } });
    expect(user?.emailVerified).toBe(true);
    expect(decryptField(user!.emailEncrypted)).toBe('confirmado@empresa.test');
  });

  it('rejeita confirmar token duas vezes', async () => {
    const { cookie } = await loginAsAdmin(
      app,
      'duplo.placeholder@demo.test',
      'tenant_email_change_duplo',
    );

    const request = await app.inject({
      method: 'POST',
      url: '/auth/account/email-change/request',
      headers: { cookie },
      payload: {
        newEmail: 'duplo@empresa.test',
        password: 'senha-segura-123',
      },
    });
    const confirmToken = request.json().confirmToken as string;

    await app.inject({
      method: 'POST',
      url: `/auth/account/email-change/${confirmToken}/confirm`,
    });

    const response = await app.inject({
      method: 'POST',
      url: `/auth/account/email-change/${confirmToken}/confirm`,
    });

    expect(response.statusCode).toBe(410);
    expect(response.json().code).toBe('EMAIL_CHANGE_ALREADY_USED');
  });

  it('rejeita token expirado', async () => {
    const { cookie } = await loginAsAdmin(
      app,
      'expirado.placeholder@demo.test',
      'tenant_email_change_exp',
    );

    const request = await app.inject({
      method: 'POST',
      url: '/auth/account/email-change/request',
      headers: { cookie },
      payload: {
        newEmail: 'expirado@empresa.test',
        password: 'senha-segura-123',
      },
    });
    const token = request.json().confirmToken as string;
    await prisma.authEmailChange.update({
      where: { tokenHash: hashEmailChangeToken(token) },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const preview = await app.inject({
      method: 'GET',
      url: `/auth/account/email-change/${token}`,
    });
    expect(preview.statusCode).toBe(410);
    expect(preview.json().code).toBe('EMAIL_CHANGE_EXPIRED');
  });
});
