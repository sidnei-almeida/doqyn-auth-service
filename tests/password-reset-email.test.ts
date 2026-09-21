import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';
import { resetEnvCache } from '../src/config/env.js';
import { createOrGetUser } from '../src/modules/users/users.service.js';
import { deliverPasswordResetEmail } from '../src/modules/password-reset/passwordReset.service.js';
import { drainEmailOutbox } from '../src/modules/email/emailOutboxDrain.js';
import { TEST_ENV } from './setup.js';

/**
 * O gate real (`isPlatformEmailConfigured()`) só fica verdadeiro com Resend ou SMTP de
 * plataforma configurados — e nesse caso `sendEmail` sai direto para `sendViaResend`/
 * `sendViaSmtp`, sem passar pelo `EmailSender` injetável de teste. Para exercitar o caminho
 * real (e não só o console de desenvolvimento), a suíte liga a Resend com uma chave falsa e
 * troca o `fetch` global — a mesma função que `resendEmailSender.ts` já usa, sem lib nova.
 */
function enableResend() {
  process.env.EMAIL_ENABLED = 'true';
  process.env.EMAIL_PROVIDER = 'resend';
  process.env.RESEND_API_KEY = 'test-resend-key';
  resetEnvCache();
}

describe('e-mail de redefinição de senha', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.EMAIL_ENABLED;
    delete process.env.EMAIL_PROVIDER;
    delete process.env.RESEND_API_KEY;
    resetEnvCache();
  });

  it('endereço existente e endereço inexistente devolvem a mesma mensagem e o mesmo formato', async () => {
    await createOrGetUser({ email: 'existe-reset@empresa.com', temporaryPassword: 'senha-segura-123' });

    const existing = await app.inject({
      method: 'POST',
      url: '/auth/request-password-reset',
      payload: { email: 'existe-reset@empresa.com' },
    });
    const missing = await app.inject({
      method: 'POST',
      url: '/auth/request-password-reset',
      payload: { email: 'nao-existe-reset@empresa.com' },
    });

    expect(existing.statusCode).toBe(200);
    expect(missing.statusCode).toBe(200);
    // Fora de produção o `resetToken` é ecoado só para quem existe (atalho de dev/teste,
    // T-tzx-03) — por isso a comparação de forma-idêntica roda em produção, no teste abaixo.
    expect(existing.json().message).toBe(missing.json().message);
  });

  it('em produção, nenhuma resposta ecoa o token — mesmo para endereço existente', async () => {
    process.env.NODE_ENV = 'production';
    resetEnvCache();

    try {
      await createOrGetUser({
        email: 'existe-reset-prod@empresa.com',
        temporaryPassword: 'senha-segura-123',
      });

      const existing = await app.inject({
        method: 'POST',
        url: '/auth/request-password-reset',
        payload: { email: 'existe-reset-prod@empresa.com' },
      });
      const missing = await app.inject({
        method: 'POST',
        url: '/auth/request-password-reset',
        payload: { email: 'nao-existe-reset-prod@empresa.com' },
      });

      expect(existing.statusCode).toBe(200);
      expect(missing.statusCode).toBe(200);
      expect(existing.json()).toEqual(missing.json());
      expect(Object.keys(existing.json()).sort()).toEqual(['message', 'ok']);
    } finally {
      process.env.NODE_ENV = 'test';
      resetEnvCache();
    }
  });

  it('deliverPasswordResetEmail manda pelo caminho de plataforma e devolve true', async () => {
    enableResend();
    const fetchSpy = vi.fn(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    const user = await createOrGetUser({
      email: 'entrega-reset@empresa.com',
      temporaryPassword: 'senha-segura-123',
    });

    const { emailSent, token } = await deliverPasswordResetEmail({ userId: user.id });

    expect(emailSent).toBe(true);
    expect(token).toBeDefined();
    // Enfileirar não manda nada na hora — o drenador ainda nem rodou.
    expect(fetchSpy).toHaveBeenCalledTimes(0);

    const gravado = await prisma.authPasswordReset.findFirst({ where: { userId: user.id } });
    expect(gravado).not.toBeNull();

    const audit = await prisma.authAuditLog.findFirst({
      where: { userId: user.id, action: 'password.reset_requested' },
    });
    expect(audit?.metadata).toMatchObject({ emailSent: true });

    await drainEmailOutbox();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const requestInit = fetchSpy.mock.calls[0]?.[1] as { body: string };
    const payload = JSON.parse(requestInit.body);
    // O token do link é o mesmo que a entrega devolveu, e é o mesmo que foi gravado: sem isto o
    // e-mail poderia levar um token que o banco não reconhece.
    expect(payload.html).toContain(`/reset-password/${token}`);
    expect(payload.text).toContain(`/reset-password/${token}`);
  });

  it('com o envio recusado pelo provedor, a linha do outbox vira failed com motivo mascarado', async () => {
    enableResend();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            '{"message":"Invalid `to` field: falha-reset@empresa.com"}',
            { status: 422 },
          ),
      ),
    );

    const user = await createOrGetUser({
      email: 'falha-reset@empresa.com',
      temporaryPassword: 'senha-segura-123',
    });

    const { emailSent } = await deliverPasswordResetEmail({ userId: user.id });

    // A entrega só enfileirou — não sabe ainda que o provedor vai recusar.
    expect(emailSent).toBe(true);

    const audit = await prisma.authAuditLog.findFirst({
      where: { userId: user.id, action: 'password.reset_requested' },
    });
    expect(audit).not.toBeNull();
    expect((audit?.metadata as Record<string, unknown>)?.emailSent).toBe(true);
    expect((audit?.metadata as Record<string, unknown>)?.failureReason).toBeUndefined();

    await drainEmailOutbox();

    const linha = await prisma.authEmailOutbox.findFirst({
      where: { userId: user.id, purpose: 'password_reset' },
    });
    expect(linha?.status).toBe('failed');
    const failureReason = linha?.failureReason ?? '';
    expect(failureReason).not.toContain('falha-reset@empresa.com');
    // O endereço tem que aparecer mascarado: provar só a ausência do original deixaria o teste
    // passar com o mascaramento apagado, desde que o erro nunca citasse o destinatário.
    expect(failureReason).toContain('fa***@empresa.com');
  });

  it('o endpoint liga na entrega: pedir pela rota cria o token daquele usuário e manda o e-mail', async () => {
    // A lacuna que este caso fecha: os outros chamam `deliverPasswordResetEmail` direto, e os que
    // batem na rota rodavam com e-mail desligado. Entre os dois, ninguém provava que
    // `handlePasswordResetRequest` passa o usuário certo para a entrega — trocar os argumentos na
    // chamada deixava a suíte inteira verde.
    enableResend();
    const fetchSpy = vi.fn(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    const user = await createOrGetUser({
      email: 'ponta-a-ponta@empresa.com',
      temporaryPassword: 'senha-segura-123',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/request-password-reset',
      payload: { email: 'ponta-a-ponta@empresa.com' },
    });

    expect(response.statusCode).toBe(200);
    // Fora de produção a rota espera a entrega, então o token já existe quando ela responde.
    const { resetToken } = response.json() as { resetToken?: string };
    expect(resetToken).toBeDefined();

    await drainEmailOutbox();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const requestInit = fetchSpy.mock.calls[0]?.[1] as { body: string };
    const payload = JSON.parse(requestInit.body);
    expect(payload.to).toEqual(['ponta-a-ponta@empresa.com']);
    expect(payload.html).toContain(`/reset-password/${resetToken}`);

    const gravado = await prisma.authPasswordReset.findFirst({ where: { userId: user.id } });
    expect(gravado).not.toBeNull();
  });
  it('sem AUTH_DEV_ECHO_TOKENS a resposta tem a mesma forma para conta que existe e que não existe', async () => {
    // O eco é o último lugar onde a resposta ainda distinguia os dois casos. Preso a
    // NODE_ENV, um staging não carimbado como produção ligava esse oráculo por descuido.
    process.env.AUTH_DEV_ECHO_TOKENS = 'false';
    resetEnvCache();

    try {
      await createOrGetUser({
        email: 'sem-eco@empresa.com',
        temporaryPassword: 'senha-segura-123',
      });

      const existe = await app.inject({
        method: 'POST',
        url: '/auth/request-password-reset',
        payload: { email: 'sem-eco@empresa.com' },
      });
      const naoExiste = await app.inject({
        method: 'POST',
        url: '/auth/request-password-reset',
        payload: { email: 'ninguem-aqui@empresa.com' },
      });

      expect(existe.statusCode).toBe(200);
      expect(naoExiste.statusCode).toBe(200);
      expect(existe.json()).toEqual(naoExiste.json());
      expect(Object.keys(existe.json()).sort()).toEqual(['message', 'ok']);
    } finally {
      process.env.AUTH_DEV_ECHO_TOKENS = 'true';
      resetEnvCache();
    }
  });
});
