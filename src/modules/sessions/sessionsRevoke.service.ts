import { prisma } from '../../db/prisma.js';
import { hashSessionToken } from '../../security/crypto.js';
import { scheduleAppSessionCacheInvalidation } from '../../integrations/appSessionCache.js';

export async function revokeAllUserSessions(userId: string): Promise<number> {
  const result = await prisma.authSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  scheduleAppSessionCacheInvalidation([userId]);
  return result.count;
}

/** Donos das sessões vivas que o filtro vai revogar — o cache do app é invalidado por usuário. */
async function liveSessionUserIds(where: { activeMembershipId: string | { in: string[] } }) {
  const sessions = await prisma.authSession.findMany({
    where: { ...where, revokedAt: null },
    select: { userId: true },
    distinct: ['userId'],
  });
  return sessions.map((session) => session.userId);
}

export async function revokeSessionsByActiveMembership(membershipId: string): Promise<number> {
  const userIds = await liveSessionUserIds({ activeMembershipId: membershipId });
  const result = await prisma.authSession.updateMany({
    where: { activeMembershipId: membershipId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  scheduleAppSessionCacheInvalidation(userIds);
  return result.count;
}

export async function revokeSessionByToken(token: string): Promise<boolean> {
  const sessionTokenHash = hashSessionToken(token);
  const session = await prisma.authSession.findUnique({ where: { sessionTokenHash } });
  if (!session || session.revokedAt) return false;
  await prisma.authSession.update({
    where: { id: session.id },
    data: { revokedAt: new Date() },
  });
  scheduleAppSessionCacheInvalidation([session.userId]);
  return true;
}

export async function revokeUserSessionsForTenant(
  userId: string,
  tenantUuid: string,
): Promise<number> {
  const memberships = await prisma.authMembership.findMany({
    where: { userId, tenantId: tenantUuid },
    select: { id: true },
  });
  const ids = memberships.map((m) => m.id);
  if (ids.length === 0) return 0;
  const result = await prisma.authSession.updateMany({
    where: { userId, activeMembershipId: { in: ids }, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  scheduleAppSessionCacheInvalidation([userId]);
  return result.count;
}

export async function revokeAllTenantSessions(tenantUuid: string): Promise<number> {
  const memberships = await prisma.authMembership.findMany({
    where: { tenantId: tenantUuid },
    select: { id: true },
  });
  const ids = memberships.map((m) => m.id);
  if (ids.length === 0) return 0;
  const userIds = await liveSessionUserIds({ activeMembershipId: { in: ids } });
  const result = await prisma.authSession.updateMany({
    where: { activeMembershipId: { in: ids }, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  scheduleAppSessionCacheInvalidation(userIds);
  return result.count;
}
