import { describe, it, expect } from 'vitest';
import { redactEmailsInText } from '../src/modules/email/email.service.js';

describe('mascaramento de e-mail em texto de erro', () => {
  it('mascara todo endereço e preserva o resto da mensagem', () => {
    const detalhe =
      'Resend recusou o envio (422): {"message":"Invalid `to` field: maria.silva@gmail.com"}';
    const mascarado = redactEmailsInText(detalhe);

    expect(mascarado).not.toContain('maria.silva@gmail.com');
    expect(mascarado).toContain('ma***@gmail.com');
    expect(mascarado).toContain('Resend recusou o envio (422)');
  });

  it('texto sem endereço sai igual', () => {
    expect(redactEmailsInText('Resend inacessível: timeout')).toBe('Resend inacessível: timeout');
  });
});
