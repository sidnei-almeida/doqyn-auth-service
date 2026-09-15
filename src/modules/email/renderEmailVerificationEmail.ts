import {
  emailButton,
  emailCode,
  emailFine,
  emailText,
  escapeHtml,
  renderEmailLayout,
} from './emailLayout.js';
import { duration, EMAIL_MESSAGES, resolveEmailLocale } from './emailMessages.js';

export type EmailVerificationTemplateInput = {
  code: string;
  confirmUrl: string;
  expiresInMinutes: number;
  linkExpiresInHours: number;
  /** `AuthUser.locale` de quem se cadastrou. */
  locale?: string | null;
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
  const locale = resolveEmailLocale(input.locale);
  const { code: c, verification: m } = EMAIL_MESSAGES[locale];
  const formattedCode = `${input.code.slice(0, 3)} ${input.code.slice(3)}`;
  const codeExpiry = duration(locale, input.expiresInMinutes, 'minute');
  const linkExpiry = duration(locale, input.linkExpiresInHours, 'hour');

  // O código no assunto poupa abrir o e-mail de quem está com a tela de confirmação na frente.
  const subject = m.subject(formattedCode);

  const text = [
    m.textIntro,
    '',
    c.yourCode(formattedCode),
    '',
    c.orConfirmByLink,
    input.confirmUrl,
    '',
    c.codeAndLinkExpiry(codeExpiry, linkExpiry),
    m.textIgnore,
  ].join('\n');

  const html = renderEmailLayout({
    lang: locale,
    eyebrow: m.eyebrow,
    title: m.title,
    blocks: [
      emailText(escapeHtml(m.instruction)),
      emailCode(input.code),
      emailFine(escapeHtml(c.expiresIn(codeExpiry))),
      emailButton(c.confirmWithoutTyping, input.confirmUrl),
      emailFine(
        `${escapeHtml(c.linkFallback(linkExpiry))}<br />` +
          `<a href="${escapeHtml(input.confirmUrl)}" style="color:#0e6e6a;word-break:break-all;">${escapeHtml(input.confirmUrl)}</a>`,
      ),
    ],
    footNote: m.footNote,
  });

  return { subject, text, html };
}
