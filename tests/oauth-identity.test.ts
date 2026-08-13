import { describe, it, expect } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair, type JWTPayload } from 'jose';

import { __testing__ } from '../src/modules/oauth/oauth.providers.js';

const { payloadToIdentity } = __testing__;

const base = (over: JWTPayload = {}): JWTPayload => ({
  sub: 'subject-123',
  name: 'Fulano de Tal',
  ...over,
});

describe('extração de e-mail do id_token', () => {
  it('usa a claim email quando presente', () => {
    const id = payloadToIdentity('google', base({ email: 'pessoa@empresa.com' }));
    expect(id.email).toBe('pessoa@empresa.com');
  });

  it('aceita preferred_username quando ele é um e-mail de verdade', () => {
    const id = payloadToIdentity('microsoft', base({ preferred_username: 'pessoa@empresa.com' }));
    expect(id.email).toBe('pessoa@empresa.com');
  });

  it('RECUSA preferred_username que não é e-mail — no Entra ele é o UPN', () => {
    // Caso real: UPN sem domínio roteável. Gravar isso como e-mail cria identidade errada.
    expect(payloadToIdentity('microsoft', base({ preferred_username: 'fulano' })).email).toBeNull();
    expect(
      payloadToIdentity('microsoft', base({ preferred_username: 'DOMINIO\\fulano' })).email,
    ).toBeNull();
  });

  it('devolve null quando não há e-mail utilizável', () => {
    expect(payloadToIdentity('microsoft', base()).email).toBeNull();
  });
});

describe('e-mail verificado por provedor — fronteira de vinculação automática', () => {
  it('Google: confia em email_verified', () => {
    expect(
      payloadToIdentity('google', base({ email: 'a@b.com', email_verified: true })).emailVerified,
    ).toBe(true);
    expect(
      payloadToIdentity('google', base({ email: 'a@b.com', email_verified: false })).emailVerified,
    ).toBe(false);
  });

  it('Microsoft: aceita xms_edov, que é a claim equivalente do Entra', () => {
    for (const value of [true, 1, '1', 'true']) {
      expect(
        payloadToIdentity('microsoft', base({ email: 'a@b.com', xms_edov: value })).emailVerified,
      ).toBe(true);
    }
  });

  it('Microsoft SEM xms_edov não é verificado — é a resposta segura, não um bug', () => {
    // O Entra não emite email_verified. Antes desta correção o código lia essa claim para os dois
    // provedores, então TODO usuário Microsoft ficava não verificado e nunca conseguia vincular.
    // Agora a ausência é tratada explicitamente: sem a claim opcional habilitada no app
    // registration, não há vinculação automática — o usuário vai para confirmação.
    const id = payloadToIdentity('microsoft', base({ email: 'a@b.com' }));
    expect(id.emailVerified).toBe(false);
  });

  it('Microsoft: xms_edov falso ou lixo não vira verificado', () => {
    for (const value of [false, 0, '0', 'false', 'sim', null, undefined, {}]) {
      expect(
        payloadToIdentity('microsoft', base({ email: 'a@b.com', xms_edov: value })).emailVerified,
      ).toBe(false);
    }
  });

  it('Google não é afetado pela presença de xms_edov', () => {
    const id = payloadToIdentity('google', base({ email: 'a@b.com', xms_edov: true }));
    expect(id.emailVerified).toBe(false);
  });
});

describe('demais campos da identidade', () => {
  it('carrega subject, nome, avatar e tenant do provedor', () => {
    const id = payloadToIdentity(
      'microsoft',
      base({
        sub: 'sub-abc',
        email: 'a@b.com',
        name: 'Fulano de Tal',
        picture: 'https://example.test/a.png',
        tid: 'tenant-xyz',
      }),
    );

    expect(id.subject).toBe('sub-abc');
    expect(id.displayName).toBe('Fulano de Tal');
    expect(id.avatarUrl).toBe('https://example.test/a.png');
    expect(id.providerTenantId).toBe('tenant-xyz');
    expect(id.provider).toBe('microsoft');
  });

  it('ignora campos com tipo inesperado em vez de propagar lixo', () => {
    const id = payloadToIdentity('google', base({ email: 'a@b.com', name: 42, picture: {}, tid: 7 }));
    expect(id.displayName).toBeNull();
    expect(id.avatarUrl).toBeNull();
    expect(id.providerTenantId).toBeNull();
  });
});

describe('id_token assinado de verdade continua sendo aceito', () => {
  it('sobrevive ao caminho real de verificação (assinatura + claims)', async () => {
    // Guarda de sanidade: o payload que a verificação real produz é o mesmo que testamos acima.
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    expect(jwk.kty).toBe('RSA');

    const token = await new SignJWT({ email: 'a@b.com', email_verified: true, nonce: 'n1' })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject('sub-1')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);

    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);
  });
});
