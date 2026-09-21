import { emailButton, emailFine, emailText, escapeHtml, renderEmailLayout } from './emailLayout.js';
import { duration, EMAIL_MESSAGES, resolveEmailLocale } from './emailMessages.js';

export type PasswordResetTemplateInput = {
  resetUrl: string;
  expiresInMinutes: number;
  /** `AuthUser.locale` de quem pediu a redefinição. */
  locale?: string | null;
};

/**
 * Só o link, nenhum código.
 *
 * O código de seis dígitos dos outros dois e-mails existe porque a pessoa pode digitar: ela está
 * na tela de confirmação, com o app aberto, e o código é mais rápido que trocar de aparelho. Uma
 * redefinição de senha não tem essa tela — o token que prova o pedido não é feito para ser
 * digitado, e inventar um código aqui só duplicaria o link sem resolver nada que ele já não
 * resolva.
 */
export function renderPasswordResetEmail(input: PasswordResetTemplateInput): {
  subject: string;
  text: string;
  html: string;
} {
  const locale = resolveEmailLocale(input.locale);
  const m = EMAIL_MESSAGES[locale].reset;
  const expiry = duration(locale, input.expiresInMinutes, 'minute');

  const subject = m.subject;

  const text = [
    m.textIntro,
    '',
    m.textAction,
    input.resetUrl,
    '',
    m.textExpires(expiry),
    m.textIgnore,
  ].join('\n');

  const html = renderEmailLayout({
    lang: locale,
    eyebrow: m.eyebrow,
    title: m.title,
    blocks: [
      emailText(escapeHtml(m.lead)),
      emailFine(escapeHtml(m.instruction)),
      emailButton(m.button, input.resetUrl),
      emailFine(
        `${escapeHtml(m.linkFallback(expiry))}<br />` +
          `<a href="${escapeHtml(input.resetUrl)}" style="color:#0e6e6a;word-break:break-all;">${escapeHtml(input.resetUrl)}</a>`,
      ),
    ],
    footNote: m.footNote,
  });

  return { subject, text, html };
}
