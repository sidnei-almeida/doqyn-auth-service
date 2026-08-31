import {
  emailButton,
  emailCode,
  emailFine,
  emailRow,
  emailRows,
  emailText,
  escapeHtml,
  plural,
  renderEmailLayout,
} from './emailLayout.js';

export type EmailChangeTemplateInput = {
  currentEmail: string;
  newEmail: string;
  code: string;
  confirmUrl: string;
  expiresInMinutes: number;
  expiresInHours: number;
};

/**
 * Troca de endereço — código e link, como a confirmação de cadastro.
 *
 * A diferença de conteúdo é o par de endereços em destaque. Trocar o e-mail de acesso é
 * destrutivo: quem recebe isto sem ter pedido precisa ver, de relance, de onde para onde a conta
 * está indo. Por isso os dois aparecem como linha de registro antes de qualquer ação.
 */
export function renderEmailChangeEmail(input: EmailChangeTemplateInput): {
  subject: string;
  text: string;
  html: string;
} {
  const formattedCode = `${input.code.slice(0, 3)} ${input.code.slice(3)}`;
  const subject = `${formattedCode} é seu código para trocar o e-mail no DOQYN`;

  const text = [
    'Recebemos uma solicitação para alterar o e-mail da sua conta no DOQYN.',
    '',
    `E-mail atual: ${input.currentEmail}`,
    `Novo e-mail: ${input.newEmail}`,
    '',
    `Seu código: ${formattedCode}`,
    '',
    'Ou confirme direto por este link:',
    input.confirmUrl,
    '',
    `O código expira em ${plural(input.expiresInMinutes, 'minuto', 'minutos')}; o link, em ${plural(input.expiresInHours, 'hora', 'horas')}.`,
    'Se você não solicitou esta alteração, ignore este e-mail — o endereço não muda sozinho.',
  ].join('\n');

  const html = renderEmailLayout({
    eyebrow: 'Troca de e-mail',
    title: 'Confirme seu novo endereço',
    blocks: [
      emailText('O acesso da sua conta no DOQYN passará a ser por este endereço.'),
      emailRows([
        emailRow('E-mail atual', input.currentEmail),
        emailRow('Novo e-mail', input.newEmail),
      ]),
      emailText('Digite o código abaixo na tela de confirmação.'),
      emailCode(input.code),
      emailFine(`Expira em ${plural(input.expiresInMinutes, 'minuto', 'minutos')}.`),
      emailButton('Confirmar sem digitar', input.confirmUrl),
      emailFine(
        `Se o botão não abrir, use este endereço — ele vale por ${plural(input.expiresInHours, 'hora', 'horas')}:<br />` +
          `<a href="${escapeHtml(input.confirmUrl)}" style="color:#0e6e6a;word-break:break-all;">${escapeHtml(input.confirmUrl)}</a>`,
      ),
    ],
    footNote:
      'Você recebeu este e-mail porque ele foi indicado como novo endereço de uma conta DOQYN. Se não foi você, ignore esta mensagem — nada muda sem esta confirmação, e o endereço atual continua valendo.',
  });

  return { subject, text, html };
}
