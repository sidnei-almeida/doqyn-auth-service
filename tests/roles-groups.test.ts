import { describe, it, expect } from 'vitest';
import { prisma } from '../src/db/prisma.js';
import { createAccessGroup } from '../src/modules/access-groups/accessGroups.service.js';
import {
  setMembershipAccessGroups,
  setMembershipRoles,
} from '../src/modules/memberships/memberships.service.js';
import { canGrantRole } from '../src/modules/memberships/memberships.service.js';
import {
  createTestMembership,
  createTestTenant,
  createTestUser,
  linkMembershipToGroups,
  setupAccessGroups,
} from './helpers.js';

describe('roles', () => {
  it('adicionar role', async () => {
    const user = await createTestUser('role@empresa.com', 'senha-segura-123');
    const tenant = await createTestTenant('role_tenant');
    const membership = await createTestMembership(user.id, tenant.id, 'active');
    await setMembershipRoles(membership.id, ['user', 'company_admin']);

    const roles = await prisma.authMembershipRole.findMany({ where: { membershipId: membership.id } });
    expect(roles.map((r) => r.role).sort()).toEqual(['company_admin', 'user']);
  });

  it('não duplicar role', async () => {
    const user = await createTestUser('duprole@empresa.com', 'senha-segura-123');
    const tenant = await createTestTenant('duprole_tenant');
    const membership = await createTestMembership(user.id, tenant.id, 'active');
    await setMembershipRoles(membership.id, ['user']);
    await setMembershipRoles(membership.id, ['user']);
    const count = await prisma.authMembershipRole.count({ where: { membershipId: membership.id } });
    expect(count).toBe(1);
  });

  it('company_admin não concede doqyn_admin', () => {
    expect(canGrantRole(['company_admin'], 'doqyn_admin')).toBe(false);
    expect(canGrantRole(['doqyn_admin'], 'doqyn_admin')).toBe(true);
  });

  it('user não aprova ninguém', () => {
    expect(canGrantRole(['user'], 'user')).toBe(false);
  });
});

describe('access groups', () => {
  it('criar grupo', async () => {
    await createTestTenant('group_tenant');
    const group = await createAccessGroup('group_tenant', {
      slug: 'financeiro',
      name: 'Financeiro',
    });
    expect(group.groupId).toBe('group_financeiro');
  });

  it('não duplicar groupId no mesmo tenant', async () => {
    await createTestTenant('dup_group_tenant');
    await createAccessGroup('dup_group_tenant', { slug: 'a', name: 'A' });
    await expect(
      createAccessGroup('dup_group_tenant', { slug: 'a', name: 'B' }),
    ).rejects.toThrow();
  });

  it('associar membership a grupo', async () => {
    const user = await createTestUser('groupuser@empresa.com', 'senha-segura-123');
    const tenant = await createTestTenant('assoc_tenant');
    const membership = await createTestMembership(user.id, tenant.id, 'active');
    await setupAccessGroups('assoc_tenant');
    await linkMembershipToGroups(membership.id, tenant.id, ['group_financeiro']);

    const links = await prisma.authMembershipAccessGroup.findMany({
      where: { membershipId: membership.id },
      include: { accessGroup: true },
    });
    expect(links[0]?.accessGroup.groupId).toBe('group_financeiro');
  });

  it('remover associação', async () => {
    const user = await createTestUser('unlink@empresa.com', 'senha-segura-123');
    const tenant = await createTestTenant('unlink_tenant');
    const membership = await createTestMembership(user.id, tenant.id, 'active');
    await setupAccessGroups('unlink_tenant');
    await linkMembershipToGroups(membership.id, tenant.id, ['group_financeiro']);
    await setMembershipAccessGroups(membership.id, tenant.id, []);
    const count = await prisma.authMembershipAccessGroup.count({ where: { membershipId: membership.id } });
    expect(count).toBe(0);
  });
});
