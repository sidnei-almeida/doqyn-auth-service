import { prisma } from '../../db/prisma.js';
import { hashSessionToken } from '../../security/crypto.js';
import type { PublicMembership, SessionContext } from './memberships.schemas.js';
import {
  findMembershipById,
  listUserMemberships,
  toMembershipSummary,
  toPublicMembership,
} from './memberships.service.js';
import {
  isMembershipUsable,
  isUserSessionAllowed,
  validateActiveMembershipForSession,
} from './sessionValidation.service.js';
import type { PublicUser } from '../users/users.schemas.js';

export async function getSessionRecordByToken(token: string) {
  const sessionTokenHash = hashSessionToken(token);
  return prisma.authSession.findUnique({ where: { sessionTokenHash } });
}

export async function setSessionActiveMembership(
  sessionTokenHash: string,
  membershipId: string,
  userId: string,
): Promise<boolean> {
  const membership = await findMembershipById(membershipId);
  if (!membership || membership.userId !== userId) return false;
  await prisma.authSession.update({
    where: { sessionTokenHash },
    data: { activeMembershipId: membershipId },
  });
  return true;
}

export async function buildSessionContext(
  user: PublicUser,
  activeMembershipId?: string | null,
): Promise<SessionContext> {
  const memberships = await listUserMemberships(user.id);
  const summaries = memberships
    .filter((m) => m.status !== 'removed')
    .map(toMembershipSummary);

  let activeMembership: PublicMembership | null = null;

  if (activeMembershipId) {
    const selected = memberships.find((m) => m.id === activeMembershipId);
    if (selected) {
      const pub = toPublicMembership(selected);
      const usable = isMembershipUsable(pub, selected.tenant.status);
      if (usable.ok && isUserSessionAllowed(user.status)) {
        activeMembership = pub;
      }
    }
  } else {
    const activeOnes = memberships.filter(
      (m) => m.status === 'active' && m.tenant.status === 'active',
    );
    if (activeOnes.length === 1 && isUserSessionAllowed(user.status)) {
      activeMembership = toPublicMembership(activeOnes[0]);
    }
  }

  return { user, activeMembership, memberships: summaries };
}

export async function buildVerifiedSessionContext(
  user: PublicUser,
  sessionToken: string,
): Promise<(SessionContext & { ok: true }) | { ok: false; code: string }> {
  if (!isUserSessionAllowed(user.status)) {
    return { ok: false, code: 'USER_NOT_ACTIVE' };
  }

  const session = await getSessionRecordByToken(sessionToken);
  if (!session?.activeMembershipId) {
    const ctx = await buildSessionContext(user, null);
    return { ok: true, ...ctx };
  }

  const validation = await validateActiveMembershipForSession(session.activeMembershipId);
  if (!validation.ok) {
    return { ok: false, code: validation.code };
  }

  const ctx = await buildSessionContext(user, session.activeMembershipId);
  return { ok: true, ...ctx };
}
