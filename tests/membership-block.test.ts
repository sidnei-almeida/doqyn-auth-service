import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';
import { hashSessionToken } from '../src/security/crypto.js';
import { getSessionCookieName } from '../src/security/cookies.js';
import {
  assignRoles,
  createTestMembership,
  createTestTenant,
  createTestUser,
  loginUser,
  setupAdminUser,
} from './helpers.js';
import { TEST_ENV } from './setup.js';

const cookieName = getSessionCookieName();

async function selectTenant(
  app: FastifyInstance,
  token: string,
  membershipId: string,
): Promise<void> {
  await app.inject({
    method: 'POST',
    url: '/auth/select-tenant',
    headers: { cookie: `${cookieName}=${token}` },
    payload: { membershipId },
  });
}

async function createActiveSession(userId: string, membershipId: string): Promise<string> {
  const token = `test-${randomUUID()}`;
  await prisma.authSession.create({
    data: {
      userId,
      sessionTokenHash: hashSessionToken(token),
      activeMembershipId: membershipId,
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  return token;
}

describe('membership block/unblock', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST block com {} funciona', async () => {
    const { membership: adminMembership, tenant } = await setupAdminUser(
      'admin.block@empresa.com',
      'senha-segura-123',
      'tenant_block_ok',
    );
    const user = await createTestUser('blocked@empresa.com', 'senha-segura-123');
    const target = await createTestMembership(user.id, tenant.id, 'active');
    await assignRoles(target.id, ['user']);

    const { token } = await loginUser(app, 'admin.block@empresa.com', 'senha-segura-123', cookieName);
    await selectTenant(app, token, adminMembership.id);

    const response = await app.inject({
      method: 'POST',
      url: `/auth/admin/members/${target.id}/block`,
      headers: { cookie: `${cookieName}=${token}` },
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect((response.json() as { membership: { status: string } }).membership.status).toBe('blocked');

    const stored = await prisma.authMembership.findUnique({ where: { id: target.id } });
    expect(stored?.status).toBe('blocked');
    expect(stored?.blockedAt).toBeTruthy();
    expect(stored?.blockedByMembershipId).toBe(adminMembership.id);
  });

  it('POST block sem body funciona após parser tolerante', async () => {
    const { membership: adminMembership, tenant } = await setupAdminUser(
      'admin.block.nobody@empresa.com',
      'senha-segura-123',
      'tenant_block_nobody',
    );
    const user = await createTestUser('nobody@empresa.com', 'senha-segura-123');
    const target = await createTestMembership(user.id, tenant.id, 'active');
    await assignRoles(target.id, ['user']);

    const { token } = await loginUser(app, 'admin.block.nobody@empresa.com', 'senha-segura-123', cookieName);
    await selectTenant(app, token, adminMembership.id);

    const response = await app.inject({
      method: 'POST',
      url: `/auth/admin/members/${target.id}/block`,
      headers: {
        cookie: `${cookieName}=${token}`,
        'content-type': 'application/json',
      },
    });

    expect(response.statusCode).toBe(200);
    expect((response.json() as { membership: { status: string } }).membership.status).toBe('blocked');
  });

  it('POST block com reason audita metadata', async () => {
    const { membership: adminMembership, tenant } = await setupAdminUser(
      'admin.block.reason@empresa.com',
      'senha-segura-123',
      'tenant_block_reason',
    );
    const user = await createTestUser('reason@empresa.com', 'senha-segura-123');
    const target = await createTestMembership(user.id, tenant.id, 'active');
    await assignRoles(target.id, ['user']);

    const { token } = await loginUser(app, 'admin.block.reason@empresa.com', 'senha-segura-123', cookieName);
    await selectTenant(app, token, adminMembership.id);

    const response = await app.inject({
      method: 'POST',
      url: `/auth/admin/members/${target.id}/block`,
      headers: { cookie: `${cookieName}=${token}` },
      payload: { reason: 'Acesso suspenso temporariamente' },
    });

    expect(response.statusCode).toBe(200);

    const audit = await prisma.authAuditLog.findFirst({
      where: { action: 'membership.blocked', targetMembershipId: target.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).toBeTruthy();
    const metadata = audit?.metadata as { reason?: string; revokedSessionsCount?: number };
    expect(metadata.reason).toBe('Acesso suspenso temporariamente');
    expect(typeof metadata.revokedSessionsCount).toBe('number');
  });

  it('block revoga sessões com activeMembershipId alvo', async () => {
    const { membership: adminMembership, tenant } = await setupAdminUser(
      'admin.block.sessions@empresa.com',
      'senha-segura-123',
      'tenant_block_sessions',
    );
    const user = await createTestUser('sessions@empresa.com', 'senha-segura-123');
    const target = await createTestMembership(user.id, tenant.id, 'active');
    await assignRoles(target.id, ['user']);
    await createActiveSession(user.id, target.id);

    const { token } = await loginUser(app, 'admin.block.sessions@empresa.com', 'senha-segura-123', cookieName);
    await selectTenant(app, token, adminMembership.id);

    const response = await app.inject({
      method: 'POST',
      url: `/auth/admin/members/${target.id}/block`,
      headers: { cookie: `${cookieName}=${token}` },
      payload: {},
    });

    expect(response.statusCode).toBe(200);

    const sessions = await prisma.authSession.findMany({ where: { userId: user.id } });
    expect(sessions.every((session) => session.revokedAt !== null)).toBe(true);
  });

  it('block não desativa usuário globalmente', async () => {
    const { membership: adminMembership, tenant } = await setupAdminUser(
      'admin.block.user@empresa.com',
      'senha-segura-123',
      'tenant_block_user',
    );
    const user = await createTestUser('global@empresa.com', 'senha-segura-123');
    const target = await createTestMembership(user.id, tenant.id, 'active');
    await assignRoles(target.id, ['user']);

    const { token } = await loginUser(app, 'admin.block.user@empresa.com', 'senha-segura-123', cookieName);
    await selectTenant(app, token, adminMembership.id);

    await app.inject({
      method: 'POST',
      url: `/auth/admin/members/${target.id}/block`,
      headers: { cookie: `${cookieName}=${token}` },
      payload: {},
    });

    const storedUser = await prisma.authUser.findUnique({ where: { id: user.id } });
    expect(storedUser?.status).toBe('active');
    const credential = await prisma.authCredential.findUnique({ where: { userId: user.id } });
    expect(credential).toBeTruthy();
  });

  it('block não afeta membership de outro tenant', async () => {
    const { membership: adminMembership, tenant } = await setupAdminUser(
      'admin.block.other@empresa.com',
      'senha-segura-123',
      'tenant_block_primary',
    );
    const otherTenant = await createTestTenant('tenant_block_secondary');
    const user = await createTestUser('multi@empresa.com', 'senha-segura-123');
    const target = await createTestMembership(user.id, tenant.id, 'active');
    const otherMembership = await createTestMembership(user.id, otherTenant.id, 'active');
    await assignRoles(target.id, ['user']);
    await assignRoles(otherMembership.id, ['user']);

    const { token } = await loginUser(app, 'admin.block.other@empresa.com', 'senha-segura-123', cookieName);
    await selectTenant(app, token, adminMembership.id);

    await app.inject({
      method: 'POST',
      url: `/auth/admin/members/${target.id}/block`,
      headers: { cookie: `${cookieName}=${token}` },
      payload: {},
    });

    const other = await prisma.authMembership.findUnique({ where: { id: otherMembership.id } });
    expect(other?.status).toBe('active');
  });

  it('company_admin não bloqueia membership de outro tenant', async () => {
    await setupAdminUser('admin.scope@empresa.com', 'senha-segura-123', 'tenant_scope_a');
    const otherTenant = await createTestTenant('tenant_scope_b');
    const user = await createTestUser('scope@empresa.com', 'senha-segura-123');
    const target = await createTestMembership(user.id, otherTenant.id, 'active');
    await assignRoles(target.id, ['user']);

    const { token } = await loginUser(app, 'admin.scope@empresa.com', 'senha-segura-123', cookieName);

    const response = await app.inject({
      method: 'POST',
      url: `/auth/admin/members/${target.id}/block`,
      headers: { cookie: `${cookieName}=${token}` },
      payload: {},
    });

    expect(response.statusCode).toBe(403);
    expect((response.json() as { code?: string }).code).toBe('TENANT_SCOPE_VIOLATION');
  });

  it('company_admin não bloqueia a si mesmo', async () => {
    const { membership: adminMembership } = await setupAdminUser(
      'admin.self@empresa.com',
      'senha-segura-123',
      'tenant_self_block',
    );

    const { token } = await loginUser(app, 'admin.self@empresa.com', 'senha-segura-123', cookieName);
    await selectTenant(app, token, adminMembership.id);

    const response = await app.inject({
      method: 'POST',
      url: `/auth/admin/members/${adminMembership.id}/block`,
      headers: { cookie: `${cookieName}=${token}` },
      payload: {},
    });

    expect(response.statusCode).toBe(403);
  });

  it('bloqueio do último admin retorna LAST_ADMIN_PROTECTION', async () => {
    const { membership: doqynMembership } = await setupAdminUser(
      'doqyn.block@empresa.com',
      'senha-segura-123',
      'tenant_doqyn_admin_home',
      ['doqyn_admin'],
    );
    const tenant = await createTestTenant('tenant_solo_admin');
    const soloAdminUser = await createTestUser('solo@empresa.com', 'senha-segura-123');
    const target = await createTestMembership(soloAdminUser.id, tenant.id, 'active');
    await assignRoles(target.id, ['company_admin']);

    const { token } = await loginUser(app, 'doqyn.block@empresa.com', 'senha-segura-123', cookieName);
    await selectTenant(app, token, doqynMembership.id);

    const response = await app.inject({
      method: 'POST',
      url: `/auth/admin/members/${target.id}/block`,
      headers: { cookie: `${cookieName}=${token}` },
      payload: {},
    });

    expect(response.statusCode).toBe(409);
    expect((response.json() as { code?: string }).code).toBe('LAST_ADMIN_PROTECTION');
  });

  it('block idempotente quando já está blocked', async () => {
    const { membership: adminMembership, tenant } = await setupAdminUser(
      'admin.idempotent@empresa.com',
      'senha-segura-123',
      'tenant_block_idempotent',
    );
    const user = await createTestUser('idem@empresa.com', 'senha-segura-123');
    const target = await createTestMembership(user.id, tenant.id, 'blocked');
    await assignRoles(target.id, ['user']);

    const { token } = await loginUser(app, 'admin.idempotent@empresa.com', 'senha-segura-123', cookieName);
    await selectTenant(app, token, adminMembership.id);

    const response = await app.inject({
      method: 'POST',
      url: `/auth/admin/members/${target.id}/block`,
      headers: { cookie: `${cookieName}=${token}` },
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect((response.json() as { membership: { status: string } }).membership.status).toBe('blocked');
  });

  it('unblock blocked membership volta para active', async () => {
    const { membership: adminMembership, tenant } = await setupAdminUser(
      'admin.unblock@empresa.com',
      'senha-segura-123',
      'tenant_unblock',
    );
    const user = await createTestUser('unblock@empresa.com', 'senha-segura-123');
    const target = await createTestMembership(user.id, tenant.id, 'blocked');
    await assignRoles(target.id, ['user']);

    const { token } = await loginUser(app, 'admin.unblock@empresa.com', 'senha-segura-123', cookieName);
    await selectTenant(app, token, adminMembership.id);

    const response = await app.inject({
      method: 'POST',
      url: `/auth/admin/members/${target.id}/unblock`,
      headers: { cookie: `${cookieName}=${token}` },
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect((response.json() as { membership: { status: string } }).membership.status).toBe('active');

    const audit = await prisma.authAuditLog.findFirst({
      where: { action: 'membership.unblocked', targetMembershipId: target.id },
    });
    expect(audit).toBeTruthy();
  });

  it('unblock rejected não é permitido', async () => {
    const { membership: adminMembership, tenant } = await setupAdminUser(
      'admin.unblock.reject@empresa.com',
      'senha-segura-123',
      'tenant_unblock_reject',
    );
    const user = await createTestUser('reject@empresa.com', 'senha-segura-123');
    const target = await createTestMembership(user.id, tenant.id, 'rejected');

    const { token } = await loginUser(app, 'admin.unblock.reject@empresa.com', 'senha-segura-123', cookieName);
    await selectTenant(app, token, adminMembership.id);

    const response = await app.inject({
      method: 'POST',
      url: `/auth/admin/members/${target.id}/unblock`,
      headers: { cookie: `${cookieName}=${token}` },
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect((response.json() as { code?: string }).code).toBe('MEMBERSHIP_NOT_BLOCKED');
  });
});
