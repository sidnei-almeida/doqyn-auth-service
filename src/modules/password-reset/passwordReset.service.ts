import { prisma } from '../../db/prisma.js';
import { loadEnv, isProduction } from '../../config/env.js';
import { hashPasswordResetToken } from '../../security/crypto.js';
import { generatePasswordResetToken } from '../../security/sessionToken.js';
import { validatePasswordStrength } from '../../security/password.js';
import { revokeAllUserSessions } from '../sessions/sessions.service.js';
import { findUserByEmailLookup, updateUserPassword } from '../users/users.service.js';

export interface PasswordResetRequestResult {
  resetToken?: string;
  userId?: string;
}

export async function requestPasswordReset(
  email: string,
): Promise<PasswordResetRequestResult> {
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

  await prisma.$transaction(async (tx) => {
    await updateUserPassword(resetRecord.userId, newPassword);
    await tx.authPasswordReset.update({
      where: { id: resetRecord.id },
      data: { usedAt: new Date() },
    });
  });

  await revokeAllUserSessions(resetRecord.userId);

  return { success: true, userId: resetRecord.userId };
}
