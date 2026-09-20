import { prisma } from '../../db/prisma.js';
import { loadEnv } from '../../config/env.js';
import { decryptField } from '../../security/crypto.js';
import { isPlatformEmailConfigured, redactEmailsInText, sendEmail } from './email.service.js';
import { EmailSendError } from './emailSendError.js';
import {
  EMAIL_OUTBOX_BATCH_SIZE,
  EMAIL_OUTBOX_LOCK_EXPIRA_MS,
  EMAIL_OUTBOX_MAX_ATTEMPTS,
  EMAIL_OUTBOX_DRAIN_INTERVAL_MS,
  emailOutboxRetryDelayMinutes,
} from './emailOutboxConfig.js';

/**
 * Zera o corpo de linhas velhas demais para o segredo ainda valer, mesmo que nunca tenham sido
 * drenadas — uma instância cujo drenador nunca chegou a rodar (ou uma linha presa numa fila que
 * já não avança) não pode ser um jeito de guardar segredo em texto claro por tempo indefinido.
 * `EMAIL_VERIFICATION_TTL_HOURS` é o maior prazo entre os quatro segredos que passam por aqui
 * (código de verificação, link de redefinição, código/link de troca de e-mail, link de convite) —
 * passado esse prazo o conteúdo do e-mail já não abre nada, então mantê-lo em texto claro é
 * exposição pura, sem contrapartida.
 *
 * Não apaga a linha: `status`, `attempts` e `failureReason` continuam sendo a trilha de
 * auditoria de que aquele envio existiu e o que aconteceu com ele.
 */
async function clearExpiredOutboxSecrets(): Promise<void> {
  const env = loadEnv();
  const limiteRetencao = new Date(Date.now() - env.EMAIL_VERIFICATION_TTL_HOURS * 60 * 60 * 1000);
  await prisma.authEmailOutbox.updateMany({
    where: { createdAt: { lt: limiteRetencao }, html: { not: '' } },
    data: { html: '', text: '' },
  });
}

/**
 * Uma passada pelo outbox. Devolve o que aconteceu, para quem chama poder registrar.
 *
 * Cada linha é travada por um `updateMany` condicional antes do envio: duas instâncias do
 * auth-api drenando ao mesmo tempo não mandam a mesma linha duas vezes. Na reivindicação de uma
 * linha presa em `sending`, a condição inclui `lockedAt <= limiteTrava` — não só `status:
 * 'sending'` — porque o `WHERE` por status sozinho não muda de valor entre duas chamadas
 * concorrentes: a segunda ainda casaria depois que a primeira já reivindicou. Incluir a trava
 * atual na condição é o que faz a segunda reivindicação falhar assim que a primeira committa.
 */
export async function drainEmailOutbox(): Promise<{
  sent: number;
  failed: number;
  retried: number;
}> {
  await clearExpiredOutboxSecrets();

  if (!isPlatformEmailConfigured()) return { sent: 0, failed: 0, retried: 0 };

  const agora = new Date();
  const limiteTrava = new Date(agora.getTime() - EMAIL_OUTBOX_LOCK_EXPIRA_MS);

  const pendentes = await prisma.authEmailOutbox.findMany({
    where: {
      OR: [
        { status: 'queued', OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: agora } }] },
        // Preso em `sending` além da trava: o dono anterior não existe mais.
        { status: 'sending', lockedAt: { lte: limiteTrava } },
      ],
    },
    take: EMAIL_OUTBOX_BATCH_SIZE,
    orderBy: { createdAt: 'asc' },
  });

  let sent = 0;
  let failed = 0;
  let retried = 0;

  for (const linha of pendentes) {
    const claim = await prisma.authEmailOutbox.updateMany({
      where:
        linha.status === 'queued'
          ? { id: linha.id, status: 'queued' }
          : { id: linha.id, status: 'sending', lockedAt: { lte: limiteTrava } },
      data: { status: 'sending', lockedAt: agora },
    });
    // Outra instância pegou primeiro: seguir em frente é o certo, não competir.
    if (claim.count === 0) continue;

    try {
      const to = decryptField(linha.toEncrypted);
      const resultado = await sendEmail({
        to,
        subject: linha.subject,
        html: linha.html,
        text: linha.text,
        from: linha.fromEmail
          ? { name: linha.fromName ?? undefined, email: linha.fromEmail }
          : undefined,
        replyTo: linha.replyToEmail
          ? { name: linha.replyToName ?? undefined, email: linha.replyToEmail }
          : undefined,
      });

      await prisma.authEmailOutbox.update({
        where: { id: linha.id },
        data: {
          status: 'sent',
          sentAt: new Date(),
          lockedAt: null,
          failureReason: null,
          providerMessageId: resultado.providerMessageId ?? null,
          // O segredo já foi entregue; o corpo não tem mais função aqui.
          html: '',
          text: '',
        },
      });
      sent += 1;
    } catch (error) {
      // Forma desconhecida (não `EmailSendError`) é tratada como transitória: o console nunca
      // lança, então isto só dispara para Resend/SMTP, e os dois agora sempre lançam
      // `EmailSendError` — mas o lado seguro em caso de mudança futura é tentar de novo, não
      // desistir calado.
      const retryable = error instanceof EmailSendError ? error.retryable : true;
      const tentativas = linha.attempts + 1;
      const desiste = !retryable || tentativas >= EMAIL_OUTBOX_MAX_ATTEMPTS;

      await prisma.authEmailOutbox.update({
        where: { id: linha.id },
        data: {
          status: desiste ? 'failed' : 'queued',
          attempts: tentativas,
          lockedAt: null,
          failureReason: redactEmailsInText(
            error instanceof Error ? error.message : String(error),
          ),
          nextAttemptAt: desiste
            ? null
            : new Date(Date.now() + emailOutboxRetryDelayMinutes(tentativas) * 60_000),
          // Uma linha morta não é lugar de guardar credencial viva — o mesmo raciocínio do
          // sucesso, só que aqui o segredo nunca chegou a lugar nenhum.
          ...(desiste ? { html: '', text: '' } : {}),
        },
      });

      if (desiste) failed += 1;
      else retried += 1;
    }
  }

  if (sent || failed || retried) {
    console.info('[email-outbox] drenagem concluída', { sent, failed, retried });
  }

  return { sent, failed, retried };
}

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Liga o drenador — e não faz nada quando o canal está desligado.
 *
 * Intervalo, e não gatilho no momento em que a mensagem é enfileirada: enfileirar não pode
 * esperar um envio de rede, e uma passada a cada 5 segundos é rápida o bastante para não atrasar
 * perceptivelmente um código de login ou uma confirmação de cadastro.
 */
export function startEmailOutboxDrain(intervalMs = EMAIL_OUTBOX_DRAIN_INTERVAL_MS): void {
  if (timer || !isPlatformEmailConfigured()) return;

  console.info('[email-outbox] drenador iniciado', { intervalMs });
  timer = setInterval(() => {
    void drainEmailOutbox().catch((error) => {
      // Falha aqui não derruba o processo: a linha continua no outbox, e a próxima passada tenta.
      console.error('[email-outbox] falha ao drenar', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, intervalMs);

  // Não segura o processo de pé: quem manda no ciclo de vida é o servidor, não o drenador.
  timer.unref?.();
}

export function stopEmailOutboxDrain(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
