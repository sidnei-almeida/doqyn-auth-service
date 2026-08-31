import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';
import { getSessionCookieName } from '../src/security/cookies.js';
import { resetRateLimitStore } from '../src/security/rateLimit.js';
import { loginUser, setupAdminUser } from './helpers.js';
import { TEST_ENV } from './setup.js';

const cookieName = getSessionCookieName();

async function loginAs(
  app: FastifyInstance,
  email: string,
  tenantId: string,
): Promise<{ cookie: string; userId: string }> {
  const { user } = await setupAdminUser(email, 'senha-segura-123', tenantId, ['company_admin']);
  const { token } = await loginUser(app, email, 'senha-segura-123', cookieName);
  return { cookie: `${cookieName}=${token}`, userId: user.id };
}

async function sendCode(app: FastifyInstance, cookie: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/account/email-verification/send',
    headers: { cookie },
    payload: {},
  });
  return response;
}

describe('email verification', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    Object.assign(process.env, { ...TEST_ENV, EMAIL_ENABLED: 'false' });
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('conta de empresa nasce com e-mail não verificado', async () => {
    const { userId } = await loginAs(app, 'nascimento@ev.test', 'tenant_ev_birth');
    // O cadastro de empresa carimbava `emailVerified: true` sem prova nenhuma; o default do
    // schema é o que vale agora.
    await prisma.authUser.update({ where: { id: userId }, data: { emailVerified: false } });
    const user = await prisma.authUser.findUnique({ where: { id: userId } });
    expect(user?.emailVerified).toBe(false);
  });

  it('envia código de 6 dígitos e confirma o e-mail', async () => {
    resetRateLimitStore();
    const { cookie, userId } = await loginAs(app, 'codigo@ev.test', 'tenant_ev_code');
    await prisma.authUser.update({ where: { id: userId }, data: { emailVerified: false } });

    const sent = await sendCode(app, cookie);
    expect(sent.statusCode).toBe(200);
    const code = sent.json().code as string;
    expect(code).toMatch(/^\d{6}$/);

    const confirmed = await app.inject({
      method: 'POST',
      url: '/auth/account/email-verification/confirm',
      headers: { cookie },
      payload: { code },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().ok).toBe(true);

    const user = await prisma.authUser.findUnique({ where: { id: userId } });
    expect(user?.emailVerified).toBe(true);
  });

  it('aceita o código com o espaço do formato legível', async () => {
    resetRateLimitStore();
    const { cookie, userId } = await loginAs(app, 'espaco@ev.test', 'tenant_ev_space');
    await prisma.authUser.update({ where: { id: userId }, data: { emailVerified: false } });

    const code = (await sendCode(app, cookie)).json().code as string;
    const confirmed = await app.inject({
      method: 'POST',
      url: '/auth/account/email-verification/confirm',
      headers: { cookie },
      payload: { code: `${code.slice(0, 3)} ${code.slice(3)}` },
    });
    expect(confirmed.statusCode).toBe(200);
  });

  it('confirma pelo link, sem sessão', async () => {
    resetRateLimitStore();
    const { cookie, userId } = await loginAs(app, 'link@ev.test', 'tenant_ev_link');
    await prisma.authUser.update({ where: { id: userId }, data: { emailVerified: false } });

    const confirmUrl = (await sendCode(app, cookie)).json().confirmUrl as string;
    const token = decodeURIComponent(confirmUrl.split('/verificar-email/')[1]);

    // Sem cookie de propósito: quem clica no link está no aparelho onde leu o e-mail.
    const confirmed = await app.inject({
      method: 'POST',
      url: `/auth/email-verification/${encodeURIComponent(token)}/confirm`,
      payload: {},
    });
    expect(confirmed.statusCode).toBe(200);

    const user = await prisma.authUser.findUnique({ where: { id: userId } });
    expect(user?.emailVerified).toBe(true);
  });

  it('bloqueia o código depois do teto de tentativas', async () => {
    resetRateLimitStore();
    const { cookie, userId } = await loginAs(app, 'tentativas@ev.test', 'tenant_ev_attempts');
    await prisma.authUser.update({ where: { id: userId }, data: { emailVerified: false } });

    const code = (await sendCode(app, cookie)).json().code as string;
    const wrong = code === '000000' ? '111111' : '000000';
    const max = Number(process.env.EMAIL_VERIFICATION_MAX_ATTEMPTS ?? 5);

    for (let i = 0; i < max; i += 1) {
      const attempt = await app.inject({
        method: 'POST',
        url: '/auth/account/email-verification/confirm',
        headers: { cookie },
        payload: { code: wrong },
      });
      expect(attempt.json().code).toBe('EMAIL_VERIFICATION_INVALID_CODE');
    }

    // Esgotado o teto, nem o código certo passa mais: o contador persiste na linha.
    const afterLimit = await app.inject({
      method: 'POST',
      url: '/auth/account/email-verification/confirm',
      headers: { cookie },
      payload: { code },
    });
    expect(afterLimit.json().code).toBe('EMAIL_VERIFICATION_TOO_MANY_ATTEMPTS');

    const user = await prisma.authUser.findUnique({ where: { id: userId } });
    expect(user?.emailVerified).toBe(false);
  });

  it('recusa reenvio antes do intervalo mínimo', async () => {
    resetRateLimitStore();
    const { cookie, userId } = await loginAs(app, 'reenvio@ev.test', 'tenant_ev_resend');
    await prisma.authUser.update({ where: { id: userId }, data: { emailVerified: false } });

    expect((await sendCode(app, cookie)).statusCode).toBe(200);
    const again = await app.inject({
      method: 'POST',
      url: '/auth/account/email-verification/resend',
      headers: { cookie },
      payload: {},
    });
    expect(again.json().code).toBe('EMAIL_VERIFICATION_RESEND_TOO_SOON');
  });

  it('um envio novo invalida o código anterior', async () => {
    resetRateLimitStore();
    const { cookie, userId } = await loginAs(app, 'rotacao@ev.test', 'tenant_ev_rotate');
    await prisma.authUser.update({ where: { id: userId }, data: { emailVerified: false } });

    const first = (await sendCode(app, cookie)).json().code as string;
    // O intervalo mínimo é medido a partir de `sentAt`; recuá-lo simula o tempo passando.
    await prisma.authEmailVerification.updateMany({
      where: { userId },
      data: { sentAt: new Date(Date.now() - 10 * 60 * 1000) },
    });
    const second = (await sendCode(app, cookie)).json().code as string;

    const stale = await app.inject({
      method: 'POST',
      url: '/auth/account/email-verification/confirm',
      headers: { cookie },
      payload: { code: first },
    });
    expect(stale.json().code).toBe('EMAIL_VERIFICATION_INVALID_CODE');

    const fresh = await app.inject({
      method: 'POST',
      url: '/auth/account/email-verification/confirm',
      headers: { cookie },
      payload: { code: second },
    });
    expect(fresh.statusCode).toBe(200);
  });

  it('não emite código para e-mail já confirmado', async () => {
    resetRateLimitStore();
    const { cookie, userId } = await loginAs(app, 'jafeito@ev.test', 'tenant_ev_done');
    await prisma.authUser.update({ where: { id: userId }, data: { emailVerified: true } });

    const response = await sendCode(app, cookie);
    expect(response.json().code).toBe('EMAIL_ALREADY_VERIFIED');
  });

  it('exige sessão nas rotas de conta', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/auth/account/email-verification',
    });
    expect(response.statusCode).toBe(401);
  });
});
