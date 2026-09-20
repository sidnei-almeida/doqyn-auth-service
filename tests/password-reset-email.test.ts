import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';
import { resetEnvCache } from '../src/config/env.js';
import { createOrGetUser } from '../src/modules/users/users.service.js';
import { deliverPasswordResetEmail } from '../src/modules/password-reset/passwordReset.service.js';
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

    const sent = await deliverPasswordResetEmail({
      userId: user.id,
      token: 'token-de-teste-abc123',
      email: 'entrega-reset@empresa.com',
      locale: 'pt-BR',
    });

    expect(sent).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const requestInit = fetchSpy.mock.calls[0]?.[1] as { body: string };
    const payload = JSON.parse(requestInit.body);
    expect(payload.html).toContain('/reset-password/token-de-teste-abc123');
    expect(payload.text).toContain('/reset-password/token-de-teste-abc123');

    const audit = await prisma.authAuditLog.findFirst({
      where: { userId: user.id, action: 'password.reset_requested' },
    });
    expect(audit?.metadata).toMatchObject({ emailSent: true });
  });

  it('com o envio recusado pelo provedor, devolve false e mesmo assim grava a auditoria', async () => {
    enableResend();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"message":"Invalid `to` field: falha-reset@empresa.com"}', { status: 422 })),
    );

    const user = await createOrGetUser({
      email: 'falha-reset@empresa.com',
      temporaryPassword: 'senha-segura-123',
    });

    const sent = await deliverPasswordResetEmail({
      userId: user.id,
      token: 'token-de-teste-falha',
      email: 'falha-reset@empresa.com',
      locale: 'pt-BR',
    });

    expect(sent).toBe(false);

    const audit = await prisma.authAuditLog.findFirst({
      where: { userId: user.id, action: 'password.reset_requested' },
    });
    expect(audit).not.toBeNull();
    expect((audit?.metadata as Record<string, unknown>)?.emailSent).toBe(false);
    const failureReason = (audit?.metadata as Record<string, unknown>)?.failureReason as string;
    expect(failureReason).toBeDefined();
    expect(failureReason).not.toContain('falha-reset@empresa.com');
    // O endereço tem que aparecer mascarado: provar só a ausência do original deixaria o teste
    // passar com o mascaramento apagado, desde que o erro nunca citasse o destinatário.
    expect(failureReason).toContain('fa***@empresa.com');
  });
});
