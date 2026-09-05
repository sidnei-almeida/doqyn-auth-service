import type { EmailAddress, EmailMessage } from './email.types.js';

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

export async function sendViaResend(config: ResendConfig, message: EmailMessage): Promise<void> {
  const payload = {
    from: formatAddress(message.from ?? config.defaultFrom),
    to: [message.to],
    subject: message.subject,
    html: message.html,
    text: message.text,
    ...(message.replyTo ? { reply_to: formatAddress(message.replyTo) } : {}),
  };

  // Sem retentativa aqui. Quem chama já decide o que fazer com a falha — `sendInviteEmail`
  // devolve `send_failed` e o convite continua válido, porque o link é a coisa que importa e
  // ele já existe. Repetir aqui só atrasaria a resposta da tela.
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
    throw new Error(
      `Resend inacessível: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!response.ok) {
    // O corpo do erro da Resend nomeia o campo recusado (domínio não verificado, remetente
    // inválido), e é a única pista útil quando o envio falha em produção. Nunca inclui o
    // conteúdo da mensagem, então não há segredo a vazar no registro.
    const detalhe = await response.text().catch(() => '');
    throw new Error(`Resend recusou o envio (${response.status}): ${detalhe.slice(0, 300)}`);
  }
}
