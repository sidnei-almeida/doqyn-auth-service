import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { getSessionCookieName } from '../src/security/cookies.js';
import {
  linkMembershipToGroups,
  loginUser,
  setupAccessGroups,
  setupAdminUser,
} from './helpers.js';
import { TEST_ENV } from './setup.js';

const INTERNAL_KEY = TEST_ENV.DOQYN_INTERNAL_API_KEY;
const cookieName = getSessionCookieName();

function authHeader(): Record<string, string> {
  return { authorization: `Bearer ${INTERNAL_KEY}` };
}

describe('internal verify with membership', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/internal/sessions/verify retorna activeMembership', async () => {
    const { membership } = await setupAdminUser(
      'verify.member@empresa.com',
      'senha-segura-123',
      'verify_tenant',
      ['company_admin', 'user'],
    );
    await setupAccessGroups('verify_tenant');
    await linkMembershipToGroups(membership.id, membership.tenantId, ['group_financeiro']);

    const { token } = await loginUser(app, 'verify.member@empresa.com', 'senha-segura-123', cookieName);

    const verifyResponse = await app.inject({
      method: 'POST',
      url: '/internal/sessions/verify',
      headers: authHeader(),
      payload: { sessionToken: token },
    });

    const body = verifyResponse.json();
    expect(body.ok).toBe(true);
    expect(body.activeMembership).toBeDefined();
    expect(body.activeMembership.tenantId).toBe('verify_tenant');
  });

  it('/internal/sessions/verify retorna roles', async () => {
    await setupAdminUser(
      'verify.roles@empresa.com',
      'senha-segura-123',
      'roles_tenant',
      ['company_admin', 'user'],
    );

    const { token } = await loginUser(app, 'verify.roles@empresa.com', 'senha-segura-123', cookieName);

    const body = (
      await app.inject({
        method: 'POST',
        url: '/internal/sessions/verify',
        headers: authHeader(),
        payload: { sessionToken: token },
      })
    ).json();

    expect(body.activeMembership.roles).toContain('company_admin');
    expect(body.activeMembership.roles).toContain('user');
  });

  it('/internal/sessions/verify retorna accessGroupIds', async () => {
    const { membership } = await setupAdminUser(
      'verify.groups@empresa.com',
      'senha-segura-123',
      'groups_tenant',
      ['company_admin'],
    );
    await setupAccessGroups('groups_tenant');
    await linkMembershipToGroups(membership.id, membership.tenantId, ['group_financeiro', 'group_juridico']);

    const { token } = await loginUser(app, 'verify.groups@empresa.com', 'senha-segura-123', cookieName);

    const body = (
      await app.inject({
        method: 'POST',
        url: '/internal/sessions/verify',
        headers: authHeader(),
        payload: { sessionToken: token },
      })
    ).json();

    expect(body.activeMembership.accessGroupIds).toContain('group_financeiro');
    expect(body.activeMembership.accessGroupIds).toContain('group_juridico');
  });
});
