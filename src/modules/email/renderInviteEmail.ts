import {
  emailButton,
  emailFine,
  emailRow,
  emailRows,
  emailText,
  escapeHtml,
  renderEmailLayout,
  strong,
} from './emailLayout.js';
import { duration, EMAIL_MESSAGES, resolveEmailLocale } from './emailMessages.js';

export type InviteEmailTemplateInput = {
  inviterName: string;
  inviterEmail: string;
  tenantDisplayName: string;
  inviteUrl: string;
  expiresInDays: number;
  /** `AuthInvite.locale` — quem recebe ainda não tem perfil onde o idioma esteja. */
  locale?: string | null;
};

/**
 * Convite para entrar numa empresa.
 *
 * Este é o e-mail de maior exposição: quem recebe pode nunca ter ouvido falar do DOQYN, e a
 * primeira pergunta é "quem me mandou isto". Por isso quem convidou e para onde aparecem como
 * linha de registro, com nome e e-mail — sem isso o convite lê como spam, por mais bonito que
 * seja o resto.
 */
export function renderInviteEmail(input: InviteEmailTemplateInput): {
  subject: string;
  text: string;
  html: string;
} {
  const locale = resolveEmailLocale(input.locale);
  const m = EMAIL_MESSAGES[locale].invite;
  const company = input.tenantDisplayName || m.fallbackCompany;
  const validity = duration(locale, input.expiresInDays, 'day');
  const subject = m.subject(input.inviterName, company);

  const text = [
    m.textIntro(input.inviterName, input.inviterEmail, company),
    '',
    m.textAccept,
    input.inviteUrl,
    '',
    m.textExpires(validity),
    '',
    m.textIgnore,
  ].join('\n');

  const html = renderEmailLayout({
    lang: locale,
    eyebrow: m.eyebrow,
    title: m.title(company),
    blocks: [
      emailText(m.body(strong(input.inviterName), strong(company))),
      emailRows([
        emailRow(m.rowInviter, `${input.inviterName} · ${input.inviterEmail}`),
        emailRow(m.rowCompany, company),
      ]),
      emailButton(m.button, input.inviteUrl),
      emailFine(
        `${escapeHtml(m.linkFallback(validity))}<br />` +
          `<a href="${escapeHtml(input.inviteUrl)}" style="color:#0e6e6a;word-break:break-all;">${escapeHtml(input.inviteUrl)}</a>`,
      ),
    ],
    footNote: m.footNote,
  });

  return { subject, text, html };
}
