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
import { findUserByEmailLookup, findUserById } from '../users/users.service.js';

export interface PasswordResetRequestResult {
  userId?: string;
}

function resetPath(token: string): string {
  return `/reset-password/${encodeURIComponent(token)}`;
}

/**
 * Só descobre de quem é o endereço. Nada mais.
 *
 * Tudo que distingue "existe" de "não existe" — gerar token, gravar a linha, descriptografar o
 * endereço, renderizar, enviar — foi para `deliverPasswordResetEmail`, que roda fora da resposta.
 * Enquanto a criação do token ficava aqui, o endereço conhecido pagava um INSERT que o
 * desconhecido não pagava, e a diferença é medível: quem cronometrasse a resposta enumerava as
 * contas mesmo com a mensagem sendo idêntica. Uma consulta indexada nos dois caminhos é o que
 * torna a promessa de resposta genérica verdadeira no tempo, e não só no texto.
 */
export async function requestPasswordReset(email: string): Promise<PasswordResetRequestResult> {
  const user = await findUserByEmailLookup(email);
  if (!user) {
    return {};
  }

  return { userId: user.id };
}

/**
 * Cria o token, monta o e-mail, manda, e audita o pedido — mesmo quando o envio falha.
 *
 * Roda fora da resposta HTTP em produção, e é por isso que tudo que distingue um endereço
 * conhecido de um desconhecido mora aqui: o INSERT do token e o `decryptField` do endereço, além
 * do envio. Os dois já causaram problema no caminho do pedido — o INSERT pelo tempo que
 * acrescentava, e o `decryptField` porque **lança** quando nem a chave atual nem a anterior
 * autenticam o campo (chave em rotação, linha corrompida), e ali dentro isso virava 500 para um
 * endereço que existe contra 200 para um que não existe. Aqui a captura de fora engole os dois.
 *
 * Nunca relança: em produção quem chamou já respondeu, e não há mais ninguém esperando.
 */
export async function deliverPasswordResetEmail(input: {
  userId: string;
  ipHash?: string;
  userAgentHash?: string;
}): Promise<{ emailSent: boolean; token?: string }> {
  let emailSent = false;
  let failureReason: string | undefined;
  let token: string | undefined;

  try {
    const env = loadEnv();
    const user = await findUserById(input.userId);
    if (!user) {
      // A conta sumiu entre a busca e o disparo. Não é erro de ninguém, e não há e-mail a mandar.
      failureReason = 'user_not_found';
      return { emailSent: false };
    }

    token = generatePasswordResetToken();
    await prisma.authPasswordReset.create({
      data: {
        userId: user.id,
        tokenHash: hashPasswordResetToken(token),
        expiresAt: new Date(Date.now() + env.PASSWORD_RESET_TTL_MINUTES * 60 * 1000),
      },
    });

    const email = decryptField(user.emailEncrypted);
    const resetUrl = `${getPublicAppBaseUrl(env)}${resetPath(token)}`;
    const { subject, text, html } = renderPasswordResetEmail({
      resetUrl,
      expiresInMinutes: env.PASSWORD_RESET_TTL_MINUTES,
      locale: user.locale,
    });

    if (isPlatformEmailConfigured()) {
      const sender = getPlatformSender();
      try {
        await sendEmail({
          to: email,
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
    } else {
      // Sem provedor de plataforma, o adapter de console registra e nada sai — o mesmo que o
      // código de verificação faz. O motivo vai para a auditoria com nome próprio: sem ele,
      // "ninguém recebe porque o e-mail está desligado" e "o provedor está recusando" ficavam
      // indistinguíveis, os dois gravando só `emailSent: false`.
      failureReason = 'platform_email_not_configured';
      await sendEmail({
        to: email,
        subject,
        text,
        html,
        from: { name: getPlatformSender().name, email: getPlatformSender().email },
      });
    }
  } catch (error) {
    failureReason = redactEmailsInText(error instanceof Error ? error.message : String(error));
    console.error('Falha ao preparar o e-mail de redefinição de senha:', failureReason);
    emailSent = false;
  } finally {
    // "Pediu redefinição" é fato independente de o e-mail ter saído — a auditoria sai mesmo se a
    // renderização quebrar. Falhar aqui não tem a quem avisar em produção (a resposta já foi),
    // então grita no log: é a única pista de que um pedido existiu sem deixar linha.
    //
    // A garantia continua sendo "melhor esforço": um deploy no meio desta cauda perde a linha.
    // Fechar isso de verdade pede o outbox que está planejado para o auth, não um `await` aqui —
    // esperar antes da resposta devolveria o tempo que denuncia quais contas existem.
    try {
      await logAuthAudit('password.reset_requested', {
        userId: input.userId,
        ipHash: input.ipHash,
        userAgentHash: input.userAgentHash,
        metadata: {
          emailSent,
          // Cortado: a mensagem vem de um terceiro (nodemailer repete linha crua do servidor),
          // e isto é persistido.
          ...(failureReason ? { failureReason: failureReason.slice(0, 300) } : {}),
        },
      });
    } catch (error) {
      console.error(
        'Auditoria do pedido de redefinição de senha não foi gravada:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return { emailSent, token };
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
