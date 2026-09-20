import { describe, it, expect, afterEach, vi } from 'vitest';
import { prisma } from '../src/db/prisma.js';
import { resetEnvCache } from '../src/config/env.js';
import { encryptField, decryptField } from '../src/security/crypto.js';
import { enqueueEmail } from '../src/modules/email/emailOutbox.service.js';
import { drainEmailOutbox } from '../src/modules/email/emailOutboxDrain.js';
import { resetEmailSenderForTests } from '../src/modules/email/email.service.js';
import type { EmailMessage } from '../src/modules/email/email.types.js';

/**
 * Mesmo caminho real de `password-reset-email.test.ts`: `isPlatformEmailConfigured()` só fica
 * verdadeiro com Resend/SMTP de plataforma configurados, e é aí que `sendEmail` sai pelo
 * `fetch` global em vez do `EmailSender` injetável de teste.
 */
function enableResend() {
  process.env.EMAIL_ENABLED = 'true';
  process.env.EMAIL_PROVIDER = 'resend';
  process.env.RESEND_API_KEY = 'test-resend-key';
  resetEnvCache();
}

function buildMessage(to: string): EmailMessage {
  return {
    to,
    subject: 'Assunto de teste',
    html: '<p>codigo-secreto-123</p>',
    text: 'codigo-secreto-123',
    from: { name: 'DOQYN', email: 'noreply@doqyn.com.br' },
  };
}

describe('outbox de e-mail', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.EMAIL_ENABLED;
    delete process.env.EMAIL_PROVIDER;
    delete process.env.RESEND_API_KEY;
    resetEnvCache();
    resetEmailSenderForTests();
  });

  it('enqueueEmail grava linha decifrável quando a plataforma está configurada', async () => {
    enableResend();
    const message = buildMessage('destino-outbox@empresa.com');
    const result = await enqueueEmail({ userId: null, purpose: 'invite', message });

    expect(result.queued).toBe(true);
    expect(result.id).toBeDefined();

    const row = await prisma.authEmailOutbox.findUniqueOrThrow({ where: { id: result.id! } });
    expect(row.status).toBe('queued');
    expect(decryptField(row.toEncrypted)).toBe('destino-outbox@empresa.com');
    expect(row.html).toContain('codigo-secreto-123');
  });

  it('enqueueEmail não cria linha e usa o console quando a plataforma não está configurada', async () => {
    const fakeSender = { send: vi.fn(async () => {}) };
    resetEmailSenderForTests(fakeSender);

    const message = buildMessage('sem-plataforma@empresa.com');
    const result = await enqueueEmail({ userId: null, purpose: 'invite', message });

    expect(result.queued).toBe(false);
    expect(result.id).toBeUndefined();
    expect(fakeSender.send).toHaveBeenCalledTimes(1);

    const count = await prisma.authEmailOutbox.count();
    expect(count).toBe(0);
  });

  it('drena uma linha nova: envia, marca sent, guarda providerMessageId e limpa html/text', async () => {
    enableResend();
    const fetchSpy = vi.fn(
      async () => new Response(JSON.stringify({ id: 're_123' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const { id } = await enqueueEmail({
      userId: null,
      purpose: 'invite',
      message: buildMessage('drena@empresa.com'),
    });

    const resultado = await drainEmailOutbox();

    expect(resultado.sent).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const row = await prisma.authEmailOutbox.findUniqueOrThrow({ where: { id: id! } });
    expect(row.status).toBe('sent');
    expect(row.providerMessageId).toBe('re_123');
    expect(row.html).toBe('');
    expect(row.text).toBe('');
  });

  it('recusa transitória (500) incrementa tentativa e mantém queued; a quarta tentativa desiste', async () => {
    enableResend();
    const fetchSpy = vi.fn(async () => new Response('erro interno', { status: 500 }));
    vi.stubGlobal('fetch', fetchSpy);

    const { id } = await enqueueEmail({
      userId: null,
      purpose: 'invite',
      message: buildMessage('retentativa@empresa.com'),
    });

    let resultado = await drainEmailOutbox();
    expect(resultado.retried).toBe(1);

    let row = await prisma.authEmailOutbox.findUniqueOrThrow({ where: { id: id! } });
    expect(row.status).toBe('queued');
    expect(row.attempts).toBe(1);
    expect(row.nextAttemptAt).not.toBeNull();
    expect(row.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());

    // Força a linha para a beira do teto (a próxima recusa é a quarta tentativa) e drena de novo
    // com a mesma recusa transitória.
    await prisma.authEmailOutbox.update({
      where: { id: id! },
      data: { attempts: 3, nextAttemptAt: null },
    });

    resultado = await drainEmailOutbox();
    expect(resultado.failed).toBe(1);

    row = await prisma.authEmailOutbox.findUniqueOrThrow({ where: { id: id! } });
    expect(row.status).toBe('failed');
    expect(row.attempts).toBe(4);
    expect(row.html).toBe('');
    expect(row.text).toBe('');
    expect(row.failureReason).toBeDefined();
  });

  it('recusa definitiva (422) desiste já na primeira tentativa', async () => {
    enableResend();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"message":"invalido"}', { status: 422 })),
    );

    const { id } = await enqueueEmail({
      userId: null,
      purpose: 'invite',
      message: buildMessage('recusa-definitiva@empresa.com'),
    });

    const resultado = await drainEmailOutbox();
    expect(resultado.failed).toBe(1);
    expect(resultado.retried).toBe(0);

    const row = await prisma.authEmailOutbox.findUniqueOrThrow({ where: { id: id! } });
    expect(row.status).toBe('failed');
    expect(row.attempts).toBe(1);
    expect(row.html).toBe('');
  });

  it('duas drenagens concorrentes na mesma linha não mandam o e-mail duas vezes', async () => {
    enableResend();
    const fetchSpy = vi.fn(
      async () => new Response(JSON.stringify({ id: 're_concorrente' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    await enqueueEmail({
      userId: null,
      purpose: 'invite',
      message: buildMessage('concorrencia@empresa.com'),
    });

    const [a, b] = await Promise.all([drainEmailOutbox(), drainEmailOutbox()]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(a.sent + b.sent).toBe(1);
  });

  it('linha travada há mais de 5 minutos é reivindicada; uma travada há 1 minuto é deixada em paz', async () => {
    enableResend();
    const fetchSpy = vi.fn(
      async () => new Response(JSON.stringify({ id: 're_reclaim' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const expiredLock = await prisma.authEmailOutbox.create({
      data: {
        userId: null,
        purpose: 'invite',
        toEncrypted: encryptField('trava-expirada@empresa.com'),
        subject: 'Assunto',
        html: '<p>segredo</p>',
        text: 'segredo',
        status: 'sending',
        lockedAt: new Date(Date.now() - 6 * 60_000),
      },
    });
    const freshLock = await prisma.authEmailOutbox.create({
      data: {
        userId: null,
        purpose: 'invite',
        toEncrypted: encryptField('trava-fresca@empresa.com'),
        subject: 'Assunto',
        html: '<p>segredo</p>',
        text: 'segredo',
        status: 'sending',
        lockedAt: new Date(Date.now() - 60_000),
      },
    });

    const resultado = await drainEmailOutbox();

    expect(resultado.sent).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const reclaimed = await prisma.authEmailOutbox.findUniqueOrThrow({
      where: { id: expiredLock.id },
    });
    expect(reclaimed.status).toBe('sent');

    const untouched = await prisma.authEmailOutbox.findUniqueOrThrow({
      where: { id: freshLock.id },
    });
    expect(untouched.status).toBe('sending');
    expect(untouched.html).toBe('<p>segredo</p>');
  });

  it('a varredura de retenção zera html/text de linhas mais velhas que o TTL, mesmo sem drenagem pendente', async () => {
    // Sem plataforma configurada — a varredura roda de todo jeito, antes do retorno antecipado
    // de `drainEmailOutbox`.
    const old = await prisma.authEmailOutbox.create({
      data: {
        userId: null,
        purpose: 'password_reset',
        toEncrypted: encryptField('velho@empresa.com'),
        subject: 'Assunto',
        html: '<p>segredo-velho</p>',
        text: 'segredo-velho',
        status: 'failed',
        attempts: 4,
        createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000), // TTL de teste é 24h
      },
    });

    const resultado = await drainEmailOutbox();
    expect(resultado).toEqual({ sent: 0, failed: 0, retried: 0 });

    const row = await prisma.authEmailOutbox.findUniqueOrThrow({ where: { id: old.id } });
    expect(row.html).toBe('');
    expect(row.text).toBe('');
    // A trilha de auditoria continua intacta — só o corpo secreto é zerado.
    expect(row.status).toBe('failed');
    expect(row.attempts).toBe(4);
  });
});
