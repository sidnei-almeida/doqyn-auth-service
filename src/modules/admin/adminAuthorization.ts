import type { TenantRole } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import {
  ForbiddenError,
  LastAdminProtectionError,
  TenantScopeViolationError,
} from '../../utils/errors.js';
import {
  canGrantRole,
  findMembershipById,
  hasAdminRole,
  isDoqynAdmin,
} from '../memberships/memberships.service.js';
import type { AdminActor } from './admin.types.js';

export function assertAdminActor(actor: AdminActor): void {
  if (!hasAdminRole(actor.membership.roles as TenantRole[])) {
    throw new ForbiddenError();
  }
}

export function assertDoqynAdmin(actor: AdminActor): void {
  assertAdminActor(actor);
  if (!isDoqynAdmin(actor.membership.roles as TenantRole[])) {
    throw new ForbiddenError('Apenas doqyn_admin pode executar esta operação.');
  }
}

export function resolveTenantScope(actor: AdminActor, requestedTenantId?: string): string {
  assertAdminActor(actor);
  if (isDoqynAdmin(actor.membership.roles as TenantRole[])) {
    return requestedTenantId ?? actor.membership.tenantId;
  }
  if (requestedTenantId && requestedTenantId !== actor.membership.tenantId) {
    throw new TenantScopeViolationError();
  }
  return actor.membership.tenantId;
}

export async function assertCanManageMembership(
  actor: AdminActor,
  membershipId: string,
): Promise<NonNullable<Awaited<ReturnType<typeof findMembershipById>>>> {
  const membership = await findMembershipById(membershipId);
  if (!membership) {
    throw new ForbiddenError();
  }
  if (!isDoqynAdmin(actor.membership.roles as TenantRole[])) {
    if (actor.membership.tenantId !== membership.tenant.tenantId) {
      throw new TenantScopeViolationError();
    }
  }
  return membership;
}

export function assertCanGrantRoles(actor: AdminActor, roles: TenantRole[]): void {
  for (const role of roles) {
    if (!canGrantRole(actor.membership.roles as TenantRole[], role)) {
      throw new ForbiddenError('Sem permissão para conceder esta role.');
    }
  }
}

export function assertNotSelfSensitive(
  actor: AdminActor,
  targetMembershipId: string,
  targetUserId: string,
): void {
  if (isDoqynAdmin(actor.membership.roles as TenantRole[])) return;
  if (
    targetMembershipId === actor.membership.membershipId ||
    targetUserId === actor.userId
  ) {
    throw new ForbiddenError('Não é permitido executar esta operação em si mesmo.');
  }
}

export async function assertLastAdminProtection(
  tenantUuid: string,
  targetMembershipId: string,
  newRoles?: TenantRole[],
): Promise<void> {
  const admins = await prisma.authMembership.findMany({
    where: {
      tenantId: tenantUuid,
      status: 'active',
      roles: { some: { role: { in: ['company_admin', 'individual_admin'] } } },
    },
    include: { roles: true },
  });

  const target = admins.find((a) => a.id === targetMembershipId);
  if (!target) return;

  const targetWillRemainAdmin =
    newRoles?.some((r) => r === 'company_admin' || r === 'individual_admin') ??
    target.roles.some((r) => r.role === 'company_admin' || r.role === 'individual_admin');

  const otherAdmins = admins.filter((a) => a.id !== targetMembershipId);
  if (!targetWillRemainAdmin && otherAdmins.length === 0) {
    throw new LastAdminProtectionError();
  }
}

export async function countActiveCompanyAdmins(tenantUuid: string): Promise<number> {
  return prisma.authMembership.count({
    where: {
      tenantId: tenantUuid,
      status: 'active',
      roles: { some: { role: { in: ['company_admin', 'individual_admin'] } } },
    },
  });
}
