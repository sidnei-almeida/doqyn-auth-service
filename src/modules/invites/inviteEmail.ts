import { getPublicAppBaseUrl, loadEnv } from '../../config/env.js';
import { sendEmail } from '../email/email.service.js';
import { renderInviteEmail } from '../email/renderInviteEmail.js';
import type { SmtpTransportConfig } from '../email/email.types.js';
import {
  assertInviterEmailMatchesTenantDomain,
  markTenantOutboundEmailVerified,
} from '../tenant-email/tenantOutboundEmail.service.js';

export type SendInviteEmailInput = {
  to: string;
  tenantDisplayName: string;
  invitePath: string;
  inviterName: string;
  inviterEmail: string;
  tenantUuid: string;
  smtpTransport: SmtpTransportConfig | null;
  fromDomain: string | null;
  expiresInDays: number;
};

export type SendInviteEmailResult = {
  sent: boolean;
  reason?: 'smtp_not_configured' | 'email_disabled' | 'domain_mismatch' | 'send_failed';
};

export async function sendInviteEmail(input: SendInviteEmailInput): Promise<SendInviteEmailResult> {
  const env = loadEnv();
  const baseUrl = getPublicAppBaseUrl(env);
  const inviteUrl = `${baseUrl}${input.invitePath.startsWith('/') ? input.invitePath : `/${input.invitePath}`}`;
  const { subject, text, html } = renderInviteEmail({
    inviterName: input.inviterName,
    inviterEmail: input.inviterEmail,
    tenantDisplayName: input.tenantDisplayName,
    inviteUrl,
    expiresInDays: input.expiresInDays,
  });

  if (!env.EMAIL_ENABLED) {
    await sendEmail({
      to: input.to,
      subject,
      text,
      html,
      from: { name: input.inviterName, email: input.inviterEmail },
      replyTo: { name: input.inviterName, email: input.inviterEmail },
    });
    return { sent: false, reason: 'email_disabled' };
  }

  if (!input.smtpTransport || !input.fromDomain) {
    await sendEmail({
      to: input.to,
      subject,
      text,
      html,
      from: { name: input.inviterName, email: input.inviterEmail },
      replyTo: { name: input.inviterName, email: input.inviterEmail },
    });
    return { sent: false, reason: 'smtp_not_configured' };
  }

  try {
    assertInviterEmailMatchesTenantDomain(input.inviterEmail, input.fromDomain);
  } catch {
    return { sent: false, reason: 'domain_mismatch' };
  }

  try {
    await sendEmail(
      {
        to: input.to,
        subject,
        text,
        html,
        from: { name: input.inviterName, email: input.inviterEmail },
        replyTo: { name: input.inviterName, email: input.inviterEmail },
      },
      input.smtpTransport,
    );
    await markTenantOutboundEmailVerified(input.tenantUuid);
    return { sent: true };
  } catch {
    return { sent: false, reason: 'send_failed' };
  }
}

export async function sendTenantEmailTest(input: {
  to: string;
  inviterName: string;
  inviterEmail: string;
  tenantDisplayName: string;
  smtpTransport: SmtpTransportConfig;
  fromDomain: string;
  tenantUuid: string;
}): Promise<void> {
  assertInviterEmailMatchesTenantDomain(input.inviterEmail, input.fromDomain);

  const { subject, text, html } = renderInviteEmail({
    inviterName: input.inviterName,
    inviterEmail: input.inviterEmail,
    tenantDisplayName: input.tenantDisplayName,
    inviteUrl: getPublicAppBaseUrl(loadEnv()),
    expiresInDays: 7,
  });

  await sendEmail(
    {
      to: input.to,
      subject: `[Teste] ${subject}`,
      text: `Este é um e-mail de teste da configuração SMTP da empresa.\n\n${text}`,
      html: `<p><strong>Este é um e-mail de teste da configuração SMTP da empresa.</strong></p>${html}`,
      from: { name: input.inviterName, email: input.inviterEmail },
      replyTo: { name: input.inviterName, email: input.inviterEmail },
    },
    input.smtpTransport,
  );

  await markTenantOutboundEmailVerified(input.tenantUuid);
}
