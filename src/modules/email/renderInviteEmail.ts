export type InviteEmailTemplateInput = {
  inviterName: string;
  inviterEmail: string;
  tenantDisplayName: string;
  inviteUrl: string;
  expiresInDays: number;
};

export function renderInviteEmail(input: InviteEmailTemplateInput): {
  subject: string;
  text: string;
  html: string;
} {
  const company = input.tenantDisplayName || 'sua empresa';
  const subject = `${input.inviterName} convidou você para ${company} no DOQYN`;

  const text = [
    `${input.inviterName} (${input.inviterEmail}) convidou você para participar de ${company} no DOQYN.`,
    '',
    'Para aceitar o convite e criar seu acesso, use o link abaixo:',
    input.inviteUrl,
    '',
    `Este convite expira em ${input.expiresInDays} dia(s).`,
    '',
    'Se você não esperava este convite, ignore este e-mail.',
  ].join('\n');

  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
  <body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#1f2933;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6f8;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
            <tr>
              <td style="padding:28px 32px 12px;">
                <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;">Convite DOQYN</p>
                <h1 style="margin:0;font-size:22px;line-height:1.35;color:#111827;">Você foi convidado para ${escapeHtml(company)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 0;">
                <p style="margin:0;font-size:15px;line-height:1.6;color:#374151;">
                  <strong>${escapeHtml(input.inviterName)}</strong>
                  (<a href="mailto:${escapeHtml(input.inviterEmail)}" style="color:#2563eb;text-decoration:none;">${escapeHtml(input.inviterEmail)}</a>)
                  convidou você para acessar documentos e fluxos da empresa no DOQYN.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 8px;" align="center">
                <a href="${escapeHtml(input.inviteUrl)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:14px 24px;border-radius:8px;">
                  Aceitar convite
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 24px;">
                <p style="margin:0;font-size:13px;line-height:1.6;color:#6b7280;">
                  Ou copie e cole este link no navegador:<br />
                  <a href="${escapeHtml(input.inviteUrl)}" style="color:#2563eb;word-break:break-all;">${escapeHtml(input.inviteUrl)}</a>
                </p>
                <p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#9ca3af;">
                  Este convite expira em ${input.expiresInDays} dia(s). Se você não esperava este e-mail, ignore-o com segurança.
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
