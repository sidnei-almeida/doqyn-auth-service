import { loadEnv } from '../../config/env.js';
import type { EmailMessage, EmailSender, SmtpTransportConfig } from './email.types.js';
import type { ResendConfig } from './resendEmailSender.js';
import { sendViaSmtp } from './smtpEmailSender.js';
import { sendViaResend } from './resendEmailSender.js';

/** Adapter de desenvolvimento — não loga conteúdo sensível (tokens/links completos). */
export class ConsoleEmailSender implements EmailSender {
  async send(message: EmailMessage): Promise<void> {
    const env = loadEnv();
    if (env.NODE_ENV === 'test') return;
    console.info('[email] queued', {
      to: redactEmail(message.to),
      from: message.from ? redactEmail(message.from.email) : undefined,
      subject: message.subject,
      textLength: message.text.length,
    });
  }
}

function redactEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const visible = local.slice(0, 2);
  return `${visible}***@${domain}`;
}

/** Mascara todo endereço dentro de um texto livre, como a mensagem de erro de um provedor. */
export function redactEmailsInText(text: string): string {
  return text.replace(/[^\s@"'<>(),;:]+@[^\s@"'<>(),;:]+/g, redactEmail);
}

let cachedSender: EmailSender | null = null;

export function getEmailSender(): EmailSender {
  if (!cachedSender) {
    cachedSender = new ConsoleEmailSender();
  }
  return cachedSender;
}

export function resetEmailSenderForTests(sender?: EmailSender): void {
  cachedSender = sender ?? new ConsoleEmailSender();
}

/**
 * A Resend da plataforma, quando escolhida e com chave. `null` diz "não configurada", que é
 * diferente de "não escolhida" — as duas caem no mesmo lugar, mas só uma é engano.
 */
export function getResendConfig(): ResendConfig | null {
  const env = loadEnv();
  if (env.EMAIL_PROVIDER !== 'resend') return null;
  if (!env.RESEND_API_KEY?.trim()) return null;
  return {
    apiKey: env.RESEND_API_KEY.trim(),
    defaultFrom: getPlatformSender(),
  };
}

/**
 * Todo e-mail sai pela DOQYN. Resend se escolhida, SMTP da plataforma se não.
 *
 * Houve um ramo aqui para o SMTP próprio de cada tenant, e ele vencia sobre a plataforma. O
 * recurso foi eliminado do produto: nenhum chamador passava transporte e a tabela que o
 * guardava não tinha leitor. Restou como parâmetro opcional, que é a forma mais discreta de
 * código morto — some sem erro e ninguém percebe que a alternativa não existe.
 */
export async function sendEmail(message: EmailMessage): Promise<{ providerMessageId?: string }> {
  const env = loadEnv();
  if (!env.EMAIL_ENABLED) {
    await getEmailSender().send(message);
    return {};
  }

  const resend = getResendConfig();
  if (resend) {
    return await sendViaResend(resend, message);
  }

  const fallback = getFallbackSmtpTransport();
  if (fallback) {
    return await sendViaSmtp(fallback, message);
  }

  await getEmailSender().send(message);
  return {};
}

/**
 * O envio real só acontece com `EMAIL_ENABLED` e algum provedor de plataforma de pé.
 *
 * Precisa contar a Resend junto com o SMTP: enquanto olhava só para o SMTP, uma instalação
 * inteiramente na Resend se declarava não configurada, e o convite voltava com
 * `smtp_not_configured` depois de ter sido entregue.
 */
export function isPlatformEmailConfigured(): boolean {
  const env = loadEnv();
  if (!env.EMAIL_ENABLED) return false;
  return getResendConfig() !== null || getFallbackSmtpTransport() !== null;
}

export function getPlatformSender(): { name: string; email: string } {
  return { name: 'DOQYN', email: loadEnv().EMAIL_FROM };
}

export function getFallbackSmtpTransport(): SmtpTransportConfig | null {
  const env = loadEnv();
  if (!env.SMTP_HOST?.trim() || !env.SMTP_USER?.trim() || !env.SMTP_PASSWORD?.trim()) {
    return null;
  }

  return {
    host: env.SMTP_HOST.trim(),
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    user: env.SMTP_USER.trim(),
    password: env.SMTP_PASSWORD,
  };
}
