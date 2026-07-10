import { loadEnv } from '../../config/env.js';
import type { EmailMessage, EmailSender, SmtpTransportConfig } from './email.types.js';
import { sendViaSmtp } from './smtpEmailSender.js';

/** Adapter de desenvolvimento — não loga conteúdo sensível (tokens/links completos). */
export class ConsoleEmailSender implements EmailSender {
  async send(message: EmailMessage, transport?: SmtpTransportConfig): Promise<void> {
    const env = loadEnv();
    if (env.NODE_ENV === 'test') return;
    console.info('[email] queued', {
      to: redactEmail(message.to),
      from: message.from ? redactEmail(message.from.email) : transport?.user ? redactEmail(transport.user) : undefined,
      subject: message.subject,
      textLength: message.text.length,
      transportHost: transport?.host,
    });
  }
}

function redactEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const visible = local.slice(0, 2);
  return `${visible}***@${domain}`;
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

export async function sendEmail(
  message: EmailMessage,
  transport?: SmtpTransportConfig,
): Promise<void> {
  const env = loadEnv();
  if (!env.EMAIL_ENABLED) {
    await getEmailSender().send(message, transport);
    return;
  }

  if (transport) {
    await sendViaSmtp(transport, message);
    return;
  }

  const fallback = getFallbackSmtpTransport();
  if (fallback) {
    await sendViaSmtp(fallback, message);
    return;
  }

  await getEmailSender().send(message);
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
