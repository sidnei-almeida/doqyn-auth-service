import { describe, it, expect } from 'vitest';
import { renderInviteEmail } from '../src/modules/email/renderInviteEmail.js';

describe('renderInviteEmail', () => {
  it('inclui nome e e-mail do convidador no assunto e corpo', () => {
    const rendered = renderInviteEmail({
      inviterName: 'Maria Admin',
      inviterEmail: 'maria@empresa.com.br',
      tenantDisplayName: 'Empresa Teste',
      inviteUrl: 'http://localhost:5173/convite/token-demo',
      expiresInDays: 7,
    });

    expect(rendered.subject).toContain('Maria Admin');
    expect(rendered.subject).toContain('Empresa Teste');
    expect(rendered.text).toContain('maria@empresa.com.br');
    expect(rendered.html).toContain('Aceitar convite');
    expect(rendered.html).toContain('localhost:5173/convite/');
  });
});
