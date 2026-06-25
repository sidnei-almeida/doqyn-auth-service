import { describe, it, expect } from 'vitest';
import { prisma } from '../src/db/prisma.js';
import {
  createTestMembership,
  createTestTenant,
  createTestUser,
} from './helpers.js';
import { approveMembership } from '../src/modules/admin/admin.service.js';
import {
  findMembershipById,
  setMembershipRoles,
} from '../src/modules/memberships/memberships.service.js';

describe('memberships', () => {
  it('criar membership pending', async () => {
    const user = await createTestUser('pending@empresa.com', 'senha-segura-123');
    const tenant = await createTestTenant('pending_tenant');
    const membership = await createTestMembership(user.id, tenant.id, 'pending');
    expect(membership.status).toBe('pending');
  });

  it('aprovar membership', async () => {
    const admin = await createTestUser('admin@empresa.com', 'senha-segura-123');
    const tenant = await createTestTenant('approve_tenant');
    const adminMembership = await createTestMembership(admin.id, tenant.id, 'active');
    await setMembershipRoles(adminMembership.id, ['company_admin']);

    const user = await createTestUser('user@empresa.com', 'senha-segura-123');
    const target = await createTestMembership(user.id, tenant.id, 'pending');

    const result = await approveMembership(
      {
        userId: admin.id,
        membership: {
          membershipId: adminMembership.id,
          tenantId: 'approve_tenant',
          tenantType: 'business',
          tenantDisplayName: 'approve_tenant',
          status: 'active',
          roles: ['company_admin'],
          accessGroupIds: [],
        },
      },
      target.id,
      { roles: ['user'], accessGroupIds: [] },
    );

    expect(result.status).toBe('active');
  });

  it('rejeitar membership', async () => {
    const user = await createTestUser('reject@empresa.com', 'senha-segura-123');
    const tenant = await createTestTenant('reject_tenant');
    const membership = await createTestMembership(user.id, tenant.id, 'pending');

    await prisma.authMembership.update({
      where: { id: membership.id },
      data: { status: 'rejected' },
    });

    const updated = await findMembershipById(membership.id);
    expect(updated?.status).toBe('rejected');
  });

  it('bloquear membership', async () => {
    const user = await createTestUser('block@empresa.com', 'senha-segura-123');
    const tenant = await createTestTenant('block_tenant');
    const membership = await createTestMembership(user.id, tenant.id, 'active');

    await prisma.authMembership.update({
      where: { id: membership.id },
      data: { status: 'blocked', blockedAt: new Date() },
    });

    const updated = await findMembershipById(membership.id);
    expect(updated?.status).toBe('blocked');
  });

  it('userId + tenantId unique', async () => {
    const user = await createTestUser('unique@empresa.com', 'senha-segura-123');
    const tenant = await createTestTenant('unique_tenant');
    await createTestMembership(user.id, tenant.id);
    await expect(createTestMembership(user.id, tenant.id)).rejects.toThrow();
  });
});
