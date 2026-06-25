import type { AuthAccessGroup, AccessGroupStatus } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { decryptField, encryptField } from '../../security/crypto.js';
import {
  ConflictError,
  GroupNotActiveError,
  MembershipNotActiveError,
  NotFoundError,
} from '../../utils/errors.js';
import { slugify } from '../../utils/normalize.js';
import { findTenantByTextId } from '../tenants/tenants.service.js';

export interface PublicAccessGroup {
  id: string;
  groupId: string;
  slug: string;
  name: string;
  description: string | null;
  status: AccessGroupStatus;
  memberCount?: number;
  createdAt: string;
  updatedAt: string;
}

export function toPublicAccessGroup(
  group: AuthAccessGroup,
  memberCount?: number,
): PublicAccessGroup {
  return {
    id: group.id,
    groupId: group.groupId,
    slug: group.slug,
    name: decryptField(group.nameEncrypted),
    description: group.descriptionEncrypted ? decryptField(group.descriptionEncrypted) : null,
    status: group.status,
    memberCount,
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString(),
  };
}

export interface CreateAccessGroupInput {
  slug: string;
  name: string;
  description?: string;
}

export function buildGroupId(slug: string): string {
  const normalized = slugify(slug);
  return normalized.startsWith('group_') ? normalized : `group_${normalized}`;
}

export async function createAccessGroup(
  tenantTextId: string,
  input: CreateAccessGroupInput,
): Promise<PublicAccessGroup> {
  const tenant = await findTenantByTextId(tenantTextId);
  if (!tenant) throw new NotFoundError('Tenant não encontrado.');

  const slug = slugify(input.slug);
  const groupId = buildGroupId(slug);

  const group = await prisma.authAccessGroup.create({
    data: {
      tenantId: tenant.id,
      groupId,
      nameEncrypted: encryptField(input.name),
      slug,
      descriptionEncrypted: input.description ? encryptField(input.description) : null,
      status: 'active',
    },
  });

  return toPublicAccessGroup(group, 0);
}

export async function updateAccessGroup(
  tenantTextId: string,
  groupId: string,
  input: Partial<{ name: string; description: string; status: AccessGroupStatus }>,
): Promise<PublicAccessGroup> {
  const tenant = await findTenantByTextId(tenantTextId);
  if (!tenant) throw new NotFoundError('Tenant não encontrado.');

  const existing = await prisma.authAccessGroup.findUnique({
    where: { tenantId_groupId: { tenantId: tenant.id, groupId } },
  });
  if (!existing) throw new NotFoundError('Grupo não encontrado.');

  const group = await prisma.authAccessGroup.update({
    where: { id: existing.id },
    data: {
      nameEncrypted: input.name ? encryptField(input.name) : undefined,
      descriptionEncrypted:
        input.description !== undefined
          ? input.description
            ? encryptField(input.description)
            : null
          : undefined,
      status: input.status,
    },
  });

  const memberCount = await prisma.authMembershipAccessGroup.count({
    where: { accessGroupId: group.id },
  });

  return toPublicAccessGroup(group, memberCount);
}

export async function softDeleteAccessGroup(
  tenantTextId: string,
  groupId: string,
  deletedByMembershipId: string,
): Promise<PublicAccessGroup> {
  const tenant = await findTenantByTextId(tenantTextId);
  if (!tenant) throw new NotFoundError('Tenant não encontrado.');

  const existing = await prisma.authAccessGroup.findUnique({
    where: { tenantId_groupId: { tenantId: tenant.id, groupId } },
  });
  if (!existing) throw new NotFoundError('Grupo não encontrado.');

  const memberCount = await prisma.authMembershipAccessGroup.count({
    where: { accessGroupId: existing.id },
  });
  if (memberCount > 0) {
    throw new ConflictError(
      'Grupo possui membros vinculados. Remova os vínculos antes de excluir.',
      'GROUP_HAS_MEMBERS',
    );
  }

  const group = await prisma.authAccessGroup.update({
    where: { id: existing.id },
    data: {
      status: 'deleted',
      deletedAt: new Date(),
      deletedByMembershipId,
    },
  });

  return toPublicAccessGroup(group, 0);
}

export async function listAccessGroups(
  tenantTextId: string,
  filters?: { status?: AccessGroupStatus; search?: string },
): Promise<PublicAccessGroup[]> {
  const tenant = await findTenantByTextId(tenantTextId);
  if (!tenant) return [];

  const groups = await prisma.authAccessGroup.findMany({
    where: {
      tenantId: tenant.id,
      ...(filters?.status ? { status: filters.status } : {}),
    },
    orderBy: { groupId: 'asc' },
  });

  const results: PublicAccessGroup[] = [];
  for (const g of groups) {
    if (filters?.search) {
      const pub = toPublicAccessGroup(g);
      const q = filters.search.toLowerCase();
      if (
        !pub.name.toLowerCase().includes(q) &&
        !pub.slug.includes(q) &&
        !pub.groupId.includes(q)
      ) {
        continue;
      }
    }
    const memberCount = await prisma.authMembershipAccessGroup.count({
      where: { accessGroupId: g.id },
    });
    results.push(toPublicAccessGroup(g, memberCount));
  }
  return results;
}

export async function getAccessGroupOrThrow(tenantTextId: string, groupId: string) {
  const tenant = await findTenantByTextId(tenantTextId);
  if (!tenant) throw new NotFoundError('Tenant não encontrado.');
  const group = await prisma.authAccessGroup.findUnique({
    where: { tenantId_groupId: { tenantId: tenant.id, groupId } },
  });
  if (!group) throw new NotFoundError('Grupo não encontrado.');
  return { tenant, group };
}

export function assertGroupIsActive(group: AuthAccessGroup): void {
  if (group.status !== 'active') {
    throw new GroupNotActiveError();
  }
}

export async function addMemberToGroup(
  tenantTextId: string,
  groupId: string,
  membershipId: string,
): Promise<void> {
  const { tenant, group } = await getAccessGroupOrThrow(tenantTextId, groupId);
  assertGroupIsActive(group);

  const membership = await prisma.authMembership.findUnique({
    where: { id: membershipId },
  });
  if (!membership || membership.tenantId !== tenant.id) {
    throw new NotFoundError('Membership não encontrada neste tenant.');
  }
  if (membership.status !== 'active') {
    throw new MembershipNotActiveError();
  }

  await prisma.authMembershipAccessGroup.upsert({
    where: {
      membershipId_accessGroupId: { membershipId, accessGroupId: group.id },
    },
    create: { membershipId, accessGroupId: group.id },
    update: {},
  });
}

export async function removeMemberFromGroup(
  tenantTextId: string,
  groupId: string,
  membershipId: string,
): Promise<void> {
  const { tenant, group } = await getAccessGroupOrThrow(tenantTextId, groupId);
  const membership = await prisma.authMembership.findUnique({ where: { id: membershipId } });
  if (!membership || membership.tenantId !== tenant.id) {
    throw new NotFoundError('Membership não encontrada neste tenant.');
  }
  await prisma.authMembershipAccessGroup.deleteMany({
    where: { membershipId, accessGroupId: group.id },
  });
}

export async function listGroupMembers(tenantTextId: string, groupId: string) {
  const { tenant, group } = await getAccessGroupOrThrow(tenantTextId, groupId);
  const links = await prisma.authMembershipAccessGroup.findMany({
    where: { accessGroupId: group.id },
    include: {
      membership: {
        include: {
          tenant: true,
          roles: true,
          accessGroupLinks: { include: { accessGroup: true } },
        },
      },
    },
  });
  const { toPublicMembership } = await import('../memberships/memberships.service.js');
  return links
    .filter((l) => l.membership.tenantId === tenant.id)
    .map((l) => toPublicMembership(l.membership));
}
