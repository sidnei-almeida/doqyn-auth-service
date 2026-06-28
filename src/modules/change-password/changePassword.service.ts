import { validatePasswordStrength, verifyPassword } from '../../security/password.js';
import { revokeOtherUserSessions } from '../sessions/sessions.service.js';
import { getUserCredential, updateUserPassword } from '../users/users.service.js';
import type { ChangePasswordInput } from './changePassword.schemas.js';

export type ChangePasswordResult =
  | { success: true; revokedOtherSessions: number }
  | {
      success: false;
      reason: string;
      code: 'INVALID_CURRENT_PASSWORD' | 'WEAK_PASSWORD' | 'PASSWORD_UNCHANGED';
    };

export async function changePassword(
  userId: string,
  input: ChangePasswordInput,
  keepSessionToken: string,
): Promise<ChangePasswordResult> {
  const strengthError = validatePasswordStrength(input.newPassword);
  if (strengthError) {
    return { success: false, reason: strengthError, code: 'WEAK_PASSWORD' };
  }

  const credential = await getUserCredential(userId);
  if (!credential) {
    return {
      success: false,
      reason: 'Senha atual incorreta.',
      code: 'INVALID_CURRENT_PASSWORD',
    };
  }

  const currentValid = await verifyPassword(input.currentPassword, credential.passwordHash);
  if (!currentValid) {
    return {
      success: false,
      reason: 'Senha atual incorreta.',
      code: 'INVALID_CURRENT_PASSWORD',
    };
  }

  const sameAsCurrent = await verifyPassword(input.newPassword, credential.passwordHash);
  if (sameAsCurrent) {
    return {
      success: false,
      reason: 'A nova senha deve ser diferente da senha atual.',
      code: 'PASSWORD_UNCHANGED',
    };
  }

  await updateUserPassword(userId, input.newPassword);
  const revokedOtherSessions = await revokeOtherUserSessions(userId, keepSessionToken);

  return { success: true, revokedOtherSessions };
}
