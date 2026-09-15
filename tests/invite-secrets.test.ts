import { describe, it, expect } from 'vitest';
import type { Env } from '../src/config/env.js';
import { inviteSecretsForInviter } from '../src/modules/invites/invites.service.js';

describe('segredo do convite na resposta de quem convida', () => {
  it('produção não devolve link nem token', () => {
    expect(inviteSecretsForInviter('tok_abc', { NODE_ENV: 'production' } as Env)).toEqual({});
  });

  it('fora de produção devolve os dois, para percorrer o fluxo sem e-mail', () => {
    const secrets = inviteSecretsForInviter('tok_abc', {
      NODE_ENV: 'development',
      DOQYN_APP_PUBLIC_URL: 'http://localhost:5173',
    } as Env);
    expect(secrets.inviteToken).toBe('tok_abc');
    expect(secrets.inviteLink).toBe('http://localhost:5173/invite/tok_abc');
  });
});
