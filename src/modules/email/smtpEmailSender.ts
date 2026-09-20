import nodemailer from 'nodemailer';
import type { EmailAddress, EmailMessage, SmtpTransportConfig } from './email.types.js';
import { EmailSendError } from './emailSendError.js';

function formatAddress(address: EmailAddress): string {
  const email = address.email.trim();
  const name = address.name?.trim();
  if (!name) return email;
  return `"${name.replace(/"/g, '\\"')}" <${email}>`;
}

export async function sendViaSmtp(
  transport: SmtpTransportConfig,
  message: EmailMessage,
): Promise<{ providerMessageId?: string }> {
  const transporter = nodemailer.createTransport({
    host: transport.host,
    port: transport.port,
    secure: transport.secure,
    auth: {
      user: transport.user,
      pass: transport.password,
    },
  });

  try {
    const info = await transporter.sendMail({
      from: message.from ? formatAddress(message.from) : transport.user,
      to: message.to,
      replyTo: message.replyTo ? formatAddress(message.replyTo) : undefined,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    return { providerMessageId: info.messageId };
  } catch (error) {
    // SMTP inverte a convenção do HTTP: 4xx é transitório (fila cheia, greylisting) e vale
    // repetir, 5xx é definitivo (endereço recusado, política de conteúdo). Sem código nenhum —
    // falha de conexão, por exemplo — o lado mais seguro é tentar de novo.
    const code = String((error as { responseCode?: number }).responseCode ?? '');
    const retryable = code.startsWith('4') ? true : code.startsWith('5') ? false : true;
    throw new EmailSendError(
      error instanceof Error ? error.message : String(error),
      retryable,
    );
  }
}
