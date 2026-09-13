import { DEFAULT_LOCALE, normalizeLocale, type SupportedLocale } from '../../utils/locales.js';

/**
 * O texto dos e-mails do auth-service, nos três idiomas.
 *
 * **Não é o catálogo do alpha, e não usa i18next.** Este serviço manda três e-mails; puxar uma
 * biblioteca de tradução para eles seria mais dependência do que texto. Frase é função: o que
 * varia entra por parâmetro, e a ordem das palavras fica com quem traduz — "convidou você para X"
 * e "te invitó a X" não concatenam do mesmo jeito.
 *
 * O que chega aqui como `Html` já foi escapado por quem chama (`strong`); o resto é texto puro e a
 * casca escapa.
 */

type Html = string;
type Unit = 'day' | 'hour' | 'minute';

const UNITS: Record<SupportedLocale, Record<Unit, [one: string, other: string]>> = {
  'pt-BR': { day: ['dia', 'dias'], hour: ['hora', 'horas'], minute: ['minuto', 'minutos'] },
  'en-US': { day: ['day', 'days'], hour: ['hour', 'hours'], minute: ['minute', 'minutes'] },
  'es-419': { day: ['día', 'días'], hour: ['hora', 'horas'], minute: ['minuto', 'minutos'] },
};

export function resolveEmailLocale(value: string | null | undefined): SupportedLocale {
  return normalizeLocale(value) ?? DEFAULT_LOCALE;
}

/**
 * Plural pela regra do idioma, e não `hora(s)`.
 *
 * O parêntese é a marca de e-mail gerado por sistema. A categoria vem do `Intl.PluralRules`: o que
 * não é `one` usa a forma plural — em espanhol o `many` só aparece em número compacto.
 */
export function duration(locale: SupportedLocale, count: number, unit: Unit): string {
  const [one, other] = UNITS[locale][unit];
  return `${count} ${new Intl.PluralRules(locale).select(count) === 'one' ? one : other}`;
}

export type EmailMessages = {
  code: {
    yourCode: (code: string) => string;
    orConfirmByLink: string;
    codeAndLinkExpiry: (codeExpiry: string, linkExpiry: string) => string;
    expiresIn: (expiry: string) => string;
    confirmWithoutTyping: string;
    linkFallback: (expiry: string) => string;
  };
  invite: {
    fallbackCompany: string;
    subject: (inviter: string, company: string) => string;
    textIntro: (inviter: string, inviterEmail: string, company: string) => string;
    textAccept: string;
    textExpires: (expiry: string) => string;
    textIgnore: string;
    eyebrow: string;
    title: (company: string) => string;
    body: (inviter: Html, company: Html) => Html;
    rowInviter: string;
    rowCompany: string;
    button: string;
    linkFallback: (expiry: string) => string;
    footNote: string;
  };
  verification: {
    subject: (code: string) => string;
    textIntro: string;
    textIgnore: string;
    eyebrow: string;
    title: string;
    instruction: string;
    footNote: string;
  };
  change: {
    subject: (code: string) => string;
    textIntro: string;
    currentEmail: string;
    newEmail: string;
    textIgnore: string;
    eyebrow: string;
    title: string;
    lead: string;
    instruction: string;
    footNote: string;
  };
};

export const EMAIL_MESSAGES: Record<SupportedLocale, EmailMessages> = {
  'pt-BR': {
    code: {
      yourCode: (code) => `Seu código: ${code}`,
      orConfirmByLink: 'Ou confirme direto por este link:',
      codeAndLinkExpiry: (codeExpiry, linkExpiry) =>
        `O código expira em ${codeExpiry}; o link, em ${linkExpiry}.`,
      expiresIn: (expiry) => `Expira em ${expiry}.`,
      confirmWithoutTyping: 'Confirmar sem digitar',
      linkFallback: (expiry) => `Se o botão não abrir, use este endereço — ele vale por ${expiry}:`,
    },
    invite: {
      fallbackCompany: 'sua empresa',
      subject: (inviter, company) => `${inviter} convidou você para ${company} no DOQYN`,
      textIntro: (inviter, inviterEmail, company) =>
        `${inviter} (${inviterEmail}) convidou você para participar de ${company} no DOQYN.`,
      textAccept: 'Para aceitar o convite e criar seu acesso, use o link abaixo:',
      textExpires: (expiry) => `Este convite expira em ${expiry}.`,
      textIgnore: 'Se você não esperava este convite, ignore este e-mail.',
      eyebrow: 'Convite',
      title: (company) => `Você foi convidado para ${company}`,
      body: (inviter, company) =>
        `${inviter} convidou você para participar de ${company} no DOQYN — a plataforma onde a empresa guarda, classifica e assina os documentos dela.`,
      rowInviter: 'Quem convidou',
      rowCompany: 'Empresa',
      button: 'Aceitar convite',
      linkFallback: (expiry) =>
        `Se o botão não abrir, use este endereço — o convite vale por ${expiry}:`,
      footNote:
        'Você recebeu este e-mail porque seu endereço foi convidado para uma empresa no DOQYN. Se não esperava este convite, ignore esta mensagem — nenhuma conta é criada sem que você aceite.',
    },
    verification: {
      subject: (code) => `${code} é seu código de confirmação DOQYN`,
      textIntro: 'Confirme seu e-mail para ativar sua conta no DOQYN.',
      textIgnore:
        'Se você não criou esta conta, ignore este e-mail — nada acontece sem esta confirmação.',
      eyebrow: 'Confirmação de cadastro',
      title: 'Confirme seu e-mail',
      instruction: 'Digite o código abaixo na tela de confirmação para ativar sua conta.',
      footNote:
        'Você recebeu este e-mail porque ele foi informado num cadastro no DOQYN. Se não foi você, ignore esta mensagem — a conta não é ativada sem esta confirmação.',
    },
    change: {
      subject: (code) => `${code} é seu código para trocar o e-mail no DOQYN`,
      textIntro: 'Recebemos uma solicitação para alterar o e-mail da sua conta no DOQYN.',
      currentEmail: 'E-mail atual',
      newEmail: 'Novo e-mail',
      textIgnore:
        'Se você não solicitou esta alteração, ignore este e-mail — o endereço não muda sozinho.',
      eyebrow: 'Troca de e-mail',
      title: 'Confirme seu novo endereço',
      lead: 'O acesso da sua conta no DOQYN passará a ser por este endereço.',
      instruction: 'Digite o código abaixo na tela de confirmação.',
      footNote:
        'Você recebeu este e-mail porque ele foi indicado como novo endereço de uma conta DOQYN. Se não foi você, ignore esta mensagem — nada muda sem esta confirmação, e o endereço atual continua valendo.',
    },
  },

  'en-US': {
    code: {
      yourCode: (code) => `Your code: ${code}`,
      orConfirmByLink: 'Or confirm directly with this link:',
      codeAndLinkExpiry: (codeExpiry, linkExpiry) =>
        `The code expires in ${codeExpiry}; the link, in ${linkExpiry}.`,
      expiresIn: (expiry) => `Expires in ${expiry}.`,
      confirmWithoutTyping: 'Confirm without typing',
      linkFallback: (expiry) =>
        `If the button doesn't open, use this address — it's valid for ${expiry}:`,
    },
    invite: {
      fallbackCompany: 'your company',
      subject: (inviter, company) => `${inviter} invited you to ${company} on DOQYN`,
      textIntro: (inviter, inviterEmail, company) =>
        `${inviter} (${inviterEmail}) invited you to join ${company} on DOQYN.`,
      textAccept: 'To accept the invitation and create your access, use the link below:',
      textExpires: (expiry) => `This invitation expires in ${expiry}.`,
      textIgnore: "If you weren't expecting this invitation, ignore this email.",
      eyebrow: 'Invitation',
      title: (company) => `You've been invited to ${company}`,
      body: (inviter, company) =>
        `${inviter} invited you to join ${company} on DOQYN — the platform where the company stores, classifies and signs its documents.`,
      rowInviter: 'Invited by',
      rowCompany: 'Company',
      button: 'Accept invitation',
      linkFallback: (expiry) =>
        `If the button doesn't open, use this address — the invitation is valid for ${expiry}:`,
      footNote:
        "You received this email because your address was invited to a company on DOQYN. If you weren't expecting this invitation, ignore this message — no account is created unless you accept.",
    },
    verification: {
      subject: (code) => `${code} is your DOQYN confirmation code`,
      textIntro: 'Confirm your email to activate your DOQYN account.',
      textIgnore:
        "If you didn't create this account, ignore this email — nothing happens without this confirmation.",
      eyebrow: 'Sign-up confirmation',
      title: 'Confirm your email',
      instruction: 'Enter the code below on the confirmation screen to activate your account.',
      footNote:
        "You received this email because it was entered in a DOQYN sign-up. If it wasn't you, ignore this message — the account isn't activated without this confirmation.",
    },
    change: {
      subject: (code) => `${code} is your code to change your email on DOQYN`,
      textIntro: 'We received a request to change the email on your DOQYN account.',
      currentEmail: 'Current email',
      newEmail: 'New email',
      textIgnore:
        "If you didn't request this change, ignore this email — the address doesn't change on its own.",
      eyebrow: 'Email change',
      title: 'Confirm your new address',
      lead: 'Your DOQYN account will be accessed with this address from now on.',
      instruction: 'Enter the code below on the confirmation screen.',
      footNote:
        "You received this email because it was set as the new address of a DOQYN account. If it wasn't you, ignore this message — nothing changes without this confirmation, and the current address remains valid.",
    },
  },

  'es-419': {
    code: {
      yourCode: (code) => `Tu código: ${code}`,
      orConfirmByLink: 'O confirma directamente con este enlace:',
      codeAndLinkExpiry: (codeExpiry, linkExpiry) =>
        `El código vence en ${codeExpiry}; el enlace, en ${linkExpiry}.`,
      expiresIn: (expiry) => `Vence en ${expiry}.`,
      confirmWithoutTyping: 'Confirmar sin escribir',
      linkFallback: (expiry) =>
        `Si el botón no abre, usa esta dirección — es válida por ${expiry}:`,
    },
    invite: {
      fallbackCompany: 'tu empresa',
      subject: (inviter, company) => `${inviter} te invitó a ${company} en DOQYN`,
      textIntro: (inviter, inviterEmail, company) =>
        `${inviter} (${inviterEmail}) te invitó a unirte a ${company} en DOQYN.`,
      textAccept: 'Para aceptar la invitación y crear tu acceso, usa el enlace de abajo:',
      textExpires: (expiry) => `Esta invitación vence en ${expiry}.`,
      textIgnore: 'Si no esperabas esta invitación, ignora este correo.',
      eyebrow: 'Invitación',
      title: (company) => `Te invitaron a ${company}`,
      body: (inviter, company) =>
        `${inviter} te invitó a unirte a ${company} en DOQYN — la plataforma donde la empresa guarda, clasifica y firma sus documentos.`,
      rowInviter: 'Quién invitó',
      rowCompany: 'Empresa',
      button: 'Aceptar invitación',
      linkFallback: (expiry) =>
        `Si el botón no abre, usa esta dirección — la invitación es válida por ${expiry}:`,
      footNote:
        'Recibiste este correo porque tu dirección fue invitada a una empresa en DOQYN. Si no esperabas esta invitación, ignora este mensaje — no se crea ninguna cuenta sin que la aceptes.',
    },
    verification: {
      subject: (code) => `${code} es tu código de confirmación de DOQYN`,
      textIntro: 'Confirma tu correo para activar tu cuenta en DOQYN.',
      textIgnore:
        'Si no creaste esta cuenta, ignora este correo — no pasa nada sin esta confirmación.',
      eyebrow: 'Confirmación de registro',
      title: 'Confirma tu correo',
      instruction:
        'Ingresa el código de abajo en la pantalla de confirmación para activar tu cuenta.',
      footNote:
        'Recibiste este correo porque se ingresó en un registro de DOQYN. Si no fuiste tú, ignora este mensaje — la cuenta no se activa sin esta confirmación.',
    },
    change: {
      subject: (code) => `${code} es tu código para cambiar el correo en DOQYN`,
      textIntro: 'Recibimos una solicitud para cambiar el correo de tu cuenta en DOQYN.',
      currentEmail: 'Correo actual',
      newEmail: 'Correo nuevo',
      textIgnore:
        'Si no solicitaste este cambio, ignora este correo — la dirección no cambia sola.',
      eyebrow: 'Cambio de correo',
      title: 'Confirma tu nueva dirección',
      lead: 'El acceso a tu cuenta de DOQYN pasará a ser con esta dirección.',
      instruction: 'Ingresa el código de abajo en la pantalla de confirmación.',
      footNote:
        'Recibiste este correo porque se indicó como nueva dirección de una cuenta de DOQYN. Si no fuiste tú, ignora este mensaje — nada cambia sin esta confirmación, y la dirección actual sigue siendo válida.',
    },
  },
};
