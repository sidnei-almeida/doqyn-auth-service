import {
  emailButton,
  emailFine,
  emailRow,
  emailRows,
  emailText,
  escapeHtml,
  plural,
  renderEmailLayout,
  strong,
} from './emailLayout.js';

export type InviteEmailTemplateInput = {
  inviterName: string;
  inviterEmail: string;
  tenantDisplayName: string;
  inviteUrl: string;
  expiresInDays: number;
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
  const company = input.tenantDisplayName || 'sua empresa';
  const subject = `${input.inviterName} convidou você para ${company} no DOQYN`;

  const text = [
    `${input.inviterName} (${input.inviterEmail}) convidou você para participar de ${company} no DOQYN.`,
    '',
    'Para aceitar o convite e criar seu acesso, use o link abaixo:',
    input.inviteUrl,
    '',
    `Este convite expira em ${plural(input.expiresInDays, 'dia', 'dias')}.`,
    '',
    'Se você não esperava este convite, ignore este e-mail.',
  ].join('\n');

  const html = renderEmailLayout({
    eyebrow: 'Convite',
    title: `Você foi convidado para ${company}`,
    blocks: [
      emailText(
        `${strong(input.inviterName)} convidou você para participar de ${strong(company)} no DOQYN — ` +
          'a plataforma onde a empresa guarda, classifica e assina os documentos dela.',
      ),
      emailRows([
        emailRow('Quem convidou', `${input.inviterName} · ${input.inviterEmail}`),
        emailRow('Empresa', company),
      ]),
      emailButton('Aceitar convite', input.inviteUrl),
      emailFine(
        `Se o botão não abrir, use este endereço — o convite vale por ${plural(input.expiresInDays, 'dia', 'dias')}:<br />` +
          `<a href="${escapeHtml(input.inviteUrl)}" style="color:#0e6e6a;word-break:break-all;">${escapeHtml(input.inviteUrl)}</a>`,
      ),
    ],
    footNote:
      'Você recebeu este e-mail porque seu endereço foi convidado para uma empresa no DOQYN. Se não esperava este convite, ignore esta mensagem — nenhuma conta é criada sem que você aceite.',
  });

  return { subject, text, html };
}
