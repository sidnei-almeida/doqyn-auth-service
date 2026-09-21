import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';
import { hashInviteToken } from '../src/security/crypto.js';
import { getSessionCookieName } from '../src/security/cookies.js';
import { createTestUser, loginUser, setupAdminUser } from './helpers.js';
import { TEST_ENV } from './setup.js';

const cookieName = getSessionCookieName();
const tenantId = 'company_invite_test';
const TERMS_VERSION = 'v1.0-dev';

function buildAcceptPayload(overrides?: Record<string, unknown>) {
  return {
    firstName: 'Aceitar',
    lastName: 'Convidado',
    password: 'senha-segura-123',
    whatsapp: '+5554999887766',
    jobTitle: 'Analista',
    departmentText: 'Financeiro',
    operationalNotificationsConsent: true,
    informationDeclaration: true,
    acceptedTerms: true,
    acceptedTermsVersion: TERMS_VERSION,
    ...overrides,
  };
}

async function loginAsAdmin(app: FastifyInstance): Promise<string> {
  const { membership } = await setupAdminUser('admin@invite.test', 'admin-pass-123', tenantId, [
    'company_admin',
  ]);
  const { token } = await loginUser(app, 'admin@invite.test', 'admin-pass-123', cookieName);
  await app.inject({
    method: 'POST',
    url: '/auth/select-tenant',
    headers: { cookie: `${cookieName}=${token}` },
    payload: { membershipId: membership.id },
  });
  return `${cookieName}=${token}`;
}

async function createInvite(
  app: FastifyInstance,
  adminCookie: string,
  email: string,
  opts?: { firstName?: string; lastName?: string },
) {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/invites',
    headers: { cookie: adminCookie },
    payload: {
      email,
      roles: ['user'],
      firstName: opts?.firstName,
      lastName: opts?.lastName,
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as {
    inviteToken: string;
    invite: { id: string };
    inviteLink: string;
  };
}

describe('member invites', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    Object.assign(process.env, {
      ...TEST_ENV,
      DOQYN_APP_PUBLIC_URL: 'http://localhost:5173',
      EMAIL_ENABLED: 'false',
    });
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('admin cria convite e retorna link', async () => {
    const adminCookie = await loginAsAdmin(app);
    const body = await createInvite(app, adminCookie, 'novo@invite.test', {
      firstName: 'Novo',
      lastName: 'Convidado',
    });

    expect(body.inviteLink).toContain('/invite/');
    expect(body.inviteToken).toBeTruthy();
  });

  it('GET /auth/invites lista quem foi convidado e ainda não entrou', async () => {
    const adminCookie = await loginAsAdmin(app);
    await createInvite(app, adminCookie, 'aguardando@invite.test', {
      firstName: 'Aguar',
      lastName: 'Dando',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/auth/invites',
      headers: { cookie: adminCookie },
    });

    expect(response.statusCode).toBe(200);
    const convite = response
      .json()
      .invites.find((i: { email: string }) => i.email === 'aguardando@invite.test');
    expect(convite).toBeTruthy();
    expect(convite.firstName).toBe('Aguar');
    expect(convite.roles).toEqual(['user']);
    // O prazo vai junto: sem ele a tela não distingue convite vivo de convite vencido, e some-lo
    // faria o administrador concluir que a pessoa entrou.
    expect(new Date(convite.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('convite aceito sai da lista de pendentes', async () => {
    const adminCookie = await loginAsAdmin(app);
    const { inviteToken } = await createInvite(app, adminCookie, 'sumir@invite.test');

    await app.inject({
      method: 'POST',
      url: `/auth/invites/${inviteToken}/accept`,
      payload: buildAcceptPayload(),
    });

    const response = await app.inject({
      method: 'GET',
      url: '/auth/invites',
      headers: { cookie: adminCookie },
    });

    const emails = response.json().invites.map((i: { email: string }) => i.email);
    expect(emails).not.toContain('sumir@invite.test');
  });

  it('GET /auth/invites/:token retorna dados públicos do convite', async () => {
    const adminCookie = await loginAsAdmin(app);
    const { inviteToken } = await createInvite(app, adminCookie, 'preview@invite.test', {
      firstName: 'Preview',
      lastName: 'User',
    });

    const response = await app.inject({
      method: 'GET',
      url: `/auth/invites/${inviteToken}`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.invite.email).toBe('preview@invite.test');
    expect(body.invite.requiresAccountCreation).toBe(true);
    expect(body.invite.tenantDisplayName).toBe(tenantId);
  });

  it('aceita convite criando usuário e membership ativa', async () => {
    const adminCookie = await loginAsAdmin(app);
    const { inviteToken } = await createInvite(app, adminCookie, 'aceitar@invite.test');

    const response = await app.inject({
      method: 'POST',
      url: `/auth/invites/${inviteToken}/accept`,
      payload: buildAcceptPayload({
        firstName: 'Aceitar',
        lastName: 'Convidado',
      }),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.sessionEstablished).toBe(true);

    const membership = await prisma.authMembership.findUnique({
      where: { id: body.membershipId },
      include: { roles: true },
    });
    expect(membership).toBeTruthy();
    expect(membership?.roles.map((role) => role.role)).toContain('user');
    expect(membership?.requestedJobTitleEncrypted).toBeTruthy();
    expect(membership?.requestedDepartmentEncrypted).toBeTruthy();

    const user = await prisma.authUser.findFirst({
      where: { id: membership!.userId },
    });
    expect(user?.whatsappEncrypted).toBeTruthy();

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'aceitar@invite.test',
        password: 'senha-segura-123',
      },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().ok).toBe(true);
  });

  it('rejeita aceitar convite duas vezes', async () => {
    const adminCookie = await loginAsAdmin(app);
    const { inviteToken } = await createInvite(app, adminCookie, 'duplo@invite.test');

    await app.inject({
      method: 'POST',
      url: `/auth/invites/${inviteToken}/accept`,
      payload: buildAcceptPayload({
        firstName: 'Duplo',
        lastName: 'Convidado',
      }),
    });

    const response = await app.inject({
      method: 'POST',
      url: `/auth/invites/${inviteToken}/accept`,
      payload: buildAcceptPayload({
        firstName: 'Duplo',
        lastName: 'Convidado',
      }),
    });

    expect(response.statusCode).toBe(410);
    expect(response.json().code).toBe('INVITE_ALREADY_USED');
  });

  it('admin pode revogar convite pendente', async () => {
    const adminCookie = await loginAsAdmin(app);
    const { inviteToken, invite } = await createInvite(app, adminCookie, 'revogar@invite.test');

    const revoke = await app.inject({
      method: 'POST',
      url: `/auth/invites/${invite.id}/revoke`,
      headers: { cookie: adminCookie },
    });
    expect(revoke.statusCode).toBe(200);

    const preview = await app.inject({
      method: 'GET',
      url: `/auth/invites/${inviteToken}`,
    });
    expect(preview.statusCode).toBe(410);
    expect(preview.json().code).toBe('INVITE_REVOKED');
  });

  it('pedidos simultâneos para o mesmo e-mail deixam um convite pendente só', async () => {
    const adminCookie = await loginAsAdmin(app);
    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        app.inject({
          method: 'POST',
          url: '/auth/invites',
          headers: { cookie: adminCookie },
          payload: { email: 'cliqueduplo@invite.test', roles: ['user'] },
        }),
      ),
    );

    for (const response of responses) {
      expect([201, 409]).toContain(response.statusCode);
    }
    const pending = await prisma.authInvite.count({
      where: { status: 'pending', emailLookupHash: { not: '' } },
    });
    expect(pending).toBe(1);
  });

  it('convite pendente vencido não impede convidar de novo', async () => {
    const adminCookie = await loginAsAdmin(app);
    const { inviteToken } = await createInvite(app, adminCookie, 'vencido@invite.test');
    await prisma.authInvite.update({
      where: { tokenHash: hashInviteToken(inviteToken) },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    await createInvite(app, adminCookie, 'vencido@invite.test');
  });

  it('convite expirado retorna 410', async () => {
    const adminCookie = await loginAsAdmin(app);
    const { inviteToken } = await createInvite(app, adminCookie, 'expirado@invite.test');
    const tokenHash = hashInviteToken(inviteToken);

    await prisma.authInvite.update({
      where: { tokenHash },
      data: { expiresAt: new Date(Date.now() - 60_000), status: 'expired' },
    });

    const preview = await app.inject({
      method: 'GET',
      url: `/auth/invites/${inviteToken}`,
    });
    expect(preview.statusCode).toBe(410);
    expect(preview.json().code).toBe('INVITE_EXPIRED');
  });

  it('usuário existente aceita convite logado na própria conta, sem criar senha', async () => {
    const adminCookie = await loginAsAdmin(app);
    const user = await createTestUser('existente@invite.test', 'senha-segura-123', {
      firstName: 'Existente',
      lastName: 'Usuario',
    });

    const { inviteToken } = await createInvite(app, adminCookie, 'existente@invite.test');
    const { token } = await loginUser(app, 'existente@invite.test', 'senha-segura-123', cookieName);

    const accept = await app.inject({
      method: 'POST',
      url: `/auth/invites/${inviteToken}/accept`,
      headers: { cookie: `${cookieName}=${token}` },
      payload: buildAcceptPayload({
        firstName: undefined,
        lastName: undefined,
        password: undefined,
      }),
    });
    expect(accept.statusCode).toBe(200);
    expect(accept.json().sessionEstablished).toBe(true);
    // A sessão é a que já existia: nenhum cookie novo sai daqui.
    expect(accept.headers['set-cookie']).toBeUndefined();

    expect(await prisma.authCredential.count({ where: { userId: user.id } })).toBe(1);

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'existente@invite.test',
        password: 'senha-segura-123',
      },
    });
    expect(login.statusCode).toBe(200);

    const membership = await prisma.authMembership.findFirst({
      where: { userId: user.id, status: 'active' },
    });
    expect(membership).toBeTruthy();
  });

  it('conta só com Google/Microsoft não ganha senha nem sessão de quem tem o link', async () => {
    const adminCookie = await loginAsAdmin(app);
    const oauthUser = await createTestUser('oauth@invite.test', 'descartada-123');
    // Conta criada por OAuth não tem credencial de senha — era exatamente o alvo da tomada de conta.
    await prisma.authCredential.deleteMany({ where: { userId: oauthUser.id } });

    const { inviteToken } = await createInvite(app, adminCookie, 'oauth@invite.test');

    const preview = await app.inject({ method: 'GET', url: `/auth/invites/${inviteToken}` });
    expect(preview.json().invite.requiresLogin).toBe(true);
    expect(preview.json().invite.requiresPassword).toBe(false);

    const accept = await app.inject({
      method: 'POST',
      url: `/auth/invites/${inviteToken}/accept`,
      payload: buildAcceptPayload({ password: 'Tomada#12345' }),
    });
    expect(accept.statusCode).toBe(401);
    expect(accept.json().code).toBe('INVITE_LOGIN_REQUIRED');
    expect(accept.headers['set-cookie']).toBeUndefined();
    expect(await prisma.authCredential.count({ where: { userId: oauthUser.id } })).toBe(0);
    expect(await prisma.authMembership.count({ where: { userId: oauthUser.id } })).toBe(0);

    const invite = await prisma.authInvite.findUnique({
      where: { tokenHash: hashInviteToken(inviteToken) },
    });
    expect(invite?.status).toBe('pending');
  });

  it('convite para uma conta não é aceito por quem está logado em outra', async () => {
    const adminCookie = await loginAsAdmin(app);
    const invited = await createTestUser('convidado@invite.test', 'senha-segura-123');
    await createTestUser('intrusa@invite.test', 'senha-segura-123');

    const { inviteToken } = await createInvite(app, adminCookie, 'convidado@invite.test');
    const { token } = await loginUser(app, 'intrusa@invite.test', 'senha-segura-123', cookieName);

    const accept = await app.inject({
      method: 'POST',
      url: `/auth/invites/${inviteToken}/accept`,
      headers: { cookie: `${cookieName}=${token}` },
      payload: buildAcceptPayload({ password: undefined }),
    });
    expect(accept.statusCode).toBe(403);
    expect(accept.json().code).toBe('INVITE_WRONG_ACCOUNT');
    expect(await prisma.authMembership.count({ where: { userId: invited.id } })).toBe(0);
  });
});
