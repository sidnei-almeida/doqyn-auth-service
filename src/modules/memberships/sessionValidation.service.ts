import type { PublicMembership } from './memberships.schemas.js';
import type { PublicUser } from '../users/users.schemas.js';
import { findMembershipById } from './memberships.service.js';

export type SessionBlockCode =
  | 'USER_NOT_ACTIVE'
  | 'TENANT_NOT_ACTIVE'
  | 'MEMBERSHIP_NOT_ACTIVE'
  | 'INVALID_SESSION';

export function isUserSessionAllowed(status: PublicUser['status']): boolean {
  return status === 'active' || status === 'pending_verification';
}

export function isMembershipUsable(
  membership: PublicMembership,
  tenantStatus: string,
): { ok: true } | { ok: false; code: SessionBlockCode } {
  if (tenantStatus !== 'active') {
    return { ok: false, code: 'TENANT_NOT_ACTIVE' };
  }
  if (membership.status !== 'active') {
    return { ok: false, code: 'MEMBERSHIP_NOT_ACTIVE' };
  }
  return { ok: true };
}

export async function validateActiveMembershipForSession(
  membershipId: string,
): Promise<{ ok: true; membership: PublicMembership } | { ok: false; code: SessionBlockCode }> {
  const raw = await findMembershipById(membershipId);
  if (!raw) return { ok: false, code: 'INVALID_SESSION' };

  const { toPublicMembership } = await import('./memberships.service.js');
  const membership = toPublicMembership(raw);
  const check = isMembershipUsable(membership, raw.tenant.status);
  if (!check.ok) return check;
  return { ok: true, membership };
}
