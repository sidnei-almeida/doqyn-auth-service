import type { MembershipStatus, TenantRole } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { decryptField, encryptField } from '../../security/crypto.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { normalizeEmail } from '../../utils/normalize.js';
import {
  buildConsentFromRecord,
  buildNotificationPreferencesDto,
  buildRequestedAccessFromMembership,
  buildRequestedAccessFromRecord,
  serializeAdminAccessRequest,
} from '../access-requests/accessRequests.admin.js';
import { listTermsAcceptancesForAccessRequests } from '../terms/termsAcceptance.service.js';
import {
  auditCtx,
  logAuthAudit,
} from '../audit/authAudit.service.js';
import type { PublicMembership, MemberDetailResponse } from '../memberships/memberships.schemas.js';
import {
  findMembershipById,
  isDoqynAdmin,
  setMembershipAccessGroups,
  setMembershipRoles,
  toPublicMembership,
} from '../memberships/memberships.service.js';
import { revokeSessionsByActiveMembership } from '../sessions/sessionsRevoke.service.js';
import { findUserByEmailLookup, findUserById, toPublicUser } from '../users/users.service.js';
import {
  assertCanGrantRoles,
  assertCanManageMembership,
  assertLastAdminProtection,
  assertNotSelfSensitive,
  resolveTenantScope,
} from './adminAuthorization.js';
import type { AdminActor } from './admin.types.js';
import type { ApproveMembershipInput } from './admin.schemas.js';
import { scheduleTenantMemberSync } from '../../integrations/memberSync.js';

export interface ListMembersFilters {
  tenantId?: string;
  status?: MembershipStatus;
  role?: TenantRole;
  accessGroupId?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

async function updateNotificationPreferences(
  membershipId: string,
  prefs?: ApproveMembershipInput['notificationPreferences'],
): Promise<void> {
  if (!prefs) return;
  await prisma.authNotificationPreference.upsert({
    where: { membershipId },
    create: { membershipId, ...prefs },
    update: prefs,
  });
}

async function filterBySearch<T extends { userId: string }>(
  memberships: T[],
  search: string,
): Promise<T[]> {
  const normalized = search.trim();
  if (!normalized) return memberships;

  if (normalized.includes('@')) {
    const user = await findUserByEmailLookup(normalizeEmail(normalized));
    if (!user) return [];
    return memberships.filter((m) => m.userId === user.id);
  }

  const q = normalized.toLowerCase();
  const results: T[] = [];
  for (const m of memberships) {
    const user = await findUserById(m.userId);
    if (!user) continue;
    const email = decryptField(user.emailEncrypted).toLowerCase();
    const firstName = user.firstNameEncrypted ? decryptField(user.firstNameEncrypted).toLowerCase() : '';
    const lastName = user.lastNameEncrypted ? decryptField(user.lastNameEncrypted).toLowerCase() : '';
    if (email.includes(q) || firstName.includes(q) || lastName.includes(q)) {
      results.push(m);
    }
  }
  return results;
}

export async function listMembers(
  actor: AdminActor,
  filters: ListMembersFilters = {},
): Promise<PaginatedResult<PublicMembership>> {
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 20));

  const isGlobalAdmin = isDoqynAdmin(actor.membership.roles as TenantRole[]);
  let tenantUuid: string | undefined;

  if (filters.tenantId || !isGlobalAdmin) {
    const tenantTextId = resolveTenantScope(actor, filters.tenantId);
    const tenant = await prisma.authTenant.findUnique({ where: { tenantId: tenantTextId } });
    if (!tenant) {
      return { items: [], total: 0, page, limit };
    }
    tenantUuid = tenant.id;
  }

  let accessGroupUuid: string | undefined;
  if (filters.accessGroupId && tenantUuid) {
    const group = await prisma.authAccessGroup.findUnique({
      where: { tenantId_groupId: { tenantId: tenantUuid, groupId: filters.accessGroupId } },
    });
    accessGroupUuid = group?.id;
  }

  const where = {
    ...(tenantUuid ? { tenantId: tenantUuid } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.role ? { roles: { some: { role: filters.role } } } : {}),
    ...(accessGroupUuid
      ? { accessGroupLinks: { some: { accessGroupId: accessGroupUuid } } }
      : {}),
  };

  let all = await prisma.authMembership.findMany({
    where,
    include: {
      tenant: true,
      roles: true,
      accessGroupLinks: { include: { accessGroup: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (filters.search) {
    all = await filterBySearch(all, filters.search);
  }

  const total = all.length;
  const offset = (page - 1) * limit;
  const pageItems = all.slice(offset, offset + limit);

  return {
    items: pageItems.map(toPublicMembership),
    total,
    page,
    limit,
  };
}

export async function getMemberDetail(
  actor: AdminActor,
  membershipId: string,
): Promise<MemberDetailResponse> {
  const membership = await assertCanManageMembership(actor, membershipId);
  const user = await findUserById(membership.userId);
  if (!user) throw new NotFoundError('Usuário não encontrado.');

  const [accessRequest, notificationPreferences] = await Promise.all([
    prisma.authAccessRequest.findFirst({
      where: { membershipId },
      orderBy: { requestedAt: 'desc' },
    }),
    prisma.authNotificationPreference.findUnique({
      where: { membershipId },
    }),
  ]);

  const tenantDisplayName = membership.tenant.displayNameEncrypted
    ? decryptField(membership.tenant.displayNameEncrypted)
    : null;

  return {
    user: toPublicUser(user),
    membership: toPublicMembership(membership),
    tenant: {
      tenantId: membership.tenant.tenantId,
      tenantType: membership.tenant.tenantType,
      displayName: tenantDisplayName,
      status: membership.tenant.status,
    },
    requestedAccess: accessRequest
      ? buildRequestedAccessFromRecord(accessRequest)
      : buildRequestedAccessFromMembership(membership, membership.tenant),
    consent: accessRequest ? buildConsentFromRecord(accessRequest) : undefined,
    notificationPreferences: buildNotificationPreferencesDto(notificationPreferences) ?? undefined,
    createdAt: membership.createdAt.toISOString(),
    updatedAt: membership.updatedAt.toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  };
}

export async function updateMemberRoles(
  actor: AdminActor,
  membershipId: string,
  roles: TenantRole[],
  ctx?: { ipHash?: string; userAgentHash?: string },
): Promise<PublicMembership> {
  const target = await assertCanManageMembership(actor, membershipId);
  assertCanGrantRoles(actor, roles);
  assertNotSelfSensitive(actor, membershipId, target.userId);
  await assertLastAdminProtection(target.tenantId, membershipId, roles);

  const beforeRoles = target.roles.map((r) => r.role);

  await setMembershipRoles(membershipId, roles);

  await logAuthAudit(
    'member.roles_updated',
    auditCtx(actor, {
      targetUserId: target.userId,
      targetMembershipId: membershipId,
      tenantTextId: target.tenant.tenantId,
      ipHash: ctx?.ipHash,
      userAgentHash: ctx?.userAgentHash,
      metadata: { before: beforeRoles, after: roles },
    }),
  );

  const updated = await findMembershipById(membershipId);
  scheduleTenantMemberSync(membershipId);
  return toPublicMembership(updated!);
}

export async function updateMemberAccessGroups(
  actor: AdminActor,
  membershipId: string,
  accessGroupIds: string[],
  ctx?: { ipHash?: string; userAgentHash?: string },
): Promise<PublicMembership> {
  const target = await assertCanManageMembership(actor, membershipId);
  const beforeGroups = target.accessGroupLinks.map((l) => l.accessGroup.groupId);

  await setMembershipAccessGroups(membershipId, target.tenantId, accessGroupIds);

  await logAuthAudit(
    'member.access_groups_updated',
    auditCtx(actor, {
      targetUserId: target.userId,
      targetMembershipId: membershipId,
      tenantTextId: target.tenant.tenantId,
      ipHash: ctx?.ipHash,
      userAgentHash: ctx?.userAgentHash,
      metadata: { before: beforeGroups, after: accessGroupIds },
    }),
  );

  const updated = await findMembershipById(membershipId);
  scheduleTenantMemberSync(membershipId);
  return toPublicMembership(updated!);
}

export async function removeMember(
  actor: AdminActor,
  membershipId: string,
  ctx?: { ipHash?: string; userAgentHash?: string },
): Promise<PublicMembership> {
  const target = await assertCanManageMembership(actor, membershipId);
  assertNotSelfSensitive(actor, membershipId, target.userId);
  await assertLastAdminProtection(target.tenantId, membershipId, []);

  const now = new Date();
  await prisma.authMembership.update({
    where: { id: membershipId },
    data: {
      status: 'removed',
      removedAt: now,
      removedByMembershipId: actor.membership.membershipId,
    },
  });

  await revokeSessionsByActiveMembership(membershipId);

  await logAuthAudit(
    'membership.removed',
    auditCtx(actor, {
      targetUserId: target.userId,
      targetMembershipId: membershipId,
      tenantTextId: target.tenant.tenantId,
      ipHash: ctx?.ipHash,
      userAgentHash: ctx?.userAgentHash,
    }),
  );

  const updated = await findMembershipById(membershipId);
  scheduleTenantMemberSync(membershipId);
  return toPublicMembership(updated!);
}

export async function revokeMemberSessions(
  actor: AdminActor,
  membershipId: string,
  ctx?: { ipHash?: string; userAgentHash?: string },
): Promise<{ revokedCount: number }> {
  const target = await assertCanManageMembership(actor, membershipId);
  const revokedCount = await revokeSessionsByActiveMembership(membershipId);

  await logAuthAudit(
    'member.sessions_revoked',
    auditCtx(actor, {
      targetUserId: target.userId,
      targetMembershipId: membershipId,
      tenantTextId: target.tenant.tenantId,
      ipHash: ctx?.ipHash,
      userAgentHash: ctx?.userAgentHash,
      metadata: { revokedCount },
    }),
  );

  return { revokedCount };
}

export async function approveMembership(
  actor: AdminActor,
  targetMembershipId: string,
  input: ApproveMembershipInput,
  ipHash?: string,
  userAgentHash?: string,
): Promise<PublicMembership> {
  const target = await findMembershipById(targetMembershipId);
  if (!target) throw new NotFoundError('Membership não encontrada.');

  await assertCanManageMembership(actor, targetMembershipId);
  assertCanGrantRoles(actor, input.roles as TenantRole[]);
  if (
    targetMembershipId === actor.membership.membershipId &&
    !isDoqynAdmin(actor.membership.roles as TenantRole[])
  ) {
    throw new ForbiddenError('Não é permitido aprovar a si mesmo.');
  }
  if (
    target.userId === actor.userId &&
    !isDoqynAdmin(actor.membership.roles as TenantRole[])
  ) {
    throw new ForbiddenError('Não é permitido aprovar a si mesmo.');
  }

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.authMembership.update({
      where: { id: targetMembershipId },
      data: {
        status: 'active',
        approvedAt: now,
        approvedByMembershipId: actor.membership.membershipId,
      },
    });

    await tx.authTenant.update({
      where: { id: target.tenantId },
      data: { status: 'active' },
    });

    await tx.authAccessRequest.updateMany({
      where: { membershipId: targetMembershipId, status: 'pending' },
      data: {
        status: 'approved',
        decidedAt: now,
        decidedByMembershipId: actor.membership.membershipId,
      },
    });
  });

  await setMembershipRoles(targetMembershipId, input.roles as TenantRole[]);
  await setMembershipAccessGroups(targetMembershipId, target.tenantId, input.accessGroupIds);
  await updateNotificationPreferences(targetMembershipId, input.notificationPreferences);

  await logAuthAudit(
    'membership.approved',
    auditCtx(actor, {
      targetUserId: target.userId,
      targetMembershipId,
      tenantTextId: target.tenant.tenantId,
      ipHash,
      userAgentHash,
      metadata: { roles: input.roles },
    }),
  );

  const updated = await findMembershipById(targetMembershipId);
  scheduleTenantMemberSync(targetMembershipId);
  return toPublicMembership(updated!);
}

export async function rejectMembership(
  actor: AdminActor,
  targetMembershipId: string,
  input: { reason: string },
  ipHash?: string,
  userAgentHash?: string,
): Promise<PublicMembership> {
  const target = await assertCanManageMembership(actor, targetMembershipId);
  const now = new Date();
  const reason = input.reason.trim().slice(0, 500);
  const rejectedReasonEncrypted = encryptField(reason);

  await prisma.$transaction(async (tx) => {
    await tx.authMembership.update({
      where: { id: targetMembershipId },
      data: {
        status: 'rejected',
        rejectedAt: now,
        rejectedByMembershipId: actor.membership.membershipId,
        rejectedReasonEncrypted,
      },
    });

    await tx.authAccessRequest.updateMany({
      where: { membershipId: targetMembershipId, status: 'pending' },
      data: {
        status: 'rejected',
        decidedAt: now,
        decidedByMembershipId: actor.membership.membershipId,
      },
    });
  });

  await logAuthAudit(
    'membership.rejected',
    auditCtx(actor, {
      targetUserId: target.userId,
      targetMembershipId,
      tenantTextId: target.tenant.tenantId,
      ipHash,
      userAgentHash,
      metadata: { reasonLength: reason.length },
    }),
  );

  const updated = await findMembershipById(targetMembershipId);
  scheduleTenantMemberSync(targetMembershipId);
  return toPublicMembership(updated!);
}

export async function blockMembership(
  actor: AdminActor,
  targetMembershipId: string,
  input?: { reason?: string; notifyUser?: boolean },
  ipHash?: string,
  userAgentHash?: string,
): Promise<PublicMembership> {
  const target = await assertCanManageMembership(actor, targetMembershipId);
  assertNotSelfSensitive(actor, targetMembershipId, target.userId);

  if (target.status === 'blocked') {
    const updated = await findMembershipById(targetMembershipId);
    return toPublicMembership(updated!);
  }

  await assertLastAdminProtection(target.tenantId, targetMembershipId, []);

  const reason = input?.reason?.trim().slice(0, 300);

  await prisma.authMembership.update({
    where: { id: targetMembershipId },
    data: {
      status: 'blocked',
      blockedAt: new Date(),
      blockedByMembershipId: actor.membership.membershipId,
    },
  });

  const revokedSessionsCount = await revokeSessionsByActiveMembership(targetMembershipId);

  await logAuthAudit(
    'membership.blocked',
    auditCtx(actor, {
      targetUserId: target.userId,
      targetMembershipId,
      tenantTextId: target.tenant.tenantId,
      ipHash,
      userAgentHash,
      metadata: {
        ...(reason ? { reason } : {}),
        notifyUser: input?.notifyUser ?? false,
        revokedSessionsCount,
      },
    }),
  );

  const updated = await findMembershipById(targetMembershipId);
  scheduleTenantMemberSync(targetMembershipId);
  return toPublicMembership(updated!);
}

export async function unblockMembership(
  actor: AdminActor,
  targetMembershipId: string,
  ipHash?: string,
  userAgentHash?: string,
): Promise<PublicMembership> {
  const target = await assertCanManageMembership(actor, targetMembershipId);

  if (target.status === 'active') {
    const updated = await findMembershipById(targetMembershipId);
    return toPublicMembership(updated!);
  }

  if (target.status !== 'blocked') {
    throw new ValidationError(
      'Somente memberships bloqueadas podem ser desbloqueadas.',
      'MEMBERSHIP_NOT_BLOCKED',
    );
  }

  await prisma.authMembership.update({
    where: { id: targetMembershipId },
    data: {
      status: 'active',
      blockedAt: null,
      blockedByMembershipId: null,
    },
  });

  await logAuthAudit(
    'membership.unblocked',
    auditCtx(actor, {
      targetUserId: target.userId,
      targetMembershipId,
      tenantTextId: target.tenant.tenantId,
      ipHash,
      userAgentHash,
    }),
  );

  const updated = await findMembershipById(targetMembershipId);
  scheduleTenantMemberSync(targetMembershipId);
  return toPublicMembership(updated!);
}

export async function listAccessRequestsForAdmin(
  actor: AdminActor,
  tenantTextId?: string,
  status?: string,
) {
  const isGlobalAdmin = isDoqynAdmin(actor.membership.roles as TenantRole[]);
  let tenantFilter: string | undefined;

  if (tenantTextId || !isGlobalAdmin) {
    tenantFilter = resolveTenantScope(actor, tenantTextId);
  }

  const requests = await prisma.authAccessRequest.findMany({
    where: {
      ...(status ? { status: status as 'pending' | 'approved' | 'rejected' | 'cancelled' } : {}),
      ...(tenantFilter ? { tenant: { tenantId: tenantFilter } } : {}),
    },
    include: {
      tenant: true,
      user: true,
    },
    orderBy: { requestedAt: 'desc' },
  });

  const membershipIds = requests
    .map((request) => request.membershipId)
    .filter((id): id is string => Boolean(id));

  const notificationPreferences = membershipIds.length
    ? await prisma.authNotificationPreference.findMany({
        where: { membershipId: { in: membershipIds } },
      })
    : [];

  const prefsByMembership = new Map(
    notificationPreferences.map((prefs) => [prefs.membershipId, prefs]),
  );

  const termsByRequest = await listTermsAcceptancesForAccessRequests(
    requests.map((request) => request.id),
  );

  return requests.map((request) =>
    serializeAdminAccessRequest({
      request,
      user: request.user,
      tenantTextId: request.tenant.tenantId,
      tenantDisplayName: request.tenant.displayNameEncrypted
        ? decryptField(request.tenant.displayNameEncrypted)
        : null,
      notificationPreferences: request.membershipId
        ? prefsByMembership.get(request.membershipId) ?? null
        : null,
      termsAcceptance: termsByRequest.get(request.id) ?? null,
    }),
  );
}
