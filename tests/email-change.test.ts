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
    // O link tem prazo próprio, separado do código: vencer o do código não vence o dele.
    await prisma.authEmailChange.update({
      where: { tokenHash: hashEmailChangeToken(token) },
      data: { tokenExpiresAt: new Date(Date.now() - 60_000) },
    });

    const preview = await app.inject({
      method: 'GET',
      url: `/auth/account/email-change/${token}`,
    });
    expect(preview.statusCode).toBe(410);
    expect(preview.json().code).toBe('EMAIL_CHANGE_EXPIRED');
  });

  it('confirma a troca digitando o código', async () => {
    const { cookie, userId } = await loginAsAdmin(
      app,
      'codigo.placeholder@demo.test',
      'tenant_email_change_code',
    );

    const request = await app.inject({
      method: 'POST',
      url: '/auth/account/email-change/request',
      headers: { cookie },
      payload: { newEmail: 'codigo@empresa.test', password: 'senha-segura-123' },
    });
    const code = request.json().confirmCode as string;
    expect(code).toMatch(/^\d{6}$/);

    const confirmed = await app.inject({
      method: 'POST',
      url: '/auth/account/email-change/confirm',
      headers: { cookie },
      payload: { code: `${code.slice(0, 3)} ${code.slice(3)}` },
    });
    expect(confirmed.statusCode).toBe(200);

    const user = await prisma.authUser.findUnique({ where: { id: userId } });
    expect(decryptField(user!.emailEncrypted)).toBe('codigo@empresa.test');
  });

  it('bloqueia o código da troca depois do teto de tentativas', async () => {
    const { cookie, userId } = await loginAsAdmin(
      app,
      'tentativas.placeholder@demo.test',
      'tenant_email_change_attempts',
    );

    const request = await app.inject({
      method: 'POST',
      url: '/auth/account/email-change/request',
      headers: { cookie },
      payload: { newEmail: 'tentativas@empresa.test', password: 'senha-segura-123' },
    });
    const code = request.json().confirmCode as string;
    const wrong = code === '000000' ? '111111' : '000000';
    const max = Number(process.env.EMAIL_CHANGE_MAX_ATTEMPTS ?? 5);

    for (let i = 0; i < max; i += 1) {
      const attempt = await app.inject({
        method: 'POST',
        url: '/auth/account/email-change/confirm',
        headers: { cookie },
        payload: { code: wrong },
      });
      expect(attempt.json().code).toBe('EMAIL_CHANGE_INVALID_CODE');
    }

    const afterLimit = await app.inject({
      method: 'POST',
      url: '/auth/account/email-change/confirm',
      headers: { cookie },
      payload: { code },
    });
    expect(afterLimit.json().code).toBe('EMAIL_CHANGE_TOO_MANY_ATTEMPTS');

    const user = await prisma.authUser.findUnique({ where: { id: userId } });
    expect(decryptField(user!.emailEncrypted)).not.toBe('tentativas@empresa.test');
  });

  it('recusa reenvio antes do intervalo mínimo, e emite código novo depois', async () => {
    const { cookie, userId } = await loginAsAdmin(
      app,
      'reenvio.placeholder@demo.test',
      'tenant_email_change_resend',
    );

    const request = await app.inject({
      method: 'POST',
      url: '/auth/account/email-change/request',
      headers: { cookie },
      payload: { newEmail: 'reenvio@empresa.test', password: 'senha-segura-123' },
    });
    const first = request.json().confirmCode as string;

    const tooSoon = await app.inject({
      method: 'POST',
      url: '/auth/account/email-change/resend',
      headers: { cookie },
      payload: {},
    });
    expect(tooSoon.json().code).toBe('EMAIL_CHANGE_RESEND_TOO_SOON');

    // O intervalo é medido a partir de `sentAt`; recuá-lo simula o tempo passando.
    await prisma.authEmailChange.updateMany({
      where: { userId },
      data: { sentAt: new Date(Date.now() - 10 * 60 * 1000) },
    });

    const resent = await app.inject({
      method: 'POST',
      url: '/auth/account/email-change/resend',
      headers: { cookie },
      payload: {},
    });
    expect(resent.statusCode).toBe(200);
    const second = resent.json().confirmCode as string;

    // O código anterior morreu junto com a linha que o guardava.
    const stale = await app.inject({
      method: 'POST',
      url: '/auth/account/email-change/confirm',
      headers: { cookie },
      payload: { code: first },
    });
    expect(stale.json().code).toBe('EMAIL_CHANGE_INVALID_CODE');

    const fresh = await app.inject({
      method: 'POST',
      url: '/auth/account/email-change/confirm',
      headers: { cookie },
      payload: { code: second },
    });
    expect(fresh.statusCode).toBe(200);
  });

  it('o link sobrevive ao vencimento do código', async () => {
    const { cookie } = await loginAsAdmin(
      app,
      'sobrevive.placeholder@demo.test',
      'tenant_email_change_survive',
    );

    const request = await app.inject({
      method: 'POST',
      url: '/auth/account/email-change/request',
      headers: { cookie },
      payload: { newEmail: 'sobrevive@empresa.test', password: 'senha-segura-123' },
    });
    const token = request.json().confirmToken as string;

    // Só o código vence. É o caso de quem lê o e-mail horas depois no celular.
    await prisma.authEmailChange.update({
      where: { tokenHash: hashEmailChangeToken(token) },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const confirmed = await app.inject({
      method: 'POST',
      url: `/auth/account/email-change/${token}/confirm`,
    });
    expect(confirmed.statusCode).toBe(200);
  });
});
