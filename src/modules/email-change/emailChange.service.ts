import { prisma } from '../../db/prisma.js';
import { getPublicAppBaseUrl, isProduction, loadEnv } from '../../config/env.js';
import { decryptField, encryptField, hashEmailChangeToken, hashLookup } from '../../security/crypto.js';
import { verifyPassword } from '../../security/password.js';
import { generateEmailChangeToken } from '../../security/sessionToken.js';
import {
  checkEmailChangeConfirmRateLimit,
  checkEmailChangeRequestRateLimit,
} from '../../security/rateLimit.js';
import {
  ConflictError,
  GoneError,
  NotFoundError,
  ValidationError,
} from '../../utils/errors.js';
import { normalizeEmail } from '../../utils/normalize.js';
import { logAuthAudit } from '../audit/authAudit.service.js';
import { sendEmail } from '../email/email.service.js';
import { renderEmailChangeEmail } from '../email/renderEmailChangeEmail.js';
import { findMembershipById, listUserMemberships } from '../memberships/memberships.service.js';
import { getSessionRecordByToken } from '../memberships/sessionContext.service.js';
import {
  getTenantFromDomain,
  resolveTenantSmtpTransport,
} from '../tenant-email/tenantOutboundEmail.service.js';
import {
  findUserByEmailLookup,
  findUserById,
  getUserCredential,
  toPublicUser,
} from '../users/users.service.js';
import type { RequestEmailChangeInput } from './emailChange.schemas.js';

function emailChangePath(token: string): string {
  return `/confirmar-email/${encodeURIComponent(token)}`;
}

async function resolveUserTenantUuid(userId: string, sessionToken: string): Promise<string | null> {
  const session = await getSessionRecordByToken(sessionToken);
  if (session?.activeMembershipId && session.userId === userId) {
    const membership = await findMembershipById(session.activeMembershipId);
    if (membership?.userId === userId) {
      return membership.tenantId;
    }
  }

  const memberships = await listUserMemberships(userId);
  const active = memberships.filter((membership) => membership.status === 'active');
  if (active.length === 1) {
    return active[0].tenantId;
  }

  return null;
}

function assertNewEmailDomainAllowed(newEmail: string, fromDomain: string | null): void {
  if (!fromDomain) return;
  const domain = normalizeEmail(newEmail).split('@')[1]?.toLowerCase();
  if (!domain || domain !== fromDomain.toLowerCase()) {
    throw new ValidationError(
      `Use um e-mail profissional do domínio @${fromDomain}.`,
      'EMAIL_DOMAIN_MISMATCH',
    );
  }
}

async function invalidatePendingEmailChanges(userId: string): Promise<void> {
  await prisma.authEmailChange.updateMany({
    where: { userId, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
}

export async function getEmailChangeStatus(userId: string) {
  const pending = await prisma.authEmailChange.findFirst({
    where: { userId, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });

  if (!pending) {
    return { pending: false as const };
  }

  return {
    pending: true as const,
    newEmail: decryptField(pending.newEmailEncrypted),
    expiresAt: pending.expiresAt.toISOString(),
  };
}

export async function requestEmailChange(
  userId: string,
  input: RequestEmailChangeInput,
  sessionToken: string,
  ipHash?: string,
) {
  if (ipHash) {
    await checkEmailChangeRequestRateLimit(ipHash, userId);
  }

  const user = await findUserById(userId);
  if (!user) {
    throw new NotFoundError('Usuário não encontrado.');
  }

  const credential = await getUserCredential(userId);
  if (!credential) {
    throw new ValidationError(
      'Contas sem senha local não podem alterar e-mail por aqui.',
      'PASSWORD_REQUIRED',
    );
  }

  const passwordValid = await verifyPassword(input.password, credential.passwordHash);
  if (!passwordValid) {
    throw new ValidationError('Senha incorreta.', 'INVALID_PASSWORD');
  }

  const currentEmail = decryptField(user.emailEncrypted);
  const newEmail = normalizeEmail(input.newEmail);

  if (newEmail === currentEmail) {
    throw new ValidationError('O novo e-mail deve ser diferente do atual.', 'EMAIL_UNCHANGED');
  }

  const duplicate = await findUserByEmailLookup(newEmail);
  if (duplicate && duplicate.id !== userId) {
    throw new ConflictError('Este e-mail já está em uso.', 'EMAIL_ALREADY_EXISTS');
  }

  const tenantUuid = await resolveUserTenantUuid(userId, sessionToken);
  const fromDomain = tenantUuid ? await getTenantFromDomain(tenantUuid) : null;
  assertNewEmailDomainAllowed(newEmail, fromDomain);

  await invalidatePendingEmailChanges(userId);

  const token = generateEmailChangeToken();
  const tokenHash = hashEmailChangeToken(token);
  const env = loadEnv();
  const expiresAt = new Date(Date.now() + env.EMAIL_CHANGE_TTL_HOURS * 60 * 60 * 1000);

  await prisma.authEmailChange.create({
    data: {
      userId,
      newEmailEncrypted: encryptField(newEmail),
      newEmailLookupHash: hashLookup(newEmail),
      tokenHash,
      expiresAt,
    },
  });

  const confirmUrl = `${getPublicAppBaseUrl(env)}${emailChangePath(token)}`;
  const { subject, text, html } = renderEmailChangeEmail({
    currentEmail,
    newEmail,
    confirmUrl,
    expiresInHours: env.EMAIL_CHANGE_TTL_HOURS,
  });

  const inviterPublic = toPublicUser(user);
  const inviterName =
    [inviterPublic.firstName, inviterPublic.lastName].filter(Boolean).join(' ').trim() ||
    inviterPublic.email;
  const smtpTransport = tenantUuid ? await resolveTenantSmtpTransport(tenantUuid) : null;

  let emailSent = false;
  if (env.EMAIL_ENABLED && smtpTransport) {
    try {
      await sendEmail(
        {
          to: newEmail,
          subject,
          text,
          html,
          from: { name: inviterName, email: currentEmail },
          replyTo: { name: inviterName, email: currentEmail },
        },
        smtpTransport,
      );
      emailSent = true;
    } catch {
      emailSent = false;
    }
  } else if (!env.EMAIL_ENABLED) {
    await sendEmail({
      to: newEmail,
      subject,
      text,
      html,
      from: { name: inviterName, email: currentEmail },
    });
  }

  await logAuthAudit('email_change.requested', {
    userId,
    metadata: {
      newEmailLookupHash: hashLookup(newEmail),
      emailSent,
    },
    ipHash,
  });

  return {
    ok: true as const,
    message: emailSent
      ? `Enviamos um link de confirmação para ${newEmail}.`
      : `Confirmação criada. Configure o SMTP da empresa ou use o link abaixo em desenvolvimento.`,
    pendingEmail: newEmail,
    expiresAt: expiresAt.toISOString(),
    emailSent,
    ...(!isProduction(env) ? { confirmToken: token, confirmUrl } : {}),
  };
}

async function findEmailChangeByToken(token: string) {
  const tokenHash = hashEmailChangeToken(token);
  return prisma.authEmailChange.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
}

export async function previewEmailChange(token: string) {
  const change = await findEmailChangeByToken(token);
  if (!change) {
    throw new NotFoundError('Link inválido ou expirado.', 'EMAIL_CHANGE_NOT_FOUND');
  }
  if (change.usedAt) {
    throw new GoneError('Este link já foi utilizado.', 'EMAIL_CHANGE_ALREADY_USED');
  }
  if (change.expiresAt <= new Date()) {
    throw new GoneError('Este link expirou.', 'EMAIL_CHANGE_EXPIRED');
  }

  return {
    ok: true as const,
    currentEmail: decryptField(change.user.emailEncrypted),
    newEmail: decryptField(change.newEmailEncrypted),
    expiresAt: change.expiresAt.toISOString(),
  };
}

export async function confirmEmailChange(token: string, ipHash?: string) {
  if (ipHash) {
    await checkEmailChangeConfirmRateLimit(ipHash);
  }

  const change = await findEmailChangeByToken(token);
  if (!change) {
    throw new NotFoundError('Link inválido ou expirado.', 'EMAIL_CHANGE_NOT_FOUND');
  }
  if (change.usedAt) {
    throw new GoneError('Este link já foi utilizado.', 'EMAIL_CHANGE_ALREADY_USED');
  }
  if (change.expiresAt <= new Date()) {
    throw new GoneError('Este link expirou.', 'EMAIL_CHANGE_EXPIRED');
  }

  const newEmail = decryptField(change.newEmailEncrypted);
  const duplicate = await findUserByEmailLookup(newEmail);
  if (duplicate && duplicate.id !== change.userId) {
    throw new ConflictError('Este e-mail já está em uso.', 'EMAIL_ALREADY_EXISTS');
  }

  const user = await prisma.$transaction(async (tx) => {
    await tx.authEmailChange.update({
      where: { id: change.id },
      data: { usedAt: new Date() },
    });
    await tx.authEmailChange.updateMany({
      where: {
        userId: change.userId,
        usedAt: null,
        id: { not: change.id },
      },
      data: { usedAt: new Date() },
    });
    return tx.authUser.update({
      where: { id: change.userId },
      data: {
        emailEncrypted: encryptField(newEmail),
        emailLookupHash: hashLookup(newEmail),
        emailVerified: true,
      },
    });
  });

  await logAuthAudit('email_change.confirmed', {
    userId: change.userId,
    metadata: { newEmailLookupHash: hashLookup(newEmail) },
    ipHash,
  });

  return {
    ok: true as const,
    message: 'E-mail atualizado com sucesso. Use o novo endereço no próximo login.',
    user: toPublicUser(user),
  };
}
