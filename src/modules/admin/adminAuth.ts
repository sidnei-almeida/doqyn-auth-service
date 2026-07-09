import type { FastifyReply, FastifyRequest } from 'fastify';
import type { TenantRole } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { ForbiddenError, UnauthorizedError } from '../../utils/errors.js';
import { hashSessionToken } from '../../security/crypto.js';
import { getSessionCookieName } from '../../security/cookies.js';
import { validateSessionByToken } from '../sessions/sessions.service.js';
import {
  findMembershipById,
  findMembershipByUserAndTenantTextId,
  hasAdminRole,
  toPublicMembership,
} from '../memberships/memberships.service.js';
import { getSessionRecordByToken } from '../memberships/sessionContext.service.js';
import type { PublicUser } from '../users/users.schemas.js';
import type { AdminActor } from './admin.types.js';

export interface AuthenticatedRequest extends FastifyRequest {
  authUser?: PublicUser;
  adminActor?: AdminActor;
}

function getSessionToken(request: FastifyRequest): string | undefined {
  return request.cookies[getSessionCookieName()];
}

export async function requireSession(
  request: AuthenticatedRequest,
  _reply: FastifyReply,
): Promise<void> {
  const token = getSessionToken(request);
  if (!token) {
    throw new UnauthorizedError('Faça login para continuar.', 'AUTH_REQUIRED');
  }

  const result = await validateSessionByToken(token);
  if (!result.valid) {
    throw new UnauthorizedError('Sua sessão expirou. Faça login novamente.', 'SESSION_EXPIRED');
  }

  request.authUser = result.user;
}

async function resolveActorMembership(
  userId: string,
  sessionToken: string,
): Promise<ReturnType<typeof findMembershipById>> {
  const session = await getSessionRecordByToken(sessionToken);
  if (!session || session.userId !== userId) return null;

  if (session.activeMembershipId) {
    return findMembershipById(session.activeMembershipId);
  }

  const { listUserMemberships } = await import('../memberships/memberships.service.js');
  const all = await listUserMemberships(userId);
  const active = all.filter((m) => m.status === 'active');
  if (active.length === 1) {
    return active[0];
  }

  return null;
}

export async function requireAdminActor(
  request: AuthenticatedRequest,
  _reply: FastifyReply,
): Promise<void> {
  await requireSession(request, _reply);

  const token = getSessionToken(request)!;
  const membership = await resolveActorMembership(request.authUser!.id, token);

  if (!membership || !hasAdminRole(membership.roles.map((r) => r.role) as TenantRole[])) {
    throw new ForbiddenError();
  }

  request.adminActor = {
    userId: request.authUser!.id,
    membership: toPublicMembership(membership),
  };
}

export async function selectTenantForSession(
  userId: string,
  sessionToken: string,
  tenantId?: string,
  membershipId?: string,
): Promise<boolean> {
  let targetMembershipId = membershipId;

  if (!targetMembershipId && tenantId) {
    const membership = await findMembershipByUserAndTenantTextId(userId, tenantId);
    if (!membership) return false;
    targetMembershipId = membership.id;
  }

  if (!targetMembershipId) return false;

  const membership = await findMembershipById(targetMembershipId);
  if (!membership || membership.userId !== userId) return false;

  const sessionTokenHash = hashSessionToken(sessionToken);
  await prisma.authSession.update({
    where: { sessionTokenHash },
    data: { activeMembershipId: targetMembershipId },
  });

  return true;
}
