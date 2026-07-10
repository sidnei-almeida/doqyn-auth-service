export type EmailChangeTemplateInput = {
  currentEmail: string;
  newEmail: string;
  confirmUrl: string;
  expiresInHours: number;
};

export function renderEmailChangeEmail(input: EmailChangeTemplateInput): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = 'Confirme seu novo e-mail no DOQYN';
  const text = [
    'Recebemos uma solicitação para alterar o e-mail da sua conta no DOQYN.',
    '',
    `E-mail atual: ${input.currentEmail}`,
    `Novo e-mail: ${input.newEmail}`,
    '',
    'Para confirmar, acesse o link abaixo:',
    input.confirmUrl,
    '',
    `Este link expira em ${input.expiresInHours} hora(s).`,
    'Se você não solicitou esta alteração, ignore este e-mail.',
  ].join('\n');

  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
  <body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#1f2933;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6f8;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;">
            <tr>
              <td style="padding:28px 32px 12px;">
                <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;">Confirmação de e-mail</p>
                <h1 style="margin:0;font-size:22px;line-height:1.35;color:#111827;">Confirme seu novo endereço</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 0;">
                <p style="margin:0;font-size:15px;line-height:1.6;color:#374151;">
                  Você solicitou alterar o e-mail da sua conta de
                  <strong>${escapeHtml(input.currentEmail)}</strong> para
                  <strong>${escapeHtml(input.newEmail)}</strong>.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 8px;" align="center">
                <a href="${escapeHtml(input.confirmUrl)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:14px 24px;border-radius:8px;">
                  Confirmar novo e-mail
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 24px;">
                <p style="margin:0;font-size:13px;line-height:1.6;color:#6b7280;">
                  Link alternativo:<br />
                  <a href="${escapeHtml(input.confirmUrl)}" style="color:#2563eb;word-break:break-all;">${escapeHtml(input.confirmUrl)}</a>
                </p>
                <p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#9ca3af;">
                  Expira em ${input.expiresInHours} hora(s). Se não foi você, ignore este e-mail.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
  `.trim();

  return { subject, text, html };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
