import { prisma } from '../../db/prisma.js';
import { hashSessionToken } from '../../security/crypto.js';

export async function revokeAllUserSessions(userId: string): Promise<number> {
  const result = await prisma.authSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export async function revokeSessionsByActiveMembership(membershipId: string): Promise<number> {
  const result = await prisma.authSession.updateMany({
    where: { activeMembershipId: membershipId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
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
  return true;
}

export async function revokeUserSessionsForTenant(userId: string, tenantUuid: string): Promise<number> {
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
  return result.count;
}

export async function revokeAllTenantSessions(tenantUuid: string): Promise<number> {
  const memberships = await prisma.authMembership.findMany({
    where: { tenantId: tenantUuid },
    select: { id: true },
  });
  const ids = memberships.map((m) => m.id);
  if (ids.length === 0) return 0;
  const result = await prisma.authSession.updateMany({
    where: { activeMembershipId: { in: ids }, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}
