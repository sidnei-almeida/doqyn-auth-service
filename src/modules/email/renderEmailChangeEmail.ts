import {
  emailButton,
  emailCode,
  emailFine,
  emailRow,
  emailRows,
  emailText,
  escapeHtml,
  renderEmailLayout,
} from './emailLayout.js';
import { duration, EMAIL_MESSAGES, resolveEmailLocale } from './emailMessages.js';

export type EmailChangeTemplateInput = {
  currentEmail: string;
  newEmail: string;
  code: string;
  confirmUrl: string;
  expiresInMinutes: number;
  expiresInHours: number;
  /** `AuthUser.locale` de quem pediu a troca. */
  locale?: string | null;
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
  const locale = resolveEmailLocale(input.locale);
  const { code: c, change: m } = EMAIL_MESSAGES[locale];
  const formattedCode = `${input.code.slice(0, 3)} ${input.code.slice(3)}`;
  const codeExpiry = duration(locale, input.expiresInMinutes, 'minute');
  const linkExpiry = duration(locale, input.expiresInHours, 'hour');
  const subject = m.subject(formattedCode);

  const text = [
    m.textIntro,
    '',
    `${m.currentEmail}: ${input.currentEmail}`,
    `${m.newEmail}: ${input.newEmail}`,
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
      emailText(escapeHtml(m.lead)),
      emailRows([
        emailRow(m.currentEmail, input.currentEmail),
        emailRow(m.newEmail, input.newEmail),
      ]),
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
