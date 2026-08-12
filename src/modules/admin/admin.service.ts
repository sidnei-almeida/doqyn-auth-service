import type { TenantRole } from '@prisma/client';
import {
  addMemberToGroup,
  createAccessGroup,
  listAccessGroups,
  listGroupMembers,
  removeMemberFromGroup,
  softDeleteAccessGroup,
  updateAccessGroup,
  type CreateAccessGroupInput,
  type PublicAccessGroup,
} from '../access-groups/accessGroups.service.js';
import { auditCtx, logAuthAudit } from '../audit/authAudit.service.js';
import {
  assertAdminActor,
  resolveTenantScope,
} from './adminAuthorization.js';
import type { AdminActor } from './admin.types.js';

export type { AdminActor } from './admin.types.js';

export {
  approveMembership,
  blockMembership,
  getMemberDetail,
  listAccessRequestsForAdmin,
  listMembers,
  rejectMembership,
  removeMember,
  revokeMemberSessions,
  unblockMembership,
  updateMemberAccessGroups,
  updateMemberRoles,
} from './membersAdmin.service.js';

export {
  blockTenant,
  createTenantAdmin,
  getTenant,
  listTenants,
  transferAdmin,
  unblockTenant,
  updateTenantAdmin,
} from './tenantsAdmin.service.js';

export async function adminListGroups(
  actor: AdminActor,
  tenantTextId?: string,
  filters?: { status?: 'active' | 'inactive' | 'deleted'; search?: string },
): Promise<PublicAccessGroup[]> {
  assertAdminActor(actor);
  const tenantId = resolveTenantScope(actor, tenantTextId);
  return listAccessGroups(tenantId, filters);
}

export async function adminCreateGroup(
  actor: AdminActor,
  input: CreateAccessGroupInput,
  tenantTextId?: string,
  ctx?: { ipHash?: string; userAgentHash?: string },
): Promise<PublicAccessGroup> {
  assertAdminActor(actor);
  const tenantId = resolveTenantScope(actor, tenantTextId);
  const group = await createAccessGroup(tenantId, input);

  await logAuthAudit(
    'access_group.created',
    auditCtx(actor, {
      tenantTextId: tenantId,
      ipHash: ctx?.ipHash,
      userAgentHash: ctx?.userAgentHash,
      metadata: { groupId: group.groupId },
    }),
  );

  return group;
}

export async function adminUpdateGroup(
  actor: AdminActor,
  groupId: string,
  input: Partial<CreateAccessGroupInput> & { status?: 'active' | 'inactive' },
  tenantTextId?: string,
  ctx?: { ipHash?: string; userAgentHash?: string },
): Promise<PublicAccessGroup> {
  assertAdminActor(actor);
  const tenantId = resolveTenantScope(actor, tenantTextId);
  const group = await updateAccessGroup(tenantId, groupId, input);

  await logAuthAudit(
    'access_group.updated',
    auditCtx(actor, {
      tenantTextId: tenantId,
      ipHash: ctx?.ipHash,
      userAgentHash: ctx?.userAgentHash,
      metadata: { groupId },
    }),
  );

  return group;
}

export async function adminDeleteGroup(
  actor: AdminActor,
  groupId: string,
  tenantTextId?: string,
  ctx?: { ipHash?: string; userAgentHash?: string },
): Promise<PublicAccessGroup> {
  assertAdminActor(actor);
  const tenantId = resolveTenantScope(actor, tenantTextId);
  const group = await softDeleteAccessGroup(tenantId, groupId, actor.membership.membershipId);

  await logAuthAudit(
    'access_group.deleted',
    auditCtx(actor, {
      tenantTextId: tenantId,
      ipHash: ctx?.ipHash,
      userAgentHash: ctx?.userAgentHash,
      metadata: { groupId },
    }),
  );

  return group;
}

export async function adminListGroupMembers(
  actor: AdminActor,
  groupId: string,
  tenantTextId?: string,
) {
  assertAdminActor(actor);
  const tenantId = resolveTenantScope(actor, tenantTextId);
  return listGroupMembers(tenantId, groupId);
}

export async function adminAddGroupMember(
  actor: AdminActor,
  groupId: string,
  membershipId: string,
  tenantTextId?: string,
  ctx?: { ipHash?: string; userAgentHash?: string },
): Promise<void> {
  assertAdminActor(actor);
  const tenantId = resolveTenantScope(actor, tenantTextId);
  await addMemberToGroup(tenantId, groupId, membershipId);

  await logAuthAudit(
    'access_group.member_added',
    auditCtx(actor, {
      tenantTextId: tenantId,
      targetMembershipId: membershipId,
      ipHash: ctx?.ipHash,
      userAgentHash: ctx?.userAgentHash,
      metadata: { groupId },
    }),
  );
}

export async function adminRemoveGroupMember(
  actor: AdminActor,
  groupId: string,
  membershipId: string,
  tenantTextId?: string,
  ctx?: { ipHash?: string; userAgentHash?: string },
): Promise<void> {
  assertAdminActor(actor);
  const tenantId = resolveTenantScope(actor, tenantTextId);
  await removeMemberFromGroup(tenantId, groupId, membershipId);

  await logAuthAudit(
    'access_group.member_removed',
    auditCtx(actor, {
      tenantTextId: tenantId,
      targetMembershipId: membershipId,
      ipHash: ctx?.ipHash,
      userAgentHash: ctx?.userAgentHash,
      metadata: { groupId },
    }),
  );
}

/** Nenhuma sessão humana governa mais de um tenant. Operação cross-tenant é da fase 2. */
export function canManageAnyTenant(_actor: AdminActor): boolean {
  return false;
}
