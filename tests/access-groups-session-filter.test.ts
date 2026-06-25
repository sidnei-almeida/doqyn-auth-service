import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';
import { getSessionCookieName } from '../src/security/cookies.js';
import {
  createTestAccessGroupWithStatus,
  createTestMembership,
  createTestUser,
  linkMembershipToGroupsRaw,
  loginUser,
  setupAdminUser,
} from './helpers.js';
import { setMembershipRoles } from '../src/modules/memberships/memberships.service.js';
import { TEST_ENV } from './setup.js';

const INTERNAL_KEY = TEST_ENV.DOQYN_INTERNAL_API_KEY;
const cookieName = getSessionCookieName();

function authHeader(): Record<string, string> {
  return { authorization: `Bearer ${INTERNAL_KEY}` };
}

async function setupMembershipWithMixedGroups(tenantId: string, email: string) {
  const { membership, tenant } = await setupAdminUser(
    email,
    'senha-segura-123',
    tenantId,
    ['company_admin', 'user'],
  );

  await createTestAccessGroupWithStatus(tenantId, 'financeiro', 'Financeiro', 'active');
  await createTestAccessGroupWithStatus(tenantId, 'rh', 'RH', 'inactive');
  await createTestAccessGroupWithStatus(tenantId, 'juridico', 'Jurídico', 'deleted');

  await linkMembershipToGroupsRaw(membership.id, tenant.id, [
    'group_financeiro',
    'group_rh',
    'group_juridico',
  ]);

  return { membership, tenant };
}

describe('accessGroupIds — apenas grupos active no contexto de sessão', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/auth/session não retorna grupos inactive nem deleted', async () => {
    const email = 'session.filter@empresa.com';
    await setupMembershipWithMixedGroups('session_filter_tenant', email);

    const { token } = await loginUser(app, email, 'senha-segura-123', cookieName);

    const body = (
      await app.inject({
        method: 'GET',
        url: '/auth/session',
        headers: { cookie: `${cookieName}=${token}` },
      })
    ).json() as {
      ok: boolean;
      activeMembership: { accessGroupIds: string[] };
    };

    expect(body.ok).toBe(true);
    expect(body.activeMembership.accessGroupIds).toEqual(['group_financeiro']);
    expect(body.activeMembership.accessGroupIds).not.toContain('group_rh');
    expect(body.activeMembership.accessGroupIds).not.toContain('group_juridico');
  });

  it('/internal/sessions/verify não retorna grupos inactive nem deleted', async () => {
    const email = 'verify.filter@empresa.com';
    await setupMembershipWithMixedGroups('verify_filter_tenant', email);

    const { token } = await loginUser(app, email, 'senha-segura-123', cookieName);

    const body = (
      await app.inject({
        method: 'POST',
        url: '/internal/sessions/verify',
        headers: authHeader(),
        payload: { sessionToken: token },
      })
    ).json() as {
      ok: boolean;
      activeMembership: { accessGroupIds: string[] };
    };

    expect(body.ok).toBe(true);
    expect(body.activeMembership.accessGroupIds).toEqual(['group_financeiro']);
    expect(body.activeMembership.accessGroupIds).not.toContain('group_rh');
    expect(body.activeMembership.accessGroupIds).not.toContain('group_juridico');
  });

  it('vínculos antigos com grupos inactive/deleted permanecem no banco', async () => {
    const email = 'db.links@empresa.com';
    const { membership } = await setupMembershipWithMixedGroups('db_links_tenant', email);

    const links = await prisma.authMembershipAccessGroup.findMany({
      where: { membershipId: membership.id },
      include: { accessGroup: true },
    });

    const groupIds = links.map((l) => l.accessGroup.groupId).sort();
    expect(groupIds).toEqual(['group_financeiro', 'group_juridico', 'group_rh']);
  });

  it('grupos active continuam aparecendo normalmente', async () => {
    const email = 'active.only@empresa.com';
    const { membership, tenant } = await setupAdminUser(
      email,
      'senha-segura-123',
      'active_only_tenant',
      ['company_admin'],
    );

    await createTestAccessGroupWithStatus(tenant.tenantId, 'financeiro', 'Financeiro', 'active');
    await createTestAccessGroupWithStatus(tenant.tenantId, 'comercial', 'Comercial', 'active');
    await linkMembershipToGroupsRaw(membership.id, tenant.id, ['group_financeiro', 'group_comercial']);

    const { token } = await loginUser(app, email, 'senha-segura-123', cookieName);

    const sessionBody = (
      await app.inject({
        method: 'GET',
        url: '/auth/session',
        headers: { cookie: `${cookieName}=${token}` },
      })
    ).json() as { activeMembership: { accessGroupIds: string[] } };

    expect(sessionBody.activeMembership.accessGroupIds.sort()).toEqual([
      'group_comercial',
      'group_financeiro',
    ]);
  });

  it('PATCH access-groups não vincula grupo inactive/deleted', async () => {
    const adminEmail = 'patch.admin@empresa.com';
    const { membership: adminMembership, tenant } = await setupAdminUser(
      adminEmail,
      'senha-segura-123',
      'patch_filter_tenant',
      ['company_admin'],
    );

    await createTestAccessGroupWithStatus('patch_filter_tenant', 'financeiro', 'Financeiro', 'active');
    await createTestAccessGroupWithStatus('patch_filter_tenant', 'rh', 'RH', 'inactive');
    await createTestAccessGroupWithStatus('patch_filter_tenant', 'juridico', 'Jurídico', 'deleted');

    const memberUser = await createTestUser('patch.member@empresa.com', 'senha-segura-123');
    const memberMembership = await createTestMembership(memberUser.id, tenant.id, 'active');
    await setMembershipRoles(memberMembership.id, ['user']);

    const { token } = await loginUser(app, adminEmail, 'senha-segura-123', cookieName);

    await app.inject({
      method: 'POST',
      url: '/auth/select-tenant',
      headers: { cookie: `${cookieName}=${token}` },
      payload: { membershipId: adminMembership.id },
    });

    const response = await app.inject({
      method: 'PATCH',
      url: `/auth/admin/members/${memberMembership.id}/access-groups`,
      headers: { cookie: `${cookieName}=${token}` },
      payload: {
        accessGroupIds: ['group_financeiro', 'group_rh', 'group_juridico'],
      },
    });

    expect(response.statusCode).toBe(200);
    const membership = (response.json() as { membership: { accessGroupIds: string[] } }).membership;
    expect(membership.accessGroupIds).toEqual(['group_financeiro']);

    const dbLinks = await prisma.authMembershipAccessGroup.findMany({
      where: { membershipId: memberMembership.id },
      include: { accessGroup: true },
    });
    expect(dbLinks.map((l) => l.accessGroup.groupId)).toEqual(['group_financeiro']);
  });

  it('grupo desativado após vínculo não concede acesso na sessão', async () => {
    const email = 'deactivate.after@empresa.com';
    const { membership, tenant } = await setupAdminUser(
      email,
      'senha-segura-123',
      'deactivate_after_tenant',
      ['company_admin'],
    );

    await createTestAccessGroupWithStatus(tenant.tenantId, 'financeiro', 'Financeiro', 'active');
    const rhGroup = await createTestAccessGroupWithStatus(tenant.tenantId, 'rh', 'RH', 'active');
    await linkMembershipToGroupsRaw(membership.id, tenant.id, ['group_financeiro', 'group_rh']);

    await prisma.authAccessGroup.update({
      where: { id: rhGroup.id },
      data: { status: 'inactive' },
    });

    const linksCount = await prisma.authMembershipAccessGroup.count({
      where: { membershipId: membership.id },
    });
    expect(linksCount).toBe(2);

    const { token } = await loginUser(app, email, 'senha-segura-123', cookieName);

    const verifyBody = (
      await app.inject({
        method: 'POST',
        url: '/internal/sessions/verify',
        headers: authHeader(),
        payload: { sessionToken: token },
      })
    ).json() as { activeMembership: { accessGroupIds: string[] } };

    expect(verifyBody.activeMembership.accessGroupIds).toEqual(['group_financeiro']);
  });
});
