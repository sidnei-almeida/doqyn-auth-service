import { getPublicAppBaseUrl, loadEnv } from '../../config/env.js';
import { getPlatformSender, sendEmail } from '../email/email.service.js';
import { enqueueEmail } from '../email/emailOutbox.service.js';
import { renderInviteEmail } from '../email/renderInviteEmail.js';

export type SendInviteEmailInput = {
  to: string;
  tenantDisplayName: string;
  invitePath: string;
  inviterName: string;
  inviterEmail: string;
  expiresInDays: number;
  /** Idioma gravado no convite. */
  locale?: string | null;
};

export type SendInviteEmailResult = {
  sent: boolean;
  reason?: 'email_disabled' | 'smtp_not_configured';
};

/**
 * O convite sai pelo SMTP da plataforma. O remetente é o nosso endereço — provedor
 * nenhum aceita enviar como o e-mail do administrador —, e a resposta volta para ele.
 */
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
    locale: input.locale,
  });

  const sender = getPlatformSender();
  const message = {
    to: input.to,
    subject,
    text,
    html,
    from: { name: `${input.inviterName} via ${sender.name}`, email: sender.email },
    replyTo: { name: input.inviterName, email: input.inviterEmail },
  };

  if (!env.EMAIL_ENABLED) {
    await sendEmail(message);
    return { sent: false, reason: 'email_disabled' };
  }

  // `send_failed` deixou de existir como resposta: com o outbox, a recusa do provedor acontece
  // depois que esta função já respondeu, e inventar um desfecho aqui seria mentir. O que sobra
  // para dizer é se a mensagem ficou durável — e, quando não há provedor, que ela não ficou.
  const { queued } = await enqueueEmail({ userId: null, purpose: 'invite', message });
  if (!queued) {
    return { sent: false, reason: 'smtp_not_configured' };
  }

  return { sent: true };
}
