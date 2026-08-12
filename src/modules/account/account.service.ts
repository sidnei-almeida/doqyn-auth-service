import { prisma } from '../../db/prisma.js';
import { encryptField, hashLookup } from '../../security/crypto.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../utils/errors.js';
import { auditCtx, logAuthAudit } from '../audit/authAudit.service.js';
import { assertPlatformOperation } from '../admin/adminAuthorization.js';
import type { AdminActor } from '../admin/admin.types.js';
import { revokeAllUserSessions } from '../sessions/sessionsRevoke.service.js';
import { findUserById, toPublicUser } from '../users/users.service.js';
import type { PublicUser } from '../users/users.schemas.js';

export async function requestAccountDeletion(
  userId: string,
  reason?: string,
  ctx?: { ipHash?: string; userAgentHash?: string },
): Promise<{ ok: true; requestId: string }> {
  const existing = await prisma.authAccountDeletionRequest.findFirst({
    where: { userId, status: 'pending' },
  });
  if (existing) {
    throw new ConflictError('Já existe uma solicitação de exclusão pendente.');
  }

  const request = await prisma.authAccountDeletionRequest.create({
    data: { userId, reason: reason ?? null, status: 'pending' },
  });

  await logAuthAudit('account.deletion_requested', {
    userId,
    ipHash: ctx?.ipHash,
    userAgentHash: ctx?.userAgentHash,
    metadata: { requestId: request.id },
  });

  return { ok: true, requestId: request.id };
}

export async function deactivateUser(
  actor: AdminActor,
  userId: string,
  ctx?: { ipHash?: string; userAgentHash?: string },
): Promise<PublicUser> {
  assertPlatformOperation(actor);
  if (userId === actor.userId) {
    throw new ForbiddenError('Não é permitido desativar a si mesmo.');
  }

  const user = await findUserById(userId);
  if (!user) throw new NotFoundError('Usuário não encontrado.');

  const updated = await prisma.authUser.update({
    where: { id: userId },
    data: { status: 'disabled' },
  });

  await revokeAllUserSessions(userId);

  await logAuthAudit(
    'user.deactivated',
    auditCtx(actor, {
      targetUserId: userId,
      ipHash: ctx?.ipHash,
      userAgentHash: ctx?.userAgentHash,
    }),
  );

  return toPublicUser(updated);
}

export async function anonymizeUser(
  actor: AdminActor,
  userId: string,
  ctx?: { ipHash?: string; userAgentHash?: string },
): Promise<PublicUser> {
  assertPlatformOperation(actor);
  if (userId === actor.userId) {
    throw new ForbiddenError('Não é permitido anonimizar a si mesmo.');
  }

  const user = await findUserById(userId);
  if (!user) throw new NotFoundError('Usuário não encontrado.');

  const now = new Date();
  const anonymizedEmail = `anonymized_${userId.slice(0, 8)}@anonymized.local`;

  const updated = await prisma.authUser.update({
    where: { id: userId },
    data: {
      status: 'anonymized',
      emailEncrypted: encryptField(anonymizedEmail),
      emailLookupHash: hashLookup(anonymizedEmail),
      firstNameEncrypted: null,
      lastNameEncrypted: null,
      whatsappEncrypted: null,
      whatsappLookupHash: null,
      anonymizedAt: now,
    },
  });

  await revokeAllUserSessions(userId);

  await logAuthAudit(
    'user.anonymized',
    auditCtx(actor, {
      targetUserId: userId,
      ipHash: ctx?.ipHash,
      userAgentHash: ctx?.userAgentHash,
    }),
  );

  return toPublicUser(updated);
}

export async function revokeUserSessionsAdmin(
  actor: AdminActor,
  userId: string,
  ctx?: { ipHash?: string; userAgentHash?: string },
): Promise<{ revokedCount: number }> {
  assertPlatformOperation(actor);

  const user = await findUserById(userId);
  if (!user) throw new NotFoundError('Usuário não encontrado.');

  const revokedCount = await revokeAllUserSessions(userId);

  await logAuthAudit(
    'user.sessions_revoked',
    auditCtx(actor, {
      targetUserId: userId,
      ipHash: ctx?.ipHash,
      userAgentHash: ctx?.userAgentHash,
      metadata: { revokedCount },
    }),
  );

  return { revokedCount };
}
