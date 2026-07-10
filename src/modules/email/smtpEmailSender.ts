import nodemailer from 'nodemailer';
import type { EmailAddress, EmailMessage, SmtpTransportConfig } from './email.types.js';

function formatAddress(address: EmailAddress): string {
  const email = address.email.trim();
  const name = address.name?.trim();
  if (!name) return email;
  return `"${name.replace(/"/g, '\\"')}" <${email}>`;
}

export async function sendViaSmtp(
  transport: SmtpTransportConfig,
  message: EmailMessage,
): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: transport.host,
    port: transport.port,
    secure: transport.secure,
    auth: {
      user: transport.user,
      pass: transport.password,
    },
  });

  await transporter.sendMail({
    from: message.from ? formatAddress(message.from) : transport.user,
    to: message.to,
    replyTo: message.replyTo ? formatAddress(message.replyTo) : undefined,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
}
