import { describe, it, expect } from 'vitest';
import { prisma } from '../src/db/prisma.js';
import { createAccessGroup, listAccessGroups } from '../src/modules/access-groups/accessGroups.service.js';
import { createTestTenant, createTestUser, createTestMembership } from './helpers.js';

describe('isolamento de access groups por tenant', () => {
  it('tenant novo nasce com 0 access groups', async () => {
    const tenant = await createTestTenant('tenant_zero_groups_a');
    const count = await prisma.authAccessGroup.count({ where: { tenantId: tenant.id } });
    expect(count).toBe(0);

    const listed = await listAccessGroups(tenant.tenantId);
    expect(listed).toEqual([]);
  });

  it('empresa A cria grupo Financeiro e empresa B não vê esse grupo', async () => {
    const tenantA = await createTestTenant('tenant_iso_a');
    const tenantB = await createTestTenant('tenant_iso_b');

    await createAccessGroup(tenantA.tenantId, { slug: 'financeiro', name: 'Financeiro' });

    const groupsA = await listAccessGroups(tenantA.tenantId);
    const groupsB = await listAccessGroups(tenantB.tenantId);

    expect(groupsA.map((group) => group.name)).toEqual(['Financeiro']);
    expect(groupsB).toEqual([]);
  });

  it('membros de A não aparecem na listagem de membros de B', async () => {
    const tenantA = await createTestTenant('tenant_members_a');
    const tenantB = await createTestTenant('tenant_members_b');

    const userA = await createTestUser('member-a@empresa.com', 'senha-segura-123');
    await createTestMembership(userA.id, tenantA.id, 'active');

    const membersA = await prisma.authMembership.count({ where: { tenantId: tenantA.id } });
    const membersB = await prisma.authMembership.count({ where: { tenantId: tenantB.id } });

    expect(membersA).toBe(1);
    expect(membersB).toBe(0);
  });

  it('listAccessGroups filtra por tenant ativo', async () => {
    const tenantA = await createTestTenant('tenant_filter_a');
    const tenantB = await createTestTenant('tenant_filter_b');

    await createAccessGroup(tenantA.tenantId, { slug: 'compras', name: 'Compras' });
    await createAccessGroup(tenantB.tenantId, { slug: 'rh', name: 'RH' });

    const groupsA = await listAccessGroups(tenantA.tenantId);
    const groupsB = await listAccessGroups(tenantB.tenantId);

    expect(groupsA.map((group) => group.slug)).toEqual(['compras']);
    expect(groupsB.map((group) => group.slug)).toEqual(['rh']);
  });
});
