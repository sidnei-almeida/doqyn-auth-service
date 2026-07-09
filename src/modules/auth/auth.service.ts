import { prisma } from '../../db/prisma.js';
import { hashLookup } from '../../security/crypto.js';
import { verifyPassword } from '../../security/password.js';
import {
  checkLoginRateLimit,
  checkPasswordResetRateLimit,
  checkPasswordResetRequestRateLimit,
} from '../../security/rateLimit.js';
import type { RequestContext } from '../../security/requestContext.js';
import { normalizeEmail } from '../../utils/normalize.js';
import { logAuthAudit } from '../audit/authAudit.service.js';
import {
  requestPasswordReset,
  resetPassword as resetPasswordService,
} from '../password-reset/passwordReset.service.js';
import { changePassword as changePasswordService } from '../change-password/changePassword.service.js';
import type { ChangePasswordInput } from '../change-password/changePassword.schemas.js';
import {
  createSession,
  revokeSessionByToken,
  validateSessionByToken,
} from '../sessions/sessions.service.js';
import type { PublicUser } from '../users/users.schemas.js';
import { buildSessionContext, getSessionRecordByToken } from '../memberships/sessionContext.service.js';
import type { SessionContext } from '../memberships/memberships.schemas.js';
import {
  findUserByEmailLookup,
  getUserCredential,
  isUserLoginAllowed,
  toPublicUser,
} from '../users/users.service.js';
import type { AuthErrorCode } from '../../utils/authErrorCodes.js';
import { AUTH_ERROR_MESSAGES } from '../../utils/authErrorCodes.js';
import { resolveMembershipAccessError } from '../../utils/membershipAccessErrors.js';
import type { LoginInput } from './auth.schemas.js';
const GENERIC_RESET_MESSAGE =
  'Se o e-mail existir, enviaremos instruções para redefinir a senha.';

async function recordLoginAttempt(
  emailLookupHash: string | null,
  ipHash: string,
  success: boolean,
  reason?: string,
): Promise<void> {
  await prisma.authLoginAttempt.create({
    data: {
      emailLookupHash,
      ipHash,
      success,
      reason: reason ?? null,
    },
  });
}

export interface LoginResult {
  success: true;
  user: PublicUser;
  sessionToken: string;
}

export interface LoginFailure {
  success: false;
  code: AuthErrorCode;
  message: string;
  statusCode: number;
  details?: Record<string, unknown>;
}

export async function login(
  input: LoginInput,
  ctx: RequestContext,
): Promise<LoginResult | LoginFailure> {
  const normalizedEmail = normalizeEmail(input.email);
  const emailLookupHash = hashLookup(normalizedEmail);

  try {
    checkLoginRateLimit(ctx.ipHash, emailLookupHash);
  } catch {
    await recordLoginAttempt(emailLookupHash, ctx.ipHash, false, 'rate_limit');
    return {
      success: false,
      code: 'RATE_LIMIT',
      message: AUTH_ERROR_MESSAGES.RATE_LIMIT,
      statusCode: 429,
    };
  }

  const user = await findUserByEmailLookup(normalizedEmail);

  if (!user) {
    await recordLoginAttempt(emailLookupHash, ctx.ipHash, false, 'user_not_found');
    await logAuthAudit('login.failed', {
      ipHash: ctx.ipHash,
      userAgentHash: ctx.userAgentHash,
      metadata: { reason: 'user_not_found' },
    });
    return {
      success: false,
      code: 'INVALID_CREDENTIALS',
      message: AUTH_ERROR_MESSAGES.INVALID_CREDENTIALS,
      statusCode: 401,
    };
  }

  if (!isUserLoginAllowed(user.status)) {
    await recordLoginAttempt(emailLookupHash, ctx.ipHash, false, 'user_disabled');
    await logAuthAudit('login.failed', {
      userId: user.id,
      ipHash: ctx.ipHash,
      userAgentHash: ctx.userAgentHash,
      metadata: { reason: 'user_disabled' },
    });
    return {
      success: false,
      code: 'USER_DISABLED',
      message: AUTH_ERROR_MESSAGES.USER_DISABLED,
      statusCode: 403,
    };
  }

  const credential = await getUserCredential(user.id);
  if (!credential) {
    await recordLoginAttempt(emailLookupHash, ctx.ipHash, false, 'no_credential');
    await logAuthAudit('login.failed', {
      userId: user.id,
      ipHash: ctx.ipHash,
      userAgentHash: ctx.userAgentHash,
      metadata: { reason: 'no_credential' },
    });
    return {
      success: false,
      code: 'INVALID_CREDENTIALS',
      message: AUTH_ERROR_MESSAGES.INVALID_CREDENTIALS,
      statusCode: 401,
    };
  }

  const passwordValid = await verifyPassword(input.password, credential.passwordHash);
  if (!passwordValid) {
    await recordLoginAttempt(emailLookupHash, ctx.ipHash, false, 'invalid_password');
    await logAuthAudit('login.failed', {
      userId: user.id,
      ipHash: ctx.ipHash,
      userAgentHash: ctx.userAgentHash,
      metadata: { reason: 'invalid_password' },
    });
    return {
      success: false,
      code: 'INVALID_CREDENTIALS',
      message: AUTH_ERROR_MESSAGES.INVALID_CREDENTIALS,
      statusCode: 401,
    };
  }

  const { listUserMemberships } = await import('../memberships/memberships.service.js');
  const memberships = await listUserMemberships(user.id);
  const activeMemberships = memberships.filter(
    (membership) => membership.status === 'active' && membership.tenant.status === 'active',
  );
  const visibleMemberships = memberships.filter((membership) => membership.status !== 'removed');

  if (activeMemberships.length === 0 && visibleMemberships.length > 0) {
    const accessError = resolveMembershipAccessError(memberships);
    await recordLoginAttempt(emailLookupHash, ctx.ipHash, false, accessError.code);
    await logAuthAudit('login.failed', {
      userId: user.id,
      ipHash: ctx.ipHash,
      userAgentHash: ctx.userAgentHash,
      metadata: { reason: accessError.code, ...accessError.details },
    });
    return {
      success: false,
      code: accessError.code,
      message: accessError.message,
      statusCode: accessError.statusCode,
      details: accessError.details,
    };
  }

  const session = await createSession(user.id, ctx.ipHash, ctx.userAgentHash);

  await prisma.authUser.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const { hashSessionToken } = await import('../../security/crypto.js');
  if (activeMemberships.length === 1) {
    await prisma.authSession.update({
      where: { sessionTokenHash: hashSessionToken(session.token) },
      data: { activeMembershipId: activeMemberships[0].id },
    });
  }

  await recordLoginAttempt(emailLookupHash, ctx.ipHash, true);
  await logAuthAudit('login.success', {
    userId: user.id,
    ipHash: ctx.ipHash,
    userAgentHash: ctx.userAgentHash,
  });

  return {
    success: true,
    user: session.user,
    sessionToken: session.token,
  };
}

export async function logout(
  sessionToken: string | undefined,
  ctx: RequestContext,
): Promise<void> {
  if (!sessionToken) {
    return;
  }

  const validation = await validateSessionByToken(sessionToken);
  const userId = validation.valid ? validation.user.id : undefined;

  await revokeSessionByToken(sessionToken);

  if (userId) {
    await logAuthAudit('logout', {
      userId,
      ipHash: ctx.ipHash,
      userAgentHash: ctx.userAgentHash,
    });
  }
}

export async function getSession(
  sessionToken: string | undefined,
): Promise<SessionContext & { ok: true } | { ok: false; code: string }> {
  if (!sessionToken) {
    return { ok: false, code: 'NO_SESSION' };
  }

  const result = await validateSessionByToken(sessionToken);
  if (!result.valid) {
    return { ok: false, code: result.code };
  }

  const session = await getSessionRecordByToken(sessionToken);
  const context = await buildSessionContext(result.user, session?.activeMembershipId);

  return { ok: true, ...context };
}

export async function selectTenant(
  sessionToken: string,
  userId: string,
  tenantId?: string,
  membershipId?: string,
): Promise<
  | { ok: true; context: SessionContext }
  | { ok: false; code: string; message: string; statusCode: number }
> {
  const { selectTenantForSession } = await import('../admin/adminAuth.js');
  const success = await selectTenantForSession(userId, sessionToken, tenantId, membershipId);

  if (!success) {
    return {
      ok: false,
      code: 'MEMBERSHIP_NOT_FOUND',
      message: AUTH_ERROR_MESSAGES.MEMBERSHIP_NOT_FOUND,
      statusCode: 404,
    };
  }

  const result = await validateSessionByToken(sessionToken);
  if (!result.valid) {
    return {
      ok: false,
      code: 'INVALID_SESSION',
      message: AUTH_ERROR_MESSAGES.INVALID_SESSION,
      statusCode: 401,
    };
  }

  const session = await getSessionRecordByToken(sessionToken);
  const context = await buildSessionContext(result.user, session?.activeMembershipId);

  await logAuthAudit('tenant.selected', {
    userId,
    metadata: { tenantId, membershipId },
  });

  return { ok: true, context };
}

export async function handlePasswordResetRequest(
  email: string,
  ctx: RequestContext,
): Promise<{ ok: true; message: string; resetToken?: string }> {
  const normalizedEmail = normalizeEmail(email);
  const emailLookupHash = hashLookup(normalizedEmail);

  try {
    checkPasswordResetRequestRateLimit(ctx.ipHash, emailLookupHash);
  } catch {
    return { ok: true, message: GENERIC_RESET_MESSAGE };
  }

  const result = await requestPasswordReset(normalizedEmail);

  if (result.userId) {
    await logAuthAudit('password.reset_requested', {
      userId: result.userId,
      ipHash: ctx.ipHash,
      userAgentHash: ctx.userAgentHash,
    });
  }

  return {
    ok: true,
    message: GENERIC_RESET_MESSAGE,
    resetToken: result.resetToken,
  };
}

export async function handlePasswordReset(
  token: string,
  newPassword: string,
  ctx: RequestContext,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    checkPasswordResetRateLimit(ctx.ipHash);
  } catch {
    return { ok: false, message: 'Muitas tentativas. Tente novamente mais tarde.' };
  }

  const result = await resetPasswordService(token, newPassword);

  if (!result.success) {
    return { ok: false, message: result.reason };
  }

  await logAuthAudit('password.reset_completed', {
    userId: result.userId,
    ipHash: ctx.ipHash,
    userAgentHash: ctx.userAgentHash,
  });

  return { ok: true };
}

export async function handleChangePassword(
  userId: string,
  input: ChangePasswordInput,
  sessionToken: string,
  ctx: RequestContext,
): Promise<
  | { ok: true; message: string; revokedOtherSessions: number }
  | { ok: false; message: string; code?: string }
> {
  const result = await changePasswordService(userId, input, sessionToken);

  if (!result.success) {
    return { ok: false, message: result.reason, code: result.code };
  }

  await logAuthAudit('password.updated', {
    userId,
    ipHash: ctx.ipHash,
    userAgentHash: ctx.userAgentHash,
    metadata: { revokedOtherSessions: result.revokedOtherSessions },
  });

  return {
    ok: true,
    message: 'Senha alterada com sucesso.',
    revokedOtherSessions: result.revokedOtherSessions,
  };
}

export async function getPublicUserById(userId: string): Promise<PublicUser | null> {
  const { findUserById } = await import('../users/users.service.js');
  const user = await findUserById(userId);
  return user ? toPublicUser(user) : null;
}
