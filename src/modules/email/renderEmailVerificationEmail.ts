import {
  emailButton,
  emailCode,
  emailFine,
  emailText,
  escapeHtml,
  plural,
  renderEmailLayout,
} from './emailLayout.js';

export type EmailVerificationTemplateInput = {
  code: string;
  confirmUrl: string;
  expiresInMinutes: number;
  linkExpiresInHours: number;
};

/**
 * Manda o código e o link no mesmo e-mail.
 *
 * Os dois cobrem casos diferentes: o link resolve quem lê a mensagem no mesmo aparelho em que
 * abriu a conta, e o código resolve o caso comum — e-mail no celular, cadastro no computador.
 * Mandar só um dos dois obriga metade das pessoas a trocar de aparelho no meio do cadastro.
 *
 * O código vem antes do botão de propósito: quem está com o computador aberto na tela de
 * confirmação quer os seis dígitos, não uma viagem de volta.
 */
export function renderEmailVerificationEmail(input: EmailVerificationTemplateInput): {
  subject: string;
  text: string;
  html: string;
} {
  const formattedCode = `${input.code.slice(0, 3)} ${input.code.slice(3)}`;

  // O código no assunto poupa abrir o e-mail de quem está com a tela de confirmação na frente.
  const subject = `${formattedCode} é seu código de confirmação DOQYN`;

  const text = [
    'Confirme seu e-mail para ativar sua conta no DOQYN.',
    '',
    `Seu código: ${formattedCode}`,
    '',
    'Ou confirme direto por este link:',
    input.confirmUrl,
    '',
    `O código expira em ${plural(input.expiresInMinutes, 'minuto', 'minutos')}; o link, em ${plural(input.linkExpiresInHours, 'hora', 'horas')}.`,
    'Se você não criou esta conta, ignore este e-mail — nada acontece sem esta confirmação.',
  ].join('\n');

  const html = renderEmailLayout({
    eyebrow: 'Confirmação de cadastro',
    title: 'Confirme seu e-mail',
    blocks: [
      emailText('Digite o código abaixo na tela de confirmação para ativar sua conta.'),
      emailCode(input.code),
      emailFine(`Expira em ${plural(input.expiresInMinutes, 'minuto', 'minutos')}.`),
      emailButton('Confirmar sem digitar', input.confirmUrl),
      emailFine(
        `Se o botão não abrir, use este endereço — ele vale por ${plural(input.linkExpiresInHours, 'hora', 'horas')}:<br />` +
          `<a href="${escapeHtml(input.confirmUrl)}" style="color:#0e6e6a;word-break:break-all;">${escapeHtml(input.confirmUrl)}</a>`,
      ),
    ],
    footNote:
      'Você recebeu este e-mail porque ele foi informado num cadastro no DOQYN. Se não foi você, ignore esta mensagem — a conta não é ativada sem esta confirmação.',
  });

  return { subject, text, html };
}
