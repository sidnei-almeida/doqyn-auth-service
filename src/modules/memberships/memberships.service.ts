import type {
  AuthAccessGroup,
  AuthMembership,
  AuthMembershipRole,
  AuthTenant,
  TenantRole,
} from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { decryptField } from '../../security/crypto.js';
import type { MembershipSummary, PublicMembership } from './memberships.schemas.js';

type MembershipWithRelations = AuthMembership & {
  tenant: AuthTenant;
  roles: AuthMembershipRole[];
  accessGroupLinks: Array<{
    accessGroup: AuthAccessGroup;
  }>;
};

/** Retorna groupIds apenas de grupos com status active (contexto de acesso efetivo). */
export function getActiveAccessGroupIds(
  links: MembershipWithRelations['accessGroupLinks'],
): string[] {
  return links
    .filter((l) => l.accessGroup.status === 'active')
    .map((l) => l.accessGroup.groupId);
}

export function toPublicMembership(membership: MembershipWithRelations): PublicMembership {
  return {
    membershipId: membership.id,
    tenantId: membership.tenant.tenantId,
    tenantType: membership.tenant.tenantType,
    tenantDisplayName: membership.tenant.displayNameEncrypted
      ? decryptField(membership.tenant.displayNameEncrypted)
      : null,
    status: membership.status,
    roles: membership.roles.map((r) => r.role),
    accessGroupIds: getActiveAccessGroupIds(membership.accessGroupLinks),
  };
}

export function toMembershipSummary(membership: MembershipWithRelations): MembershipSummary {
  const full = toPublicMembership(membership);
  return {
    membershipId: full.membershipId,
    tenantId: full.tenantId,
    tenantType: full.tenantType,
    tenantDisplayName: full.tenantDisplayName,
    status: full.status,
  };
}

const membershipInclude = {
  tenant: true,
  roles: true,
  accessGroupLinks: { include: { accessGroup: true } },
} as const;

export async function findMembershipById(id: string): Promise<MembershipWithRelations | null> {
  return prisma.authMembership.findUnique({
    where: { id },
    include: membershipInclude,
  });
}

export async function findMembershipByUserAndTenantTextId(
  userId: string,
  tenantTextId: string,
): Promise<MembershipWithRelations | null> {
  const tenant = await prisma.authTenant.findUnique({ where: { tenantId: tenantTextId } });
  if (!tenant) return null;

  return prisma.authMembership.findUnique({
    where: { userId_tenantId: { userId, tenantId: tenant.id } },
    include: membershipInclude,
  });
}

export async function listUserMemberships(userId: string): Promise<MembershipWithRelations[]> {
  return prisma.authMembership.findMany({
    where: { userId },
    include: membershipInclude,
    orderBy: { createdAt: 'asc' },
  });
}

export async function createDefaultNotificationPreferences(membershipId: string): Promise<void> {
  await prisma.authNotificationPreference.upsert({
    where: { membershipId },
    create: { membershipId },
    update: {},
  });
}

export async function setMembershipRoles(
  membershipId: string,
  roles: TenantRole[],
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.authMembershipRole.deleteMany({ where: { membershipId } });
    if (roles.length > 0) {
      await tx.authMembershipRole.createMany({
        data: roles.map((role) => ({ membershipId, role })),
      });
    }
  });
}

export async function setMembershipAccessGroups(
  membershipId: string,
  tenantUuid: string,
  groupIds: string[],
): Promise<void> {
  const groups = await prisma.authAccessGroup.findMany({
    where: { tenantId: tenantUuid, groupId: { in: groupIds }, status: 'active' },
  });

  await prisma.$transaction(async (tx) => {
    await tx.authMembershipAccessGroup.deleteMany({ where: { membershipId } });
    if (groups.length > 0) {
      await tx.authMembershipAccessGroup.createMany({
        data: groups.map((g) => ({ membershipId, accessGroupId: g.id })),
      });
    }
  });
}

export function hasAdminRole(roles: TenantRole[]): boolean {
  return roles.some((r) => ['company_admin', 'individual_admin'].includes(r));
}

/**
 * Não existe mais papel que escape do próprio tenant, então qualquer papel concedível é concedível
 * por quem já é admin do tenant. O ramo especial que existia aqui protegia o papel administrativo
 * global — eliminado do produto — e sumiu junto com ele.
 */
export function canGrantRole(actorRoles: TenantRole[], _targetRole: TenantRole): boolean {
  return hasAdminRole(actorRoles);
}
