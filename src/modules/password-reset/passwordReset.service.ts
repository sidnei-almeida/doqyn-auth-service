import { prisma } from '../../db/prisma.js';
import { loadEnv, isProduction } from '../../config/env.js';
import { hashPasswordResetToken } from '../../security/crypto.js';
import { generatePasswordResetToken } from '../../security/sessionToken.js';
import { hashPassword, validatePasswordStrength } from '../../security/password.js';
import { revokeAllUserSessions } from '../sessions/sessions.service.js';
import { findUserByEmailLookup } from '../users/users.service.js';

export interface PasswordResetRequestResult {
  resetToken?: string;
  userId?: string;
}

export async function requestPasswordReset(email: string): Promise<PasswordResetRequestResult> {
  const user = await findUserByEmailLookup(email);
  if (!user) {
    return {};
  }

  const token = generatePasswordResetToken();
  const tokenHash = hashPasswordResetToken(token);
  const env = loadEnv();
  const expiresAt = new Date(Date.now() + env.PASSWORD_RESET_TTL_MINUTES * 60 * 1000);

  await prisma.authPasswordReset.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt,
    },
  });

  const result: PasswordResetRequestResult = { userId: user.id };

  if (!isProduction(env)) {
    result.resetToken = token;
  }

  return result;
}

export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<{ success: true; userId: string } | { success: false; reason: string }> {
  const strengthError = validatePasswordStrength(newPassword);
  if (strengthError) {
    return { success: false, reason: strengthError };
  }

  const tokenHash = hashPasswordResetToken(token);
  const resetRecord = await prisma.authPasswordReset.findUnique({
    where: { tokenHash },
  });

  if (!resetRecord) {
    return { success: false, reason: 'Token inválido ou expirado.' };
  }

  if (resetRecord.usedAt) {
    return { success: false, reason: 'Token já utilizado.' };
  }

  if (resetRecord.expiresAt <= new Date()) {
    return { success: false, reason: 'Token inválido ou expirado.' };
  }

  // Hash fora da transação: argon2 é lento, e a transação seguraria uma conexão do pgbouncer
  // enquanto isso.
  const passwordHash = await hashPassword(newPassword);

  // O token é consumido por um UPDATE condicional, e a senha é escrita no mesmo `tx`. Antes o
  // `usedAt` era conferido numa leitura e gravado sem condição, e a senha ia pelo `prisma` global,
  // fora da transação: duas requisições com o mesmo token passavam as duas e trocavam a senha duas
  // vezes.
  const claimed = await prisma.$transaction(async (tx) => {
    const claim = await tx.authPasswordReset.updateMany({
      where: { id: resetRecord.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (claim.count !== 1) return false;

    await tx.authCredential.upsert({
      where: { userId: resetRecord.userId },
      create: { userId: resetRecord.userId, passwordHash },
      update: { passwordHash, passwordUpdatedAt: new Date() },
    });
    return true;
  });

  if (!claimed) {
    return { success: false, reason: 'Token já utilizado.' };
  }

  await revokeAllUserSessions(resetRecord.userId);

  return { success: true, userId: resetRecord.userId };
}
