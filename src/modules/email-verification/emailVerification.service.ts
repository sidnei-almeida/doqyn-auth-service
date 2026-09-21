import { timingSafeEqual } from 'node:crypto';

import { prisma } from '../../db/prisma.js';
import { getPublicAppBaseUrl, isProduction, loadEnv } from '../../config/env.js';
import {
  decryptField,
  hashEmailVerificationCode,
  hashEmailVerificationToken,
} from '../../security/crypto.js';
import {
  generateEmailVerificationCode,
  generateEmailVerificationToken,
} from '../../security/sessionToken.js';
import {
  checkEmailVerificationConfirmRateLimit,
  checkEmailVerificationSendRateLimit,
} from '../../security/rateLimit.js';
import { readEmailVerificationTicket } from '../../security/verificationTicket.js';
import {
  GoneError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../../utils/errors.js';
import { logAuthAudit } from '../audit/authAudit.service.js';
import { getPlatformSender } from '../email/email.service.js';
import { enqueueEmail } from '../email/emailOutbox.service.js';
import { renderEmailVerificationEmail } from '../email/renderEmailVerificationEmail.js';
import { findUserById, toPublicUser } from '../users/users.service.js';

function verificationPath(token: string): string {
  return `/verify-email/${encodeURIComponent(token)}`;
}

async function invalidatePendingVerifications(userId: string): Promise<void> {
  await prisma.authEmailVerification.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: new Date() },
  });
}

function findPendingVerification(userId: string) {
  return prisma.authEmailVerification.findFirst({
    where: { userId, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Traduz o ticket em `userId`, ou recusa.
 *
 * Todas as rotas públicas de verificação passam por aqui: sem sessão, o ticket é a única coisa
 * que liga a chamada a uma conta, e ele só é emitido depois da senha certa ou do cadastro.
 */
export function resolveVerificationTicket(ticket: string): string {
  const userId = readEmailVerificationTicket(ticket);
  if (!userId) {
    throw new UnauthorizedError(
      'Sessão de confirmação expirada. Faça login novamente para receber um novo código.',
      'EMAIL_VERIFICATION_TICKET_INVALID',
    );
  }
  return userId;
}

export async function getEmailVerificationStatus(userId: string) {
  const user = await findUserById(userId);
  if (!user) {
    throw new NotFoundError('Usuário não encontrado.');
  }

  if (user.emailVerified) {
    return { verified: true as const, pending: false as const };
  }

  const pending = await findPendingVerification(userId);
  const env = loadEnv();

  return {
    verified: false as const,
    pending: pending !== null,
    email: decryptField(user.emailEncrypted),
    expiresAt: pending?.expiresAt.toISOString(),
    linkExpiresAt: pending?.tokenExpiresAt.toISOString(),
    attemptsLeft: pending ? Math.max(0, env.EMAIL_VERIFICATION_MAX_ATTEMPTS - pending.attempts) : 0,
    canResendAt: pending?.sentAt
      ? new Date(
          pending.sentAt.getTime() + env.EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS * 1000,
        ).toISOString()
      : undefined,
  };
}

/**
 * Emite um código novo e manda o e-mail. É a mesma operação para "enviar" e "reenviar" — a única
 * diferença entre as duas rotas é o nome, porque do lado do servidor a segunda é literalmente a
 * primeira de novo.
 *
 * Cada envio invalida o código anterior. Dois códigos válidos ao mesmo tempo dobrariam a superfície
 * de adivinhação e ainda deixariam a pessoa confusa sobre qual dos e-mails vale.
 */
export async function sendEmailVerificationCode(
  userId: string,
  ipHash?: string,
  options?: {
    /**
     * Não emite código novo se já houver um vivo.
     *
     * O login usa isto. Sem a trava, cada tentativa de entrar rotacionava o código: quem se
     * cadastrava, esperava o e-mail chegar, tentava entrar e então digitava o que recebeu levava
     * "código incorreto" — porque aquele acabara de morrer — e ainda perdia uma das cinco
     * tentativas. O intervalo de 60 segundos escondia o defeito, e só até ele passar.
     */
    onlyIfMissing?: boolean;
  },
) {
  if (ipHash) {
    await checkEmailVerificationSendRateLimit(ipHash, userId);
  }

  const user = await findUserById(userId);
  if (!user) {
    throw new NotFoundError('Usuário não encontrado.');
  }

  if (user.emailVerified) {
    throw new ValidationError('Este e-mail já está confirmado.', 'EMAIL_ALREADY_VERIFIED');
  }

  const env = loadEnv();

  const pending = await findPendingVerification(userId);

  if (options?.onlyIfMissing && pending) {
    const email = decryptField(user.emailEncrypted);
    return {
      ok: true as const,
      message: `Já enviamos um código para ${email}. Confira sua caixa de entrada.`,
      email,
      expiresAt: pending.expiresAt.toISOString(),
      emailSent: false,
    };
  }

  // O teto por linha existe além do teto por IP: quem troca de IP ainda não consegue despejar
  // e-mail na caixa de entrada de terceiro mais rápido que o intervalo mínimo.
  if (pending?.sentAt) {
    const nextAllowedAt =
      pending.sentAt.getTime() + env.EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS * 1000;
    if (Date.now() < nextAllowedAt) {
      throw new ValidationError(
        `Aguarde ${Math.ceil((nextAllowedAt - Date.now()) / 1000)} segundos para pedir outro código.`,
        'EMAIL_VERIFICATION_RESEND_TOO_SOON',
      );
    }
  }

  await invalidatePendingVerifications(userId);

  const code = generateEmailVerificationCode();
  const token = generateEmailVerificationToken();
  const expiresAt = new Date(Date.now() + env.EMAIL_VERIFICATION_CODE_TTL_MINUTES * 60 * 1000);
  const tokenExpiresAt = new Date(Date.now() + env.EMAIL_VERIFICATION_TTL_HOURS * 60 * 60 * 1000);

  const created = await prisma.authEmailVerification.create({
    data: {
      userId,
      codeHash: hashEmailVerificationCode(userId, code),
      tokenHash: hashEmailVerificationToken(token),
      expiresAt,
      tokenExpiresAt,
    },
  });

  const email = decryptField(user.emailEncrypted);
  const confirmUrl = `${getPublicAppBaseUrl(env)}${verificationPath(token)}`;
  const { subject, text, html } = renderEmailVerificationEmail({
    code,
    confirmUrl,
    expiresInMinutes: env.EMAIL_VERIFICATION_CODE_TTL_MINUTES,
    linkExpiresInHours: env.EMAIL_VERIFICATION_TTL_HOURS,
    locale: user.locale,
  });

  const sender = getPlatformSender();
  const message = {
    to: email,
    subject,
    text,
    html,
    from: { name: sender.name, email: sender.email },
  };

  // Enfileira no outbox — o envio de fato é trabalho do drenador, e a resposta não espera a
  // rede da Resend/SMTP. Sem plataforma configurada, `enqueueEmail` cai no mesmo adapter de
  // console que este ponto sempre usou.
  //
  // O código de verificação já foi criado no banco antes daqui — uma falha ao enfileirar não
  // pode virar 500 e derrubar um cadastro que já existe. Antes de existir outbox, essa mesma
  // degradação suave era o comportamento (só que causada pela Resend, não pelo Postgres).
  let emailSent: boolean;
  try {
    ({ queued: emailSent } = await enqueueEmail({ userId, purpose: 'email_verification', message }));
  } catch (error) {
    console.error(
      'Falha ao enfileirar código de verificação:',
      error instanceof Error ? error.message : String(error),
    );
    emailSent = false;
  }

  await prisma.authEmailVerification.update({
    where: { id: created.id },
    data: { sentAt: new Date() },
  });

  await logAuthAudit('email_verification.sent', {
    userId,
    metadata: { emailSent },
    ipHash,
  });

  return {
    ok: true as const,
    message: emailSent
      ? `Um código de 6 dígitos está a caminho de ${email}.`
      : 'Código criado, mas o e-mail não saiu. Em desenvolvimento, use o código abaixo.',
    email,
    expiresAt: expiresAt.toISOString(),
    emailSent,
    // Em desenvolvimento o código volta na resposta: sem SMTP configurado, não haveria outro jeito
    // de percorrer o fluxo inteiro. Em produção nunca sai daqui.
    ...(!isProduction(env) && env.AUTH_DEV_ECHO_TOKENS ? { code, confirmUrl } : {}),
  };
}

/** Compara hashes em tempo constante — o tempo de resposta não pode dizer quantos dígitos casaram. */
function hashesMatch(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

async function markVerified(userId: string, verificationId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.authEmailVerification.update({
      where: { id: verificationId },
      data: { usedAt: new Date() },
    });
    await tx.authEmailVerification.updateMany({
      where: { userId, usedAt: null, id: { not: verificationId } },
      data: { usedAt: new Date() },
    });
    return tx.authUser.update({
      where: { id: userId },
      data: { emailVerified: true },
    });
  });
}

export async function confirmEmailVerificationCode(userId: string, code: string, ipHash?: string) {
  if (ipHash) {
    await checkEmailVerificationConfirmRateLimit(ipHash);
  }

  const pending = await findPendingVerification(userId);
  if (!pending) {
    throw new NotFoundError(
      'Nenhum código pendente. Peça um novo.',
      'EMAIL_VERIFICATION_NOT_FOUND',
    );
  }

  const env = loadEnv();

  // A tentativa é reservada ANTES da comparação, num UPDATE condicional ao teto. Conferir o teto
  // numa leitura e incrementar depois deixava N palpites simultâneos passarem todos pela checagem,
  // cada um lendo o contador de antes. Persiste: reiniciar o processo não devolve palpites.
  const reserved = await prisma.authEmailVerification.updateMany({
    where: { id: pending.id, attempts: { lt: env.EMAIL_VERIFICATION_MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (reserved.count === 0) {
    throw new GoneError(
      'Código bloqueado por excesso de tentativas. Peça um novo.',
      'EMAIL_VERIFICATION_TOO_MANY_ATTEMPTS',
    );
  }

  if (!hashesMatch(pending.codeHash, hashEmailVerificationCode(userId, code))) {
    const updated = await prisma.authEmailVerification.findUniqueOrThrow({
      where: { id: pending.id },
      select: { attempts: true },
    });
    const attemptsLeft = Math.max(0, env.EMAIL_VERIFICATION_MAX_ATTEMPTS - updated.attempts);

    await logAuthAudit('email_verification.failed', {
      userId,
      metadata: { attemptsLeft },
      ipHash,
    });

    throw new ValidationError(
      attemptsLeft > 0
        ? `Código incorreto. ${attemptsLeft} tentativa(s) restante(s).`
        : 'Código incorreto. O código foi bloqueado — peça um novo.',
      'EMAIL_VERIFICATION_INVALID_CODE',
    );
  }

  const user = await markVerified(userId, pending.id);

  await logAuthAudit('email_verification.confirmed', { userId, metadata: { via: 'code' }, ipHash });

  return {
    ok: true as const,
    message: 'E-mail confirmado.',
    user: toPublicUser(user),
  };
}

/**
 * O caminho do link, e ele não exige sessão de propósito: quem abre o e-mail no celular não está
 * logado ali. O token de 32 bytes é o que autentica a ação — é longo o bastante para não precisar
 * de teto de tentativas como os 6 dígitos precisam.
 */
export async function confirmEmailVerificationToken(token: string, ipHash?: string) {
  if (ipHash) {
    await checkEmailVerificationConfirmRateLimit(ipHash);
  }

  const verification = await prisma.authEmailVerification.findUnique({
    where: { tokenHash: hashEmailVerificationToken(token) },
    include: { user: true },
  });

  if (!verification) {
    throw new NotFoundError('Link inválido ou expirado.', 'EMAIL_VERIFICATION_NOT_FOUND');
  }
  if (verification.usedAt) {
    throw new GoneError('Este link já foi utilizado.', 'EMAIL_VERIFICATION_ALREADY_USED');
  }
  // O link tem prazo próprio, mais longo que o do código: quem o abre horas depois no celular
  // ainda deve conseguir confirmar, mesmo que os 6 dígitos já não sirvam.
  if (verification.tokenExpiresAt <= new Date()) {
    throw new GoneError('Este link expirou. Peça um novo código.', 'EMAIL_VERIFICATION_EXPIRED');
  }

  const user = await markVerified(verification.userId, verification.id);

  await logAuthAudit('email_verification.confirmed', {
    userId: verification.userId,
    metadata: { via: 'link' },
    ipHash,
  });

  return {
    ok: true as const,
    message: 'E-mail confirmado.',
    user: toPublicUser(user),
  };
}
