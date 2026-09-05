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
  const { membership } = await setupAdminUser(
    'admin@invite.test',
    'admin-pass-123',
    tenantId,
    ['company_admin'],
  );
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

    expect(body.inviteLink).toContain('/convite/');
    expect(body.inviteToken).toBeTruthy();
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

  it('usuário existente aceita convite sem criar nova senha', async () => {
    const adminCookie = await loginAsAdmin(app);
    await createTestUser('existente@invite.test', 'senha-segura-123', {
      firstName: 'Existente',
      lastName: 'Usuario',
    });

    const { inviteToken } = await createInvite(app, adminCookie, 'existente@invite.test');

    const accept = await app.inject({
      method: 'POST',
      url: `/auth/invites/${inviteToken}/accept`,
      payload: buildAcceptPayload({
        firstName: 'Existente',
        lastName: 'Usuario',
        password: undefined,
      }),
    });
    expect(accept.statusCode).toBe(200);
    expect(accept.json().sessionEstablished).toBe(false);

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'existente@invite.test',
        password: 'senha-segura-123',
      },
    });
    expect(login.statusCode).toBe(200);

    const memberships = await prisma.authMembership.count({
      where: { status: 'active' },
    });
    expect(memberships).toBeGreaterThanOrEqual(2);
  });
});
