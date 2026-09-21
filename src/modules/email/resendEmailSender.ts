import type { EmailAddress, EmailMessage } from './email.types.js';
import { EmailSendError } from './emailSendError.js';

/**
 * Envio pela API da Resend.
 *
 * Sobre `fetch` e não sobre o SDK oficial de propósito: a API é um POST com um Bearer e um JSON,
 * e o SDK traria uma árvore de dependências inteira para dentro de um repositório público em
 * troca de nada que estas quarenta linhas não façam. Menos superfície para auditar, e o
 * contrato fica visível aqui em vez de escondido atrás de uma versão.
 *
 * Implementa a mesma `EmailSender` do SMTP, então trocar de provedor não encosta em template
 * nenhum — o que o convite, a verificação e a troca de e-mail renderizam continua igual.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** A Resend aceita o formato de cabeçalho de e-mail: `"Nome" <endereco@dominio>`. */
function formatAddress(address: EmailAddress): string {
  const email = address.email.trim();
  const name = address.name?.trim();
  if (!name) return email;
  return `"${name.replace(/"/g, '\\"')}" <${email}>`;
}

export type ResendConfig = {
  apiKey: string;
  /** Usado quando a mensagem não traz remetente próprio. */
  defaultFrom: EmailAddress;
};

export async function sendViaResend(
  config: ResendConfig,
  message: EmailMessage,
): Promise<{ providerMessageId?: string }> {
  const payload = {
    from: formatAddress(message.from ?? config.defaultFrom),
    to: [message.to],
    subject: message.subject,
    html: message.html,
    text: message.text,
    ...(message.replyTo ? { reply_to: formatAddress(message.replyTo) } : {}),
  };

  // A classificação de "vale repetir" mora aqui, porque é aqui que se sabe o status HTTP e a
  // forma da recusa. A decisão de repetir não — isso é do outbox, que tem a fila e o `attempts`
  // para decidir quando desistir de vez.
  let response: Response;
  try {
    response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    // Rede, DNS, timeout: nunca é culpa do conteúdo da mensagem, sempre vale tentar de novo.
    throw new EmailSendError(
      `Resend inacessível: ${error instanceof Error ? error.message : String(error)}`,
      true,
    );
  }

  if (!response.ok) {
    // O corpo do erro da Resend nomeia o campo recusado (domínio não verificado, remetente
    // inválido), e é a única pista útil quando o envio falha em produção. Nunca inclui o
    // conteúdo da mensagem, então não há segredo a vazar no registro.
    const detalhe = await response.text().catch(() => '');
    // 429/5xx é o provedor pedindo para tentar mais tarde; qualquer outro (domínio não
    // verificado, remetente inválido, payload rejeitado) não melhora repetindo.
    const retryable = response.status === 429 || response.status >= 500;
    throw new EmailSendError(
      `Resend recusou o envio (${response.status}): ${detalhe.slice(0, 300)}`,
      retryable,
    );
  }

  const body = (await response.json().catch(() => ({}))) as { id?: string };
  return { providerMessageId: body.id };
}
