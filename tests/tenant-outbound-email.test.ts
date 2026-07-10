import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { getSessionCookieName } from '../src/security/cookies.js';
import { loginUser, setupAdminUser } from './helpers.js';
import { TEST_ENV } from './setup.js';

const cookieName = getSessionCookieName();
const tenantId = 'company_email_settings';

async function loginAsAdmin(app: FastifyInstance): Promise<string> {
  const { membership } = await setupAdminUser(
    'admin@email-settings.test',
    'admin-pass-123',
    tenantId,
    ['company_admin'],
  );
  const { token } = await loginUser(app, 'admin@email-settings.test', 'admin-pass-123', cookieName);
  await app.inject({
    method: 'POST',
    url: '/auth/select-tenant',
    headers: { cookie: `${cookieName}=${token}` },
    payload: { membershipId: membership.id },
  });
  return `${cookieName}=${token}`;
}

describe('tenant outbound email settings', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    Object.assign(process.env, {
      ...TEST_ENV,
      EMAIL_ENABLED: 'false',
    });
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('retorna configuração vazia quando SMTP não foi configurado', async () => {
    const adminCookie = await loginAsAdmin(app);
    const response = await app.inject({
      method: 'GET',
      url: '/auth/admin/tenant/outbound-email',
      headers: { cookie: adminCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().outboundEmail.configured).toBe(false);
  });

  it('salva SMTP da empresa e mascara senha na leitura', async () => {
    const adminCookie = await loginAsAdmin(app);
    const save = await app.inject({
      method: 'PUT',
      url: '/auth/admin/tenant/outbound-email',
      headers: { cookie: adminCookie },
      payload: {
        smtpHost: 'smtp.empresa.test',
        smtpPort: 587,
        smtpSecure: false,
        smtpUser: 'convites@empresa.test',
        smtpPassword: 'senha-smtp-teste',
        enabled: true,
      },
    });

    expect(save.statusCode).toBe(200);
    const saved = save.json().outboundEmail;
    expect(saved.configured).toBe(true);
    expect(saved.smtpHost).toBe('smtp.empresa.test');
    expect(saved.smtpUser).toBe('convites@empresa.test');
    expect(saved.fromDomain).toBe('empresa.test');
    expect(saved.hasPassword).toBe(true);
  });
});
