import { prisma } from '../../db/prisma.js';
import { getPublicAppBaseUrl, loadEnv } from '../../config/env.js';
import { decryptField, hashPasswordResetToken } from '../../security/crypto.js';
import { generatePasswordResetToken } from '../../security/sessionToken.js';
import { hashPassword, validatePasswordStrength } from '../../security/password.js';
import { logAuthAudit } from '../audit/authAudit.service.js';
import {
  getPlatformSender,
  isPlatformEmailConfigured,
  redactEmailsInText,
  sendEmail,
} from '../email/email.service.js';
import { renderPasswordResetEmail } from '../email/renderPasswordResetEmail.js';
import { revokeAllUserSessions } from '../sessions/sessions.service.js';
import { findUserByEmailLookup } from '../users/users.service.js';

export interface PasswordResetRequestResult {
  userId?: string;
  token?: string;
  email?: string;
  locale?: string | null;
}

function resetPath(token: string): string {
  return `/reset-password/${encodeURIComponent(token)}`;
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

  // O token cru sempre volta daqui; quem decide o que chega pela HTTP (só fora de produção) é a
  // camada de cima — este serviço não sabe, e não deveria saber, em que ambiente está rodando.
  return {
    userId: user.id,
    token,
    email: decryptField(user.emailEncrypted),
    locale: user.locale,
  };
}

/**
 * Monta e manda o e-mail de redefinição, e audita o pedido — mesmo quando o envio falha.
 *
 * Nunca relança: quem chama já devolveu a resposta genérica de `handlePasswordResetRequest`
 * antes deste disparo terminar, então uma exceção aqui não teria mais ninguém esperando por ela.
 */
export async function deliverPasswordResetEmail(input: {
  userId: string;
  token: string;
  email: string;
  locale?: string | null;
  ipHash?: string;
  userAgentHash?: string;
}): Promise<boolean> {
  let emailSent = false;
  let failureReason: string | undefined;

  try {
    const env = loadEnv();
    const resetUrl = `${getPublicAppBaseUrl(env)}${resetPath(input.token)}`;
    const { subject, text, html } = renderPasswordResetEmail({
      resetUrl,
      expiresInMinutes: env.PASSWORD_RESET_TTL_MINUTES,
      locale: input.locale,
    });

    if (isPlatformEmailConfigured()) {
      const sender = getPlatformSender();
      try {
        await sendEmail({
          to: input.email,
          subject,
          text,
          html,
          from: { name: sender.name, email: sender.email },
        });
        emailSent = true;
      } catch (error) {
        // O corpo do erro do provedor (Resend, SMTP) pode repetir o destinatário, então o
        // endereço sai mascarado antes de virar log ou metadata de auditoria.
        failureReason = redactEmailsInText(
          error instanceof Error ? error.message : String(error),
        );
        console.error('Envio do e-mail de redefinição de senha falhou:', failureReason);
        emailSent = false;
      }
    }
  } catch (error) {
    failureReason = redactEmailsInText(error instanceof Error ? error.message : String(error));
    console.error('Falha ao preparar o e-mail de redefinição de senha:', failureReason);
    emailSent = false;
  } finally {
    // "Pediu redefinição" é fato independente de o e-mail ter saído — a auditoria sai mesmo se a
    // renderização quebrar.
    await logAuthAudit('password.reset_requested', {
      userId: input.userId,
      ipHash: input.ipHash,
      userAgentHash: input.userAgentHash,
      metadata: { emailSent, ...(failureReason ? { failureReason } : {}) },
    });
  }

  return emailSent;
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
