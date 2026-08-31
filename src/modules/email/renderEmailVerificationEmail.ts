export type EmailVerificationTemplateInput = {
  code: string;
  confirmUrl: string;
  expiresInMinutes: number;
};

/**
 * Manda o código e o link no mesmo e-mail.
 *
 * Os dois cobrem casos diferentes: o link resolve quem lê a mensagem no mesmo aparelho em que abriu
 * a conta, e o código resolve o caso comum — e-mail no celular, cadastro no computador. Mandar só
 * um dos dois obriga metade das pessoas a trocar de aparelho no meio do cadastro.
 */
export function renderEmailVerificationEmail(input: EmailVerificationTemplateInput): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = `${formatCode(input.code)} é seu código de confirmação DOQYN`;
  const text = [
    'Confirme seu e-mail para ativar sua conta no DOQYN.',
    '',
    `Seu código: ${formatCode(input.code)}`,
    '',
    'Ou confirme direto por este link:',
    input.confirmUrl,
    '',
    `O código e o link expiram em ${input.expiresInMinutes} minutos.`,
    'Se você não criou esta conta, ignore este e-mail.',
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
                <h1 style="margin:0;font-size:22px;line-height:1.35;color:#111827;">Confirme seu e-mail</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 0;">
                <p style="margin:0;font-size:15px;line-height:1.6;color:#374151;">
                  Digite o código abaixo na tela de confirmação para ativar sua conta.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 4px;" align="center">
                <p style="margin:0;font-size:32px;line-height:1.2;font-weight:700;letter-spacing:0.18em;color:#111827;font-family:'Courier New',Courier,monospace;">
                  ${escapeHtml(formatCode(input.code))}
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 8px;" align="center">
                <a href="${escapeHtml(input.confirmUrl)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:14px 24px;border-radius:8px;">
                  Confirmar sem digitar
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
                  Expira em ${input.expiresInMinutes} minutos. Se você não criou esta conta, ignore este e-mail.
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

/** `123 456` — o espaço no meio é o que torna seis dígitos legíveis de relance. */
function formatCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
