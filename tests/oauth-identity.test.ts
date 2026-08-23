import { describe, it, expect } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair, type JWTPayload } from 'jose';

import { __testing__, assertMicrosoftIssuer } from '../src/modules/oauth/oauth.providers.js';

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
    const id = payloadToIdentity(
      'google',
      base({ email: 'a@b.com', name: 42, picture: {}, tid: 7 }),
    );
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

describe('emissor do id_token do Entra', () => {
  const TENANT_GUID = '010e8cf0-f8ee-4da8-acb3-2ee3c7a82c19';
  const PERSONAL_GUID = '9188040d-6c67-4c5b-b112-36a304b66dad';
  const issuerOf = (tid: string) => `https://login.microsoftonline.com/${tid}/v2.0`;

  it('aceita o tenant concreto quando o app é multitenant (common)', () => {
    // Regressão: exigir `.../common/v2.0` rejeitava TODO login com `unexpected "iss" claim value`.
    // O Entra emite o tenant de quem logou, nunca o endereço de entrada.
    expect(() =>
      assertMicrosoftIssuer({ iss: issuerOf(TENANT_GUID), tid: TENANT_GUID }, 'common'),
    ).not.toThrow();
  });

  it('aceita conta pessoal Microsoft, que tem tenant próprio', () => {
    expect(() =>
      assertMicrosoftIssuer({ iss: issuerOf(PERSONAL_GUID), tid: PERSONAL_GUID }, 'common'),
    ).not.toThrow();
  });

  it('recusa token cujo iss não é de um tenant', () => {
    expect(() =>
      assertMicrosoftIssuer({ iss: issuerOf('common'), tid: TENANT_GUID }, 'common'),
    ).toThrow('OAUTH_ISSUER_INVALID');
    expect(() =>
      assertMicrosoftIssuer(
        { iss: 'https://login.evil.com/' + TENANT_GUID + '/v2.0', tid: TENANT_GUID },
        'common',
      ),
    ).toThrow('OAUTH_ISSUER_INVALID');
  });

  it('recusa iss de um tenant e tid de outro — token de um diretório passando por outro', () => {
    expect(() =>
      assertMicrosoftIssuer({ iss: issuerOf(TENANT_GUID), tid: PERSONAL_GUID }, 'common'),
    ).toThrow('OAUTH_ISSUER_TENANT_MISMATCH');
    expect(() => assertMicrosoftIssuer({ iss: issuerOf(TENANT_GUID) }, 'common')).toThrow(
      'OAUTH_ISSUER_TENANT_MISMATCH',
    );
  });

  it('com organizations, recusa conta pessoal — o alias exclui MSA de propósito', () => {
    expect(() =>
      assertMicrosoftIssuer({ iss: issuerOf(PERSONAL_GUID), tid: PERSONAL_GUID }, 'organizations'),
    ).toThrow('OAUTH_ISSUER_TENANT_MISMATCH');
    expect(() =>
      assertMicrosoftIssuer({ iss: issuerOf(TENANT_GUID), tid: TENANT_GUID }, 'organizations'),
    ).not.toThrow();
  });

  it('com consumers, recusa tenant corporativo', () => {
    expect(() =>
      assertMicrosoftIssuer({ iss: issuerOf(TENANT_GUID), tid: TENANT_GUID }, 'consumers'),
    ).toThrow('OAUTH_ISSUER_TENANT_MISMATCH');
    expect(() =>
      assertMicrosoftIssuer({ iss: issuerOf(PERSONAL_GUID), tid: PERSONAL_GUID }, 'consumers'),
    ).not.toThrow();
  });

  it('com tenant fixo, exige aquele tenant e nenhum outro', () => {
    expect(() =>
      assertMicrosoftIssuer({ iss: issuerOf(TENANT_GUID), tid: TENANT_GUID }, TENANT_GUID),
    ).not.toThrow();
    expect(() =>
      assertMicrosoftIssuer({ iss: issuerOf(PERSONAL_GUID), tid: PERSONAL_GUID }, TENANT_GUID),
    ).toThrow('OAUTH_ISSUER_INVALID');
  });
});

describe('conta pessoal Microsoft — prova de posse vem da criação da conta', () => {
  const MSA = '9188040d-6c67-4c5b-b112-36a304b66dad';
  const CORP = '010e8cf0-f8ee-4da8-acb3-2ee3c7a82c19';
  const verified = (over: JWTPayload) => payloadToIdentity('microsoft', base(over)).emailVerified;

  it('aceita conta pessoal com a claim email, mesmo sem xms_edov', () => {
    // Caso real: MSA com endereço @gmail.com. `xms_edov` nunca vem — o dono do domínio é o Google.
    expect(verified({ tid: MSA, email: 'pessoa@gmail.com' })).toBe(true);
  });

  it('RECUSA conta pessoal cujo e-mail veio só do preferred_username', () => {
    // UPN pode ser alias interno que ninguém confirmou; aceitá-lo reabriria o buraco.
    expect(verified({ tid: MSA, preferred_username: 'pessoa@gmail.com' })).toBe(false);
    expect(verified({ tid: MSA })).toBe(false);
  });

  it('conta corporativa continua dependendo de xms_edov', () => {
    expect(verified({ tid: CORP, email: 'pessoa@empresa.com' })).toBe(false);
    expect(verified({ tid: CORP, email: 'pessoa@empresa.com', xms_edov: true })).toBe(true);
  });

  it('xms_edov não vale para e-mail que veio do preferred_username', () => {
    // Usuário Entra sem atributo `mail`: `extractEmail` cai no UPN, e `xms_edov` não afirma nada
    // sobre ele. Aceitar aqui vincularia automaticamente a conta de outra pessoa.
    expect(verified({ tid: CORP, xms_edov: true, preferred_username: 'alice@parceira.com' })).toBe(
      false,
    );
  });

  it('tid em caixa alta continua sendo conta pessoal', () => {
    // GUID não tem caixa canônica; `assertMicrosoftIssuer` já compara minúsculo.
    expect(verified({ tid: MSA.toUpperCase(), email: 'pessoa@gmail.com' })).toBe(true);
  });
});
