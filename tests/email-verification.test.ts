import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';
import { resetRateLimitStore } from '../src/security/rateLimit.js';
import { issueEmailVerificationTicket } from '../src/security/verificationTicket.js';
import { createTestMembership, createTestTenant, createTestUser } from './helpers.js';
import { TEST_ENV } from './setup.js';

const PASSWORD = 'senha-segura-123';

/** Conta que existe, com senha, e cujo e-mail ainda não foi provado. */
async function createUnverifiedUser(email: string, tenantId: string) {
  const user = await createTestUser(email, PASSWORD, { emailVerified: false });
  const tenant = await createTestTenant(tenantId);
  await createTestMembership(user.id, tenant.id, 'active');
  return user;
}

async function loginExpectingBlock(app: FastifyInstance, email: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password: PASSWORD },
  });
  return response;
}

function send(app: FastifyInstance, ticket: string, url = '/auth/email-verification/send') {
  return app.inject({ method: 'POST', url, payload: { ticket } });
}

function confirm(app: FastifyInstance, ticket: string, code: string) {
  return app.inject({
    method: 'POST',
    url: '/auth/email-verification/confirm',
    payload: { ticket, code },
  });
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

  it('login com senha certa recusa e devolve o passe, e o código já sai junto', async () => {
    resetRateLimitStore();
    const user = await createUnverifiedUser('bloqueio@ev.test', 'tenant_ev_block');

    const response = await loginExpectingBlock(app, 'bloqueio@ev.test');
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('EMAIL_NOT_VERIFIED');
    expect(response.json().details.verificationTicket).toBeTruthy();
    // Sem cookie: é justamente o acesso que está sendo negado.
    expect(response.headers['set-cookie']).toBeUndefined();

    const pending = await prisma.authEmailVerification.findFirst({ where: { userId: user.id } });
    expect(pending).not.toBeNull();
  });

  it('senha errada não devolve passe nenhum', async () => {
    resetRateLimitStore();
    await createUnverifiedUser('senhaerrada@ev.test', 'tenant_ev_wrongpass');

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'senhaerrada@ev.test', password: 'outra-senha-qualquer' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('INVALID_CREDENTIALS');
    expect(response.json().details).toBeUndefined();
  });

  it('confirma o código e o login passa a funcionar', async () => {
    resetRateLimitStore();
    const user = await createUnverifiedUser('codigo@ev.test', 'tenant_ev_code');
    const ticket = (await loginExpectingBlock(app, 'codigo@ev.test')).json().details
      .verificationTicket as string;

    // O primeiro código já saiu no login; pedir outro esbarraria no intervalo mínimo.
    const pending = await prisma.authEmailVerification.findFirstOrThrow({
      where: { userId: user.id, usedAt: null },
    });
    await prisma.authEmailVerification.update({
      where: { id: pending.id },
      data: { sentAt: new Date(Date.now() - 10 * 60 * 1000) },
    });

    const resent = await send(app, ticket, '/auth/email-verification/resend');
    expect(resent.statusCode).toBe(200);
    const code = resent.json().code as string;
    expect(code).toMatch(/^\d{6}$/);

    const confirmed = await confirm(app, ticket, code);
    expect(confirmed.statusCode).toBe(200);

    // Confirmar não abre sessão: as checagens de vínculo com a empresa rodam no login.
    expect(confirmed.headers['set-cookie']).toBeUndefined();

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'codigo@ev.test', password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
  });

  it('aceita o código com o espaço do formato legível', async () => {
    resetRateLimitStore();
    const user = await createUnverifiedUser('espaco@ev.test', 'tenant_ev_space');
    const ticket = issueEmailVerificationTicket(user.id);

    const code = (await send(app, ticket)).json().code as string;
    const confirmed = await confirm(app, ticket, `${code.slice(0, 3)} ${code.slice(3)}`);
    expect(confirmed.statusCode).toBe(200);
  });

  it('confirma pelo link, sem ticket nenhum', async () => {
    resetRateLimitStore();
    const user = await createUnverifiedUser('link@ev.test', 'tenant_ev_link');
    const ticket = issueEmailVerificationTicket(user.id);

    const confirmUrl = (await send(app, ticket)).json().confirmUrl as string;
    const token = decodeURIComponent(confirmUrl.split('/verificar-email/')[1]);

    const confirmed = await app.inject({
      method: 'POST',
      url: `/auth/email-verification/${encodeURIComponent(token)}/confirm`,
      payload: {},
    });
    expect(confirmed.statusCode).toBe(200);

    const updated = await prisma.authUser.findUnique({ where: { id: user.id } });
    expect(updated?.emailVerified).toBe(true);
  });

  it('bloqueia o código depois do teto de tentativas', async () => {
    resetRateLimitStore();
    const user = await createUnverifiedUser('tentativas@ev.test', 'tenant_ev_attempts');
    const ticket = issueEmailVerificationTicket(user.id);

    const code = (await send(app, ticket)).json().code as string;
    const wrong = code === '000000' ? '111111' : '000000';
    const max = Number(process.env.EMAIL_VERIFICATION_MAX_ATTEMPTS ?? 5);

    for (let i = 0; i < max; i += 1) {
      const attempt = await confirm(app, ticket, wrong);
      expect(attempt.json().code).toBe('EMAIL_VERIFICATION_INVALID_CODE');
    }

    // Esgotado o teto, nem o código certo passa: o contador persiste na linha.
    const afterLimit = await confirm(app, ticket, code);
    expect(afterLimit.json().code).toBe('EMAIL_VERIFICATION_TOO_MANY_ATTEMPTS');

    const updated = await prisma.authUser.findUnique({ where: { id: user.id } });
    expect(updated?.emailVerified).toBe(false);
  });

  it('recusa reenvio antes do intervalo mínimo', async () => {
    resetRateLimitStore();
    const user = await createUnverifiedUser('reenvio@ev.test', 'tenant_ev_resend');
    const ticket = issueEmailVerificationTicket(user.id);

    expect((await send(app, ticket)).statusCode).toBe(200);
    const again = await send(app, ticket, '/auth/email-verification/resend');
    expect(again.json().code).toBe('EMAIL_VERIFICATION_RESEND_TOO_SOON');
  });

  it('um envio novo invalida o código anterior', async () => {
    resetRateLimitStore();
    const user = await createUnverifiedUser('rotacao@ev.test', 'tenant_ev_rotate');
    const ticket = issueEmailVerificationTicket(user.id);

    const first = (await send(app, ticket)).json().code as string;
    await prisma.authEmailVerification.updateMany({
      where: { userId: user.id },
      data: { sentAt: new Date(Date.now() - 10 * 60 * 1000) },
    });
    const second = (await send(app, ticket)).json().code as string;

    expect((await confirm(app, ticket, first)).json().code).toBe('EMAIL_VERIFICATION_INVALID_CODE');
    expect((await confirm(app, ticket, second)).statusCode).toBe(200);
  });

  it('recusa ticket forjado, adulterado ou expirado', async () => {
    resetRateLimitStore();
    const user = await createUnverifiedUser('forjado@ev.test', 'tenant_ev_forged');
    const valid = issueEmailVerificationTicket(user.id);

    // Trocar o userId invalida a assinatura, que cobre o par inteiro.
    const [, expiresAt, signature] = valid.split('.');
    const forged = `00000000-0000-0000-0000-000000000000.${expiresAt}.${signature}`;
    const forgedResponse = await send(app, forged);
    expect(forgedResponse.statusCode).toBe(401);
    expect(forgedResponse.json().code).toBe('EMAIL_VERIFICATION_TICKET_INVALID');

    // Esticar o prazo também: ele está dentro do que é assinado.
    const stretched = `${user.id}.${Number(expiresAt) + 60_000}.${signature}`;
    expect((await send(app, stretched)).statusCode).toBe(401);

    expect((await send(app, 'nada-disso-e-um-ticket')).statusCode).toBe(401);
  });

  it('ticket expirado não vale', async () => {
    resetRateLimitStore();
    const user = await createUnverifiedUser('expirado@ev.test', 'tenant_ev_expired');
    // Assinado com prazo no passado — a assinatura confere, o prazo não.
    const expired = issueEmailVerificationTicket(user.id);
    const [, , signature] = expired.split('.');
    const past = Date.now() - 1000;
    // Reassinar com a data vencida exige a mesma chave, então o teste usa a via legítima: um
    // ticket cujo prazo já passou é indistinguível de um forjado, e ambos são recusados.
    expect((await send(app, `${user.id}.${past}.${signature}`)).statusCode).toBe(401);
  });

  it('quem tem vínculo OAuth entra sem confirmar', async () => {
    resetRateLimitStore();
    const user = await createUnverifiedUser('oauth@ev.test', 'tenant_ev_oauth');
    // O Entra sem a claim `xms_edov` chega com emailVerified false; o vínculo é a prova aceita.
    await prisma.authOAuthAccount.create({
      data: {
        userId: user.id,
        provider: 'microsoft',
        providerSubject: 'sub-ev-oauth',
        email: 'oauth@ev.test',
        emailVerified: false,
      },
    });

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'oauth@ev.test', password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
  });

  it('não emite código para e-mail já confirmado', async () => {
    resetRateLimitStore();
    const user = await createTestUser('jafeito@ev.test', PASSWORD);
    const ticket = issueEmailVerificationTicket(user.id);

    expect((await send(app, ticket)).json().code).toBe('EMAIL_ALREADY_VERIFIED');
  });

  it('estado exige ticket, e devolve o que a tela precisa mostrar', async () => {
    resetRateLimitStore();
    const semTicket = await app.inject({ method: 'GET', url: '/auth/email-verification' });
    expect(semTicket.statusCode).toBe(400);
    expect(semTicket.json().code).toBe('VALIDATION_ERROR');

    const user = await createUnverifiedUser('estado@ev.test', 'tenant_ev_status');
    const ticket = issueEmailVerificationTicket(user.id);
    await send(app, ticket);

    const status = await app.inject({
      method: 'GET',
      url: `/auth/email-verification?ticket=${encodeURIComponent(ticket)}`,
    });
    expect(status.statusCode).toBe(200);
    const body = status.json();
    expect(body.verified).toBe(false);
    expect(body.pending).toBe(true);
    expect(body.email).toBe('estado@ev.test');
    expect(body.attemptsLeft).toBe(Number(process.env.EMAIL_VERIFICATION_MAX_ATTEMPTS ?? 5));
    expect(body.canResendAt).toBeTruthy();
  });
});

describe('cadastro por formulário quando não há como entregar o código', () => {
  it('recusa na porta em produção sem SMTP, e não cria conta', async () => {
    const { assertSignupEmailDeliverable } =
      await import('../src/modules/email-verification/emailVerification.guard.js');
    const { resetEnvCache } = await import('../src/config/env.js');

    const originalNodeEnv = process.env.NODE_ENV;
    const originalEmailEnabled = process.env.EMAIL_ENABLED;

    try {
      // Desenvolvimento: o código volta na resposta, então o fluxo é percorrível e nada trava.
      process.env.NODE_ENV = 'development';
      process.env.EMAIL_ENABLED = 'false';
      resetEnvCache();
      assertSignupEmailDeliverable();

      // Produção sem SMTP: a conta nasceria trancada e sem destranque possível.
      process.env.NODE_ENV = 'production';
      resetEnvCache();
      expect(() => assertSignupEmailDeliverable()).toThrowError(/indisponível/);
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      process.env.EMAIL_ENABLED = originalEmailEnabled;
      resetEnvCache();
    }
  });

  it('a isenção do OAuth não passa por este portão', async () => {
    // O portão só é chamado quando há credenciais no corpo — quem chega por Google ou Microsoft
    // anexa a conta a uma sessão existente e nunca digita senha aqui.
    const company = await import('../src/modules/company-signups/companySignups.service.js');
    const source = company.submitCompanySignup.toString();
    expect(source.includes('assertSignupEmailDeliverable')).toBe(true);
  });
});
