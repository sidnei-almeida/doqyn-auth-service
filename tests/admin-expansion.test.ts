import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';
import { getSessionCookieName } from '../src/security/cookies.js';
import {
  createTestMembership,
  createTestTenant,
  createTestUser,
  loginUser,
  setupAccessGroups,
  setupAdminUser,
} from './helpers.js';
import { setMembershipRoles } from '../src/modules/memberships/memberships.service.js';
import { TEST_ENV } from './setup.js';

const cookieName = getSessionCookieName();

describe('admin expansion', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('lista membros com paginação', async () => {
    const { membership: adminMembership, tenant } = await setupAdminUser(
      'list.admin@empresa.com',
      'senha-segura-123',
      'tenant_list',
    );
    const user = await createTestUser('member@empresa.com', 'senha-segura-123');
    await createTestMembership(user.id, tenant.id, 'active');

    const { token } = await loginUser(app, 'list.admin@empresa.com', 'senha-segura-123', cookieName);
    await app.inject({
      method: 'POST',
      url: '/auth/select-tenant',
      headers: { cookie: `${cookieName}=${token}` },
      payload: { membershipId: adminMembership.id },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/auth/admin/members?page=1&limit=10',
      headers: { cookie: `${cookieName}=${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { ok: boolean; items: unknown[]; total: number };
    expect(body.ok).toBe(true);
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    expect(body.total).toBeGreaterThanOrEqual(1);
  });

  it('retorna detalhe do membro', async () => {
    const { membership: adminMembership, tenant } = await setupAdminUser(
      'detail.admin@empresa.com',
      'senha-segura-123',
      'tenant_detail',
    );
    const user = await createTestUser('detail.member@empresa.com', 'senha-segura-123', {
      firstName: 'Maria',
    });
    const target = await createTestMembership(user.id, tenant.id, 'active');
    await setMembershipRoles(target.id, ['user']);

    const { token } = await loginUser(app, 'detail.admin@empresa.com', 'senha-segura-123', cookieName);
    await app.inject({
      method: 'POST',
      url: '/auth/select-tenant',
      headers: { cookie: `${cookieName}=${token}` },
      payload: { membershipId: adminMembership.id },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/auth/admin/members/${target.id}`,
      headers: { cookie: `${cookieName}=${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { member: { user: { email: string }; membership: { status: string } } };
    expect(body.member.user.email).toBe('detail.member@empresa.com');
    expect(body.member.membership.status).toBe('active');
  });

  /**
   * Este teste afirmava LAST_ADMIN_PROTECTION (409) usando um ator de OUTRO tenant, o que só era
   * possível pelo papel administrativo global — eliminado do produto. Sem ele, a requisição para
   * de ser "protegida" e passa a ser barrada antes, por escopo de tenant.
   *
   * Consequência registrada no SUMMARY: por HTTP, LAST_ADMIN_PROTECTION ficou inalcançável.
   * `assertNotSelfSensitive` roda antes de `assertLastAdminProtection`, e o único ator autorizado
   * a rebaixar o admin solitário de um tenant é ele mesmo. Cobrir o 409 de novo exige decisão de
   * produto sobre quem pode fazê-lo, que é fase 2.
   */
  it('rebaixar admin de outro tenant é violação de escopo, não proteção de último admin', async () => {
    const { membership: targetMembership } = await setupAdminUser(
      'only.admin@empresa.com',
      'senha-segura-123',
      'tenant_lastadmin',
    );
    const { membership: outroTenantAdmin } = await setupAdminUser(
      'admin.outro@empresa.com',
      'senha-segura-123',
      'tenant_outro_lastadmin',
    );

    const { token } = await loginUser(app, 'admin.outro@empresa.com', 'senha-segura-123', cookieName);
    await app.inject({
      method: 'POST',
      url: '/auth/select-tenant',
      headers: { cookie: `${cookieName}=${token}` },
      payload: { membershipId: outroTenantAdmin.id },
    });

    const response = await app.inject({
      method: 'PATCH',
      url: `/auth/admin/members/${targetMembership.id}/roles`,
      headers: { cookie: `${cookieName}=${token}` },
      payload: { roles: ['user'] },
    });

    expect(response.statusCode).toBe(403);
    expect((response.json() as { code?: string }).code).toBe('TENANT_SCOPE_VIOLATION');
  });

  it('remove membro e revoga sessões', async () => {
    const { membership: adminMembership, tenant } = await setupAdminUser(
      'remove.admin@empresa.com',
      'senha-segura-123',
      'tenant_remove',
    );
    const user = await createTestUser('remove.member@empresa.com', 'senha-segura-123');
    const target = await createTestMembership(user.id, tenant.id, 'active');
    await setMembershipRoles(target.id, ['user']);

    const { token: adminToken } = await loginUser(
      app,
      'remove.admin@empresa.com',
      'senha-segura-123',
      cookieName,
    );
    await app.inject({
      method: 'POST',
      url: '/auth/select-tenant',
      headers: { cookie: `${cookieName}=${adminToken}` },
      payload: { membershipId: adminMembership.id },
    });

    const { token: memberToken } = await loginUser(
      app,
      'remove.member@empresa.com',
      'senha-segura-123',
      cookieName,
    );
    await app.inject({
      method: 'POST',
      url: '/auth/select-tenant',
      headers: { cookie: `${cookieName}=${memberToken}` },
      payload: { membershipId: target.id },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/auth/admin/members/${target.id}/remove`,
      headers: { cookie: `${cookieName}=${adminToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect((response.json() as { membership: { status: string } }).membership.status).toBe('removed');

    const sessionCheck = await app.inject({
      method: 'GET',
      url: '/auth/session',
      headers: { cookie: `${cookieName}=${memberToken}` },
    });
    const sessionBody = sessionCheck.json() as { activeMembership?: null | object };
    expect(sessionBody.activeMembership ?? null).toBeNull();
  });

  // Listar tenants é operação de plataforma. Não existe mais sessão humana que a execute: a fase 2
  // a recria sob chave interna auditada. Até lá, negação explícita para qualquer ator.
  it('ninguém lista tenants por sessão — operação de plataforma nega sempre', async () => {
    const { membership: adminMembership } = await setupAdminUser(
      'admin.tenants@empresa.com',
      'senha-segura-123',
      'tenant_lista',
    );
    await createTestTenant('tenant_extra');

    const { token } = await loginUser(app, 'admin.tenants@empresa.com', 'senha-segura-123', cookieName);
    await app.inject({
      method: 'POST',
      url: '/auth/select-tenant',
      headers: { cookie: `${cookieName}=${token}` },
      payload: { membershipId: adminMembership.id },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/auth/admin/tenants',
      headers: { cookie: `${cookieName}=${token}` },
    });

    expect(response.statusCode).toBe(403);
  });

  it('company_admin não lista tenants', async () => {
    await setupAdminUser('company.only@empresa.com', 'senha-segura-123', 'tenant_company_only');
    const { token } = await loginUser(app, 'company.only@empresa.com', 'senha-segura-123', cookieName);

    const response = await app.inject({
      method: 'GET',
      url: '/auth/admin/tenants',
      headers: { cookie: `${cookieName}=${token}` },
    });

    expect(response.statusCode).toBe(403);
  });

  it('soft delete de grupo sem membros', async () => {
    const { membership: adminMembership } = await setupAdminUser(
      'group.del@empresa.com',
      'senha-segura-123',
      'tenant_group_del',
    );
    await setupAccessGroups('tenant_group_del');

    const { token } = await loginUser(app, 'group.del@empresa.com', 'senha-segura-123', cookieName);
    await app.inject({
      method: 'POST',
      url: '/auth/select-tenant',
      headers: { cookie: `${cookieName}=${token}` },
      payload: { membershipId: adminMembership.id },
    });

    const createRes = await app.inject({
      method: 'POST',
      url: '/auth/admin/access-groups',
      headers: { cookie: `${cookieName}=${token}` },
      payload: { slug: 'temp', name: 'Temporário' },
    });
    const groupId = (createRes.json() as { group: { groupId: string } }).group.groupId;

    const response = await app.inject({
      method: 'DELETE',
      url: `/auth/admin/access-groups/${groupId}`,
      headers: { cookie: `${cookieName}=${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect((response.json() as { group: { status: string } }).group.status).toBe('deleted');
  });

  it('usuário solicita exclusão de conta', async () => {
    await createTestUser('delete.me@empresa.com', 'senha-segura-123');
    const { token } = await loginUser(app, 'delete.me@empresa.com', 'senha-segura-123', cookieName);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/account/request-deletion',
      headers: { cookie: `${cookieName}=${token}` },
      payload: { reason: 'Não uso mais' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { ok: boolean; requestId: string };
    expect(body.ok).toBe(true);
    expect(body.requestId).toBeTruthy();

    const count = await prisma.authAccountDeletionRequest.count();
    expect(count).toBe(1);
  });

  // Desativar usuário é operação de plataforma (mesma família de anonimização LGPD e revogação de
  // sessão). Sai do modelo de sessão nesta fase e volta na fase 2 por chave interna auditada.
  it('desativar usuário é operação de plataforma — nega por sessão', async () => {
    const { membership: adminMembership, user: adminUser } = await setupAdminUser(
      'admin.deact@empresa.com',
      'senha-segura-123',
      'tenant_deact',
    );
    const target = await createTestUser('deact.target@empresa.com', 'senha-segura-123');

    const { token } = await loginUser(app, 'admin.deact@empresa.com', 'senha-segura-123', cookieName);
    await app.inject({
      method: 'POST',
      url: '/auth/select-tenant',
      headers: { cookie: `${cookieName}=${token}` },
      payload: { membershipId: adminMembership.id },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/auth/admin/users/${target.id}/deactivate`,
      headers: { cookie: `${cookieName}=${token}` },
    });

    expect(response.statusCode).toBe(403);
    expect(adminUser.id).not.toBe(target.id);
  });

  it('login atualiza lastLoginAt', async () => {
    const user = await createTestUser('login.track@empresa.com', 'senha-segura-123');
    expect(user.lastLoginAt).toBeNull();

    await loginUser(app, 'login.track@empresa.com', 'senha-segura-123', cookieName);

    const updated = await prisma.authUser.findUnique({ where: { id: user.id } });
    expect(updated?.lastLoginAt).not.toBeNull();
  });
});
