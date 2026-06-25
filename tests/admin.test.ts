import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
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

describe('admin', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('company_admin aprova usuário do próprio tenant', async () => {
    const { membership: adminMembership, tenant } = await setupAdminUser(
      'admin.approve@empresa.com',
      'senha-segura-123',
      'tenant_a',
    );
    await setupAccessGroups('tenant_a');

    const user = await createTestUser('aprovado@empresa.com', 'senha-segura-123');
    const target = await createTestMembership(user.id, tenant.id, 'pending');
    await prismaAccessRequest(target.id, user.id, tenant.id);

    const { token } = await loginUser(app, 'admin.approve@empresa.com', 'senha-segura-123', cookieName);

    await app.inject({
      method: 'POST',
      url: '/auth/select-tenant',
      headers: { cookie: `${cookieName}=${token}` },
      payload: { membershipId: adminMembership.id },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/auth/admin/members/${target.id}/approve`,
      headers: { cookie: `${cookieName}=${token}` },
      payload: { roles: ['user'], accessGroupIds: ['group_financeiro'] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().membership.status).toBe('active');
  });

  it('company_admin não aprova usuário de outro tenant', async () => {
    await setupAdminUser('admin.other@empresa.com', 'senha-segura-123', 'tenant_b');

    const user = await createTestUser('outro@empresa.com', 'senha-segura-123');
    const otherTenant = await createTestTenant('tenant_c');
    const target = await createTestMembership(user.id, otherTenant.id, 'pending');

    const { token } = await loginUser(app, 'admin.other@empresa.com', 'senha-segura-123', cookieName);

    const response = await app.inject({
      method: 'POST',
      url: `/auth/admin/members/${target.id}/approve`,
      headers: { cookie: `${cookieName}=${token}` },
      payload: { roles: ['user'], accessGroupIds: [] },
    });

    expect(response.statusCode).toBe(403);
  });

  it('doqyn_admin aprova qualquer tenant', async () => {
    const { membership: adminMembership } = await setupAdminUser(
      'doqyn.admin@empresa.com',
      'senha-segura-123',
      'tenant_d',
      ['doqyn_admin'],
    );
    await setupAccessGroups('tenant_d');

    const otherTenant = await createTestTenant('tenant_e');
    await setupAccessGroups('tenant_e');
    const user = await createTestUser('any@empresa.com', 'senha-segura-123');
    const target = await createTestMembership(user.id, otherTenant.id, 'pending');

    const { token } = await loginUser(app, 'doqyn.admin@empresa.com', 'senha-segura-123', cookieName);

    await app.inject({
      method: 'POST',
      url: '/auth/select-tenant',
      headers: { cookie: `${cookieName}=${token}` },
      payload: { membershipId: adminMembership.id },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/auth/admin/members/${target.id}/approve`,
      headers: { cookie: `${cookieName}=${token}` },
      payload: { roles: ['user'], accessGroupIds: ['group_financeiro'] },
    });

    expect(response.statusCode).toBe(200);
  });

  it('user recebe 403 em admin endpoints', async () => {
    const user = await createTestUser('plain@empresa.com', 'senha-segura-123');
    const tenant = await createTestTenant('tenant_f');
    const membership = await createTestMembership(user.id, tenant.id, 'active');
    await setMembershipRoles(membership.id, ['user']);

    const { token } = await loginUser(app, 'plain@empresa.com', 'senha-segura-123', cookieName);

    const response = await app.inject({
      method: 'GET',
      url: '/auth/admin/members',
      headers: { cookie: `${cookieName}=${token}` },
    });

    expect(response.statusCode).toBe(403);
  });
});

async function prismaAccessRequest(membershipId: string, userId: string, tenantId: string) {
  const { prisma } = await import('../src/db/prisma.js');
  await prisma.authAccessRequest.create({
    data: {
      userId,
      tenantId,
      membershipId,
      status: 'pending',
      personType: 'business',
      taxIdType: 'cnpj',
      taxIdMasked: '**.***.***/****-99',
    },
  });
}
