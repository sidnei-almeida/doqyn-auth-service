import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { renderInviteEmail } from '../src/modules/email/renderInviteEmail.js';
import { renderEmailVerificationEmail } from '../src/modules/email/renderEmailVerificationEmail.js';
import { renderEmailChangeEmail } from '../src/modules/email/renderEmailChangeEmail.js';
import { renderPasswordResetEmail } from '../src/modules/email/renderPasswordResetEmail.js';
import { duration, EMAIL_MESSAGES } from '../src/modules/email/emailMessages.js';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

const invite = {
  inviterName: 'Ana <Admin>',
  inviterEmail: 'ana@empresa.com',
  tenantDisplayName: 'Horizonte',
  inviteUrl: 'https://app.doqyn.com/invite/t',
  expiresInDays: 1,
};

describe('e-mails do auth no idioma de quem recebe', () => {
  it('convite em espanhol, com plural do idioma e nome escapado', () => {
    const rendered = renderInviteEmail({ ...invite, locale: 'es-MX' });
    expect(rendered.subject).toBe('Ana <Admin> te invitó a Horizonte en DOQYN');
    expect(rendered.text).toContain('Esta invitación vence en 1 día.');
    expect(rendered.html).toContain('<html lang="es-419">');
    expect(rendered.html).toContain('Aceptar invitación');
    expect(rendered.html).toContain('Ana &lt;Admin&gt;');
    expect(rendered.html).not.toContain('Ana <Admin>');
  });

  it('sem idioma, ou com idioma desconhecido, sai em pt-BR', () => {
    expect(renderInviteEmail(invite).html).toContain('Aceitar convite');
    expect(renderInviteEmail({ ...invite, locale: 'fr-FR' }).subject).toContain('convidou você');
  });

  it('confirmação em inglês leva código no assunto e prazos no plural certo', () => {
    const rendered = renderEmailVerificationEmail({
      code: '123456',
      confirmUrl: 'https://app.doqyn.com/verify-email/t',
      expiresInMinutes: 15,
      linkExpiresInHours: 1,
      locale: 'en-US',
    });
    expect(rendered.subject).toBe('123 456 is your DOQYN confirmation code');
    expect(rendered.text).toContain('The code expires in 15 minutes; the link, in 1 hour.');
    expect(rendered.html).toContain('Confirm without typing');
  });

  it('troca de e-mail em espanhol mostra os dois endereços com rótulo traduzido', () => {
    const rendered = renderEmailChangeEmail({
      currentEmail: 'a@x.com',
      newEmail: 'b@x.com',
      code: '654321',
      confirmUrl: 'https://app.doqyn.com/confirm-email-change/t',
      expiresInMinutes: 10,
      expiresInHours: 24,
      locale: 'es-419',
    });
    expect(rendered.subject).toBe('654 321 es tu código para cambiar el correo en DOQYN');
    expect(rendered.text).toContain('Correo actual: a@x.com');
    expect(rendered.html).toContain('Confirma tu nueva dirección');
  });

  it('redefinição de senha em espanhol só leva link, sem código', () => {
    const rendered = renderPasswordResetEmail({
      resetUrl: 'https://app.doqyn.com/reset-password/t',
      expiresInMinutes: 30,
      locale: 'es-419',
    });
    expect(rendered.subject).toBe('Restablece tu contraseña en DOQYN');
    expect(rendered.text).toContain('Este enlace vence en 30 minutos.');
    expect(rendered.html).toContain('Restablecer contraseña');
    expect(rendered.html).toContain('app.doqyn.com/reset-password/t');
  });

  it('os três idiomas têm as mesmas frases', () => {
    const shape = (value: unknown): unknown =>
      value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v)]))
        : typeof value;
    expect(shape(EMAIL_MESSAGES['en-US'])).toEqual(shape(EMAIL_MESSAGES['pt-BR']));
    expect(shape(EMAIL_MESSAGES['es-419'])).toEqual(shape(EMAIL_MESSAGES['pt-BR']));
    expect(duration('pt-BR', 2, 'day')).toBe('2 dias');
    expect(duration('en-US', 1, 'hour')).toBe('1 hour');
  });

  it('quem envia passa o idioma: convite pelo da empresa, os outros pelo da conta', () => {
    const invites = read('src/modules/invites/invites.service.ts');
    expect(invites.match(/locale: tenant\.defaultLocale/g)?.length).toBe(3);
    expect(read('src/modules/email-verification/emailVerification.service.ts')).toContain(
      'locale: user.locale',
    );
    expect(read('src/modules/email-change/emailChange.service.ts')).toContain(
      'locale: user.locale',
    );
  });
});
