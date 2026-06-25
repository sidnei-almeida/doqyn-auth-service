import { NotFoundError } from '../../utils/errors.js';
import { logAuthAudit } from '../audit/authAudit.service.js';
import { buildVerifiedSessionContext } from '../memberships/sessionContext.service.js';
import { findMembershipById } from '../memberships/memberships.service.js';
import { toPublicMembership } from '../memberships/memberships.service.js';
import { revokeAllUserSessions, validateSessionByToken } from '../sessions/sessions.service.js';
import {
  createOrGetUser,
  disableUser,
  enableUser,
  findUserByEmailLookup,
  toPublicUser,
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
