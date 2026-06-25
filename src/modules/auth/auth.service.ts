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
import type { LoginInput } from './auth.schemas.js';

const GENERIC_LOGIN_ERROR = 'E-mail ou senha inválidos.';
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
  message: string;
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
    return { success: false, message: GENERIC_LOGIN_ERROR };
  }

  const user = await findUserByEmailLookup(normalizedEmail);

  if (!user) {
    await recordLoginAttempt(emailLookupHash, ctx.ipHash, false, 'user_not_found');
    await logAuthAudit('login.failed', {
      ipHash: ctx.ipHash,
      userAgentHash: ctx.userAgentHash,
      metadata: { reason: 'user_not_found' },
    });
    return { success: false, message: GENERIC_LOGIN_ERROR };
  }

  if (!isUserLoginAllowed(user.status)) {
    await recordLoginAttempt(emailLookupHash, ctx.ipHash, false, 'user_disabled');
    await logAuthAudit('login.failed', {
      userId: user.id,
      ipHash: ctx.ipHash,
      userAgentHash: ctx.userAgentHash,
      metadata: { reason: 'user_disabled' },
    });
    return { success: false, message: GENERIC_LOGIN_ERROR };
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
    return { success: false, message: GENERIC_LOGIN_ERROR };
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
    return { success: false, message: GENERIC_LOGIN_ERROR };
  }

  const session = await createSession(user.id, ctx.ipHash, ctx.userAgentHash);

  await prisma.authUser.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const { listUserMemberships } = await import('../memberships/memberships.service.js');
  const { hashSessionToken } = await import('../../security/crypto.js');
  const memberships = await listUserMemberships(user.id);
  const activeMemberships = memberships.filter((m) => m.status === 'active');
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
): Promise<{ ok: true; context: SessionContext } | { ok: false; message: string }> {
  const { selectTenantForSession } = await import('../admin/adminAuth.js');
  const success = await selectTenantForSession(userId, sessionToken, tenantId, membershipId);

  if (!success) {
    return { ok: false, message: 'Membership não encontrada.' };
  }

  const result = await validateSessionByToken(sessionToken);
  if (!result.valid) {
    return { ok: false, message: 'Sessão inválida.' };
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

export async function getPublicUserById(userId: string): Promise<PublicUser | null> {
  const { findUserById } = await import('../users/users.service.js');
  const user = await findUserById(userId);
  return user ? toPublicUser(user) : null;
}
