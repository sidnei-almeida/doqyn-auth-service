import { prisma } from '../../db/prisma.js';
import { hashSessionToken } from '../../security/crypto.js';
import { getSessionTtlSeconds } from '../../security/cookies.js';
import { generateSessionToken } from '../../security/sessionToken.js';
import type { PublicUser } from '../users/users.schemas.js';
import { findUserById, toPublicUser } from '../users/users.service.js';

export interface CreateSessionResult {
  token: string;
  user: PublicUser;
  sessionId: string;
}

export async function createSession(
  userId: string,
  ipHash?: string,
  userAgentHash?: string,
): Promise<CreateSessionResult> {
  const token = generateSessionToken();
  const sessionTokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + getSessionTtlSeconds() * 1000);

  const session = await prisma.authSession.create({
    data: {
      userId,
      sessionTokenHash,
      expiresAt,
      ipHash: ipHash ?? null,
      userAgentHash: userAgentHash ?? null,
    },
  });

  const user = await findUserById(userId);
  if (!user) {
    throw new Error('User not found after session creation');
  }

  return {
    token,
    user: toPublicUser(user),
    sessionId: session.id,
  };
}

export async function validateSessionByToken(
  token: string,
): Promise<{ valid: true; user: PublicUser } | { valid: false; code: string }> {
  const sessionTokenHash = hashSessionToken(token);
  const session = await prisma.authSession.findUnique({
    where: { sessionTokenHash },
  });

  if (!session) {
    return { valid: false, code: 'INVALID_SESSION' };
  }

  if (session.revokedAt) {
    return { valid: false, code: 'INVALID_SESSION' };
  }

  if (session.expiresAt <= new Date()) {
    return { valid: false, code: 'INVALID_SESSION' };
  }

  const user = await findUserById(session.userId);
  if (!user) {
    return { valid: false, code: 'INVALID_SESSION' };
  }

  return { valid: true, user: toPublicUser(user) };
}

export async function revokeSessionByToken(token: string): Promise<boolean> {
  const sessionTokenHash = hashSessionToken(token);
  const session = await prisma.authSession.findUnique({
    where: { sessionTokenHash },
  });

  if (!session || session.revokedAt) {
    return false;
  }

  await prisma.authSession.update({
    where: { id: session.id },
    data: { revokedAt: new Date() },
  });

  return true;
}

export async function revokeAllUserSessions(userId: string): Promise<void> {
  await prisma.authSession.updateMany({
    where: {
      userId,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  });
}
