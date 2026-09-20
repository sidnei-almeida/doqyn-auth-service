import { timingSafeEqual } from 'node:crypto';

import type { AuthUser } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { getPublicAppBaseUrl, isProduction, loadEnv } from '../../config/env.js';
import {
  decryptField,
  encryptField,
  hashEmailChangeCode,
  hashEmailChangeToken,
  hashLookup,
} from '../../security/crypto.js';
import { verifyPassword } from '../../security/password.js';
import {
  generateEmailChangeToken,
  generateEmailVerificationCode,
} from '../../security/sessionToken.js';
import {
  checkEmailChangeCodeRateLimit,
  checkEmailChangeConfirmRateLimit,
  checkEmailChangeRequestRateLimit,
} from '../../security/rateLimit.js';
import { ConflictError, GoneError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { normalizeEmail } from '../../utils/normalize.js';
import { logAuthAudit } from '../audit/authAudit.service.js';
import { getPlatformSender } from '../email/email.service.js';
import { enqueueEmail } from '../email/emailOutbox.service.js';
import { renderEmailChangeEmail } from '../email/renderEmailChangeEmail.js';
import {
  findUserByEmailLookup,
  findUserById,
  getUserCredential,
  toPublicUser,
} from '../users/users.service.js';
import type { RequestEmailChangeInput } from './emailChange.schemas.js';

function emailChangePath(token: string): string {
  return `/confirm-email-change/${encodeURIComponent(token)}`;
}

async function invalidatePendingEmailChanges(userId: string): Promise<void> {
  await prisma.authEmailChange.updateMany({
    where: { userId, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
}

function findPendingEmailChange(userId: string) {
  return prisma.authEmailChange.findFirst({
    where: { userId, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getEmailChangeStatus(userId: string) {
  const pending = await findPendingEmailChange(userId);

  if (!pending) {
    return { pending: false as const };
  }

  const env = loadEnv();
  return {
    pending: true as const,
    newEmail: decryptField(pending.newEmailEncrypted),
    expiresAt: pending.expiresAt.toISOString(),
    linkExpiresAt: pending.tokenExpiresAt.toISOString(),
    attemptsLeft: Math.max(0, env.EMAIL_CHANGE_MAX_ATTEMPTS - pending.attempts),
    canResendAt: pending.sentAt
      ? new Date(
          pending.sentAt.getTime() + env.EMAIL_CHANGE_RESEND_COOLDOWN_SECONDS * 1000,
        ).toISOString()
      : undefined,
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

  await invalidatePendingEmailChanges(userId);

  return issueEmailChange(userId, currentEmail, newEmail, user, ipHash);
}

/**
 * Emite código e link para um endereço novo, e manda o e-mail.
 *
 * Compartilhado entre pedir e reenviar, do mesmo jeito que a confirmação de cadastro faz: reenviar
 * é o mesmo trabalho outra vez, e duplicá-lo era o caminho para os dois divergirem.
 */
async function issueEmailChange(
  userId: string,
  currentEmail: string,
  newEmail: string,
  user: AuthUser,
  ipHash?: string,
) {
  const env = loadEnv();
  const code = generateEmailVerificationCode();
  const token = generateEmailChangeToken();
  const expiresAt = new Date(Date.now() + env.EMAIL_CHANGE_CODE_TTL_MINUTES * 60 * 1000);
  const tokenExpiresAt = new Date(Date.now() + env.EMAIL_CHANGE_TTL_HOURS * 60 * 60 * 1000);

  const created = await prisma.authEmailChange.create({
    data: {
      userId,
      newEmailEncrypted: encryptField(newEmail),
      newEmailLookupHash: hashLookup(newEmail),
      codeHash: hashEmailChangeCode(userId, code),
      tokenHash: hashEmailChangeToken(token),
      expiresAt,
      tokenExpiresAt,
    },
  });

  const confirmUrl = `${getPublicAppBaseUrl(env)}${emailChangePath(token)}`;
  const { subject, text, html } = renderEmailChangeEmail({
    currentEmail,
    newEmail,
    code,
    confirmUrl,
    expiresInMinutes: env.EMAIL_CHANGE_CODE_TTL_MINUTES,
    expiresInHours: env.EMAIL_CHANGE_TTL_HOURS,
    locale: user.locale,
  });

  const requesterPublic = toPublicUser(user);
  const requesterName =
    [requesterPublic.firstName, requesterPublic.lastName].filter(Boolean).join(' ').trim() ||
    requesterPublic.email;
  const sender = getPlatformSender();
  const message = {
    to: newEmail,
    subject,
    text,
    html,
    from: { name: sender.name, email: sender.email },
    replyTo: { name: requesterName, email: currentEmail },
  };

  // Enfileira: a entrega é do drenador, e a resposta não espera a rede. Sem provedor
  // configurado, `enqueueEmail` cai no mesmo adapter de console que este ponto sempre usou.
  const { queued } = await enqueueEmail({ userId, purpose: 'email_change', message });
  const emailSent = queued;

  await prisma.authEmailChange.update({
    where: { id: created.id },
    data: { sentAt: new Date() },
  });

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
      ? `Enviamos um código de 6 dígitos para ${newEmail}.`
      : // SMTP por empresa foi retirado quando o envio passou a ser da plataforma. A frase
        // continuava mandando a pessoa configurar algo que não existe mais.
        'Confirmação criada, mas o e-mail não saiu. Em desenvolvimento, use o código abaixo.',
    pendingEmail: newEmail,
    expiresAt: expiresAt.toISOString(),
    linkExpiresAt: tokenExpiresAt.toISOString(),
    emailSent,
    ...(!isProduction(env) ? { confirmCode: code, confirmToken: token, confirmUrl } : {}),
  };
}

/**
 * Reenvia para o mesmo endereço já pedido.
 *
 * Não pede a senha de novo: a sessão é a mesma que acabou de fornecê-la, e o endereço de destino
 * não pode ser trocado por aqui — quem quiser outro endereço passa pelo pedido inteiro.
 */
export async function resendEmailChange(userId: string, ipHash?: string) {
  if (ipHash) {
    await checkEmailChangeRequestRateLimit(ipHash, userId);
  }

  const pending = await findPendingEmailChange(userId);
  if (!pending) {
    throw new NotFoundError(
      'Nenhuma troca de e-mail pendente. Peça a alteração novamente.',
      'EMAIL_CHANGE_NOT_FOUND',
    );
  }

  const env = loadEnv();
  if (pending.sentAt) {
    const nextAllowedAt =
      pending.sentAt.getTime() + env.EMAIL_CHANGE_RESEND_COOLDOWN_SECONDS * 1000;
    if (Date.now() < nextAllowedAt) {
      throw new ValidationError(
        `Aguarde ${Math.ceil((nextAllowedAt - Date.now()) / 1000)} segundos para pedir outro código.`,
        'EMAIL_CHANGE_RESEND_TOO_SOON',
      );
    }
  }

  const user = await findUserById(userId);
  if (!user) {
    throw new NotFoundError('Usuário não encontrado.');
  }

  await invalidatePendingEmailChanges(userId);

  return issueEmailChange(
    userId,
    decryptField(user.emailEncrypted),
    decryptField(pending.newEmailEncrypted),
    user,
    ipHash,
  );
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
  if (change.tokenExpiresAt <= new Date()) {
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
  // O link tem prazo próprio, mais longo que o do código — ver `AuthEmailChange` no schema.
  if (change.tokenExpiresAt <= new Date()) {
    throw new GoneError('Este link expirou.', 'EMAIL_CHANGE_EXPIRED');
  }

  const newEmail = decryptField(change.newEmailEncrypted);
  const duplicate = await findUserByEmailLookup(newEmail);
  if (duplicate && duplicate.id !== change.userId) {
    throw new ConflictError('Este e-mail já está em uso.', 'EMAIL_ALREADY_EXISTS');
  }

  return applyEmailChange(change.id, change.userId, newEmail, 'link', ipHash);
}

/**
 * Confirma a troca digitando os 6 dígitos.
 *
 * Aqui há sessão — trocar o e-mail é operação de quem já está dentro — então o `userId` vem dela,
 * e não de um ticket. O código é o que prova o acesso ao endereço novo.
 */
export async function confirmEmailChangeByCode(userId: string, code: string, ipHash?: string) {
  if (ipHash) {
    await checkEmailChangeCodeRateLimit(ipHash);
  }

  const pending = await findPendingEmailChange(userId);
  if (!pending) {
    throw new NotFoundError(
      'Nenhum código pendente. Peça a alteração novamente.',
      'EMAIL_CHANGE_NOT_FOUND',
    );
  }

  const env = loadEnv();
  if (pending.attempts >= env.EMAIL_CHANGE_MAX_ATTEMPTS) {
    throw new GoneError(
      'Código bloqueado por excesso de tentativas. Peça um novo.',
      'EMAIL_CHANGE_TOO_MANY_ATTEMPTS',
    );
  }

  if (!hashesMatch(pending.codeHash, hashEmailChangeCode(userId, code))) {
    const updated = await prisma.authEmailChange.update({
      where: { id: pending.id },
      data: { attempts: { increment: 1 } },
      select: { attempts: true },
    });
    const attemptsLeft = Math.max(0, env.EMAIL_CHANGE_MAX_ATTEMPTS - updated.attempts);

    throw new ValidationError(
      attemptsLeft > 0
        ? `Código incorreto. ${attemptsLeft} tentativa(s) restante(s).`
        : 'Código incorreto. O código foi bloqueado — peça um novo.',
      'EMAIL_CHANGE_INVALID_CODE',
    );
  }

  const newEmail = decryptField(pending.newEmailEncrypted);
  const duplicate = await findUserByEmailLookup(newEmail);
  if (duplicate && duplicate.id !== userId) {
    throw new ConflictError('Este e-mail já está em uso.', 'EMAIL_ALREADY_EXISTS');
  }

  return applyEmailChange(pending.id, userId, newEmail, 'code', ipHash);
}

/** Compara hashes em tempo constante — o tempo de resposta não pode dizer quantos dígitos casaram. */
function hashesMatch(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

/** O efeito é o mesmo pelos dois caminhos; só muda o que provou o acesso ao endereço. */
async function applyEmailChange(
  changeId: string,
  userId: string,
  newEmail: string,
  via: 'code' | 'link',
  ipHash?: string,
) {
  const user = await prisma.$transaction(async (tx) => {
    await tx.authEmailChange.update({
      where: { id: changeId },
      data: { usedAt: new Date() },
    });
    await tx.authEmailChange.updateMany({
      where: {
        userId,
        usedAt: null,
        id: { not: changeId },
      },
      data: { usedAt: new Date() },
    });
    return tx.authUser.update({
      where: { id: userId },
      data: {
        emailEncrypted: encryptField(newEmail),
        emailLookupHash: hashLookup(newEmail),
        emailVerified: true,
      },
    });
  });

  await logAuthAudit('email_change.confirmed', {
    userId,
    metadata: { newEmailLookupHash: hashLookup(newEmail), via },
    ipHash,
  });

  return {
    ok: true as const,
    message: 'E-mail atualizado com sucesso. Use o novo endereço no próximo login.',
    user: toPublicUser(user),
  };
}
