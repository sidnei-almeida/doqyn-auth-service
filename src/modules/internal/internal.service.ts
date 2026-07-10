import { NotFoundError } from '../../utils/errors.js';
import { decryptField } from '../../security/crypto.js';
import { prisma } from '../../db/prisma.js';
import { logAuthAudit } from '../audit/authAudit.service.js';
import { buildVerifiedSessionContext } from '../memberships/sessionContext.service.js';
import {
  findMembershipById,
  getActiveAccessGroupIds,
  toPublicMembership,
} from '../memberships/memberships.service.js';
import { revokeAllUserSessions, validateSessionByToken } from '../sessions/sessions.service.js';
import {
  createOrGetUser,
  disableUser,
  enableUser,
  findUserByEmailLookup,
  getUserAvatarMetadata,
  toPublicUser,
  updateUserAvatarMetadata,
  type UpdateUserAvatarMetadataInput,
} from '../users/users.service.js';
import type { CreateUserInput } from '../users/users.service.js';
import type { PublicUser } from '../users/users.schemas.js';
import {
  findTenantByTextId,
  listAccessGroupsByTenantTextId,
  toPublicTenant,
} from '../tenants/tenants.service.js';

export async function internalCreateUser(input: CreateUserInput): Promise<PublicUser> {
  const user = await createOrGetUser(input);
  await logAuthAudit('user.created', { userId: user.id });
  return user;
}

export async function internalDisableUser(userId: string): Promise<PublicUser> {
  const user = await disableUser(userId);
  await revokeAllUserSessions(userId);
  await logAuthAudit('user.disabled', { userId });
  return user;
}

export async function internalEnableUser(userId: string): Promise<PublicUser> {
  const user = await enableUser(userId);
  await logAuthAudit('user.enabled', { userId });
  return user;
}

export async function internalFindUserByEmail(email: string): Promise<PublicUser | null> {
  const user = await findUserByEmailLookup(email);
  return user ? toPublicUser(user) : null;
}

export async function internalVerifySession(sessionToken: string) {
  const result = await validateSessionByToken(sessionToken);
  if (!result.valid) {
    return { ok: false as const, code: result.code };
  }

  const verified = await buildVerifiedSessionContext(result.user, sessionToken);
  if (!verified.ok) {
    return { ok: false as const, code: verified.code };
  }

  return {
    ok: true as const,
    user: verified.user,
    activeMembership: verified.activeMembership,
    memberships: verified.memberships,
  };
}

export async function internalGetUserOrThrow(userId: string): Promise<PublicUser> {
  const { findUserById } = await import('../users/users.service.js');
  const user = await findUserById(userId);
  if (!user) {
    throw new NotFoundError('Usuário não encontrado.');
  }
  return toPublicUser(user);
}

export async function internalGetTenant(tenantTextId: string) {
  const tenant = await findTenantByTextId(tenantTextId);
  if (!tenant) {
    throw new NotFoundError('Tenant não encontrado.');
  }
  return toPublicTenant(tenant);
}

export async function internalGetTenantAccessGroups(tenantTextId: string) {
  const groups = await listAccessGroupsByTenantTextId(tenantTextId);
  if (groups.length === 0) {
    const tenant = await findTenantByTextId(tenantTextId);
    if (!tenant) {
      throw new NotFoundError('Tenant não encontrado.');
    }
  }
  return groups;
}

export async function internalGetMembership(membershipId: string) {
  const membership = await findMembershipById(membershipId);
  if (!membership) {
    throw new NotFoundError('Membership não encontrada.');
  }
  return toPublicMembership(membership);
}

export async function internalUpdateUserAvatarMetadata(
  userId: string,
  input: UpdateUserAvatarMetadataInput,
) {
  const { findUserById } = await import('../users/users.service.js');
  const existing = await findUserById(userId);
  if (!existing) {
    throw new NotFoundError('Usuário não encontrado.');
  }

  const user = await updateUserAvatarMetadata(userId, input);
  await logAuthAudit(
    input.status === 'removed' ? 'user.avatar_removed' : 'user.avatar_updated',
    { userId, metadata: { version: input.version } },
  );
  return user;
}

export async function internalGetUserAvatarMetadata(userId: string) {
  const metadata = await getUserAvatarMetadata(userId);
  if (!metadata) {
    throw new NotFoundError('Usuário não encontrado.');
  }
  return metadata;
}

export type InternalTenantMemberSnapshot = {
  membershipId: string;
  tenantId: string;
  userId: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  whatsapp?: string | null;
  status: 'active' | 'pending' | 'blocked' | 'rejected';
  tenantRoles: string[];
  accessGroupIds: string[];
  invitedBy?: string | null;
  approvedAt?: string | null;
  jobTitle?: string | null;
  departmentText?: string | null;
  source?: 'admin_invite' | 'access_request';
  createdAt: string;
  updatedAt: string;
};

export async function internalListTenantMembers(
  tenantTextId: string,
): Promise<InternalTenantMemberSnapshot[]> {
  const tenant = await findTenantByTextId(tenantTextId);
  if (!tenant) {
    throw new NotFoundError('Tenant não encontrado.');
  }

  const memberships = await prisma.authMembership.findMany({
    where: {
      tenantId: tenant.id,
      status: { in: ['active', 'pending', 'blocked'] },
    },
    include: {
      tenant: true,
      roles: true,
      accessGroupLinks: { include: { accessGroup: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const { findUserById } = await import('../users/users.service.js');
  const members: InternalTenantMemberSnapshot[] = [];

  for (const membership of memberships) {
    const user = await findUserById(membership.userId);
    if (!user) continue;

    const publicUser = toPublicUser(user);
    members.push({
      membershipId: membership.id,
      tenantId: tenant.tenantId,
      userId: user.id,
      email: publicUser.email,
      firstName: publicUser.firstName,
      lastName: publicUser.lastName,
      whatsapp: publicUser.whatsapp,
      status: membership.status === 'removed' ? 'rejected' : membership.status,
      tenantRoles: membership.roles.map((role) => role.role),
      accessGroupIds: getActiveAccessGroupIds(membership.accessGroupLinks),
      invitedBy: membership.approvedByMembershipId,
      approvedAt: membership.approvedAt?.toISOString() ?? null,
      jobTitle: membership.requestedJobTitleEncrypted
        ? decryptField(membership.requestedJobTitleEncrypted)
        : null,
      departmentText: membership.requestedDepartmentEncrypted
        ? decryptField(membership.requestedDepartmentEncrypted)
        : null,
      source: 'admin_invite',
      createdAt: membership.createdAt.toISOString(),
      updatedAt: membership.updatedAt.toISOString(),
    });
  }

  return members;
}

export async function internalBuildTenantMemberSnapshot(
  membershipId: string,
): Promise<InternalTenantMemberSnapshot | null> {
  const membership = await findMembershipById(membershipId);
  if (!membership) return null;

  const { findUserById } = await import('../users/users.service.js');
  const user = await findUserById(membership.userId);
  if (!user) return null;

  const publicUser = toPublicUser(user);

  return {
    membershipId: membership.id,
    tenantId: membership.tenant.tenantId,
    userId: user.id,
    email: publicUser.email,
    firstName: publicUser.firstName,
    lastName: publicUser.lastName,
    whatsapp: publicUser.whatsapp,
    status: membership.status === 'removed' ? 'rejected' : membership.status,
    tenantRoles: membership.roles.map((role) => role.role),
    accessGroupIds: getActiveAccessGroupIds(membership.accessGroupLinks),
    invitedBy: membership.approvedByMembershipId,
    approvedAt: membership.approvedAt?.toISOString() ?? null,
    jobTitle: membership.requestedJobTitleEncrypted
      ? decryptField(membership.requestedJobTitleEncrypted)
      : null,
    departmentText: membership.requestedDepartmentEncrypted
      ? decryptField(membership.requestedDepartmentEncrypted)
      : null,
    source: 'admin_invite',
    createdAt: membership.createdAt.toISOString(),
    updatedAt: membership.updatedAt.toISOString(),
  };
}
