import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTPayload } from 'jose';
import type { OAuthIdentity, OAuthProviderName } from './oauth.types.js';
import { getGoogleOAuthConfig, getMicrosoftOAuthConfig } from './oauth.config.js';

export type TokenExchangeResponse = {
  id_token: string;
  access_token?: string;
  token_type?: string;
  expires_in?: number;
};

export function buildGoogleAuthorizeUrl(input: {
  state: string;
  nonce: string;
  codeChallenge: string;
}): string {
  const config = getGoogleOAuthConfig();
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: input.state,
    nonce: input.nonce,
    code_challenge: input.codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export function buildMicrosoftAuthorizeUrl(input: {
  state: string;
  nonce: string;
  codeChallenge: string;
}): string {
  const config = getMicrosoftOAuthConfig();
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    response_mode: 'query',
    scope: 'openid email profile',
    state: input.state,
    nonce: input.nonce,
    code_challenge: input.codeChallenge,
    code_challenge_method: 'S256',
    // Mesmo comportamento do botão do Google ao lado: quem tem conta pessoal e corporativa no
    // mesmo navegador escolhe qual usar, em vez de entrar direto com a sessão ativa.
    prompt: 'select_account',
  });
  return `https://login.microsoftonline.com/${config.tenant}/oauth2/v2.0/authorize?${params.toString()}`;
}

export async function exchangeGoogleCode(input: {
  code: string;
  codeVerifier: string;
}): Promise<TokenExchangeResponse> {
  const config = getGoogleOAuthConfig();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    code_verifier: input.codeVerifier,
  });

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    throw new Error('GOOGLE_TOKEN_EXCHANGE_FAILED');
  }

  return (await response.json()) as TokenExchangeResponse;
}

export async function exchangeMicrosoftCode(input: {
  code: string;
  codeVerifier: string;
}): Promise<TokenExchangeResponse> {
  const config = getMicrosoftOAuthConfig();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    code_verifier: input.codeVerifier,
  });

  const response = await fetch(
    `https://login.microsoftonline.com/${config.tenant}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    },
  );

  if (!response.ok) {
    throw new Error('MICROSOFT_TOKEN_EXCHANGE_FAILED');
  }

  return (await response.json()) as TokenExchangeResponse;
}

const googleJwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

/**
 * `createRemoteJWKSet` mantém cache próprio das chaves, então recriá-lo a cada login jogaria fora
 * esse cache e buscaria o JWKS de novo em toda volta do provedor. Um por tenant, guardado.
 */
const microsoftJwksByTenant = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function microsoftJwks(tenant: string) {
  const cached = microsoftJwksByTenant.get(tenant);
  if (cached) return cached;

  const jwks = createRemoteJWKSet(
    new URL(`https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`),
  );
  microsoftJwksByTenant.set(tenant, jwks);
  return jwks;
}

/** Tenant fixo das contas pessoais Microsoft (MSA). Igual para todo consumidor, em todo mundo. */
const MICROSOFT_CONSUMER_TENANT_ID = '9188040d-6c67-4c5b-b112-36a304b66dad';

/**
 * O `tid` chega como GUID e GUID não tem caixa canônica. `assertMicrosoftIssuer` já compara
 * minúsculo contra o `iss`; comparar cru em qualquer outro lugar produz divergência silenciosa —
 * o mesmo token passaria numa checagem e falharia na outra.
 */
const isConsumerTenant = (tid: unknown): boolean =>
  typeof tid === 'string' && tid.toLowerCase() === MICROSOFT_CONSUMER_TENANT_ID;

/** Endereços de entrada do Entra: roteiam o login, mas nunca aparecem como emissor do token. */
const MICROSOFT_MULTITENANT_ALIASES = new Set(['common', 'organizations', 'consumers']);

const MICROSOFT_ISSUER_PATTERN =
  /^https:\/\/login\.microsoftonline\.com\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/v2\.0$/;

/**
 * Emissor esperado do id_token do Entra.
 *
 * `OAUTH_MICROSOFT_TENANT=common` é endereço de entrada, não identidade de emissor: o Entra emite
 * sempre o tenant concreto de quem logou — `https://login.microsoftonline.com/{tid}/v2.0`, com o
 * GUID do diretório, ou `9188040d-…` para conta pessoal Microsoft. Colar `common` na URL do issuer
 * e exigir igualdade rejeitava **todo** login com `unexpected "iss" claim value`.
 *
 * Em app multitenant a validação correta é de forma, não de valor fixo: o `iss` tem que ser um
 * tenant GUID e tem que ser o mesmo tenant que o token declara em `tid`. Sem amarrar as duas
 * claims, um token legítimo de um tenant poderia ser apresentado como se fosse de outro.
 *
 * Com tenant fixo (GUID ou domínio próprio no `.env`), continua comparação exata — quem restringe
 * o login a um diretório espera exatamente isso.
 */
export function assertMicrosoftIssuer(payload: JWTPayload, tenant: string): void {
  const issuer = typeof payload.iss === 'string' ? payload.iss : '';

  if (!MICROSOFT_MULTITENANT_ALIASES.has(tenant)) {
    if (issuer !== `https://login.microsoftonline.com/${tenant}/v2.0`) {
      throw new Error('OAUTH_ISSUER_INVALID');
    }
    return;
  }

  const match = MICROSOFT_ISSUER_PATTERN.exec(issuer);
  if (!match) {
    throw new Error('OAUTH_ISSUER_INVALID');
  }

  if (typeof payload.tid !== 'string' || payload.tid.toLowerCase() !== match[1]) {
    throw new Error('OAUTH_ISSUER_TENANT_MISMATCH');
  }

  // `organizations` e `consumers` não são sinônimos de `common`: o operador que escolheu um deles
  // excluiu metade do mundo de propósito. Sem esta checagem o alias aceitava qualquer tenant GUID,
  // conta pessoal inclusive — e ela hoje entra como e-mail verificado, com vinculação automática.
  const isConsumer = isConsumerTenant(payload.tid);
  if (tenant === 'organizations' && isConsumer) {
    throw new Error('OAUTH_ISSUER_TENANT_MISMATCH');
  }
  if (tenant === 'consumers' && !isConsumer) {
    throw new Error('OAUTH_ISSUER_TENANT_MISMATCH');
  }
}

/**
 * Tenant de onde buscar as chaves de assinatura.
 *
 * A Microsoft documenta que app multitenant valide a assinatura pelo endpoint do tenant emissor, e
 * não pelo `common`. O `tid` sai daqui do token ainda não verificado, o que é seguro porque ele só
 * escolhe QUAL chave tentar: assinatura falsa não passa em chave nenhuma, e `assertMicrosoftIssuer`
 * amarra `iss` e `tid` depois da verificação.
 */
function microsoftKeyTenant(idToken: string, configuredTenant: string): string {
  if (!MICROSOFT_MULTITENANT_ALIASES.has(configuredTenant)) return configuredTenant;

  try {
    const tid = decodeJwt(idToken).tid;
    if (typeof tid === 'string' && /^[0-9a-f-]{36}$/.test(tid)) return tid;
  } catch {
    // Token ilegível cai no endpoint comum e morre na verificação de assinatura, como deve.
  }

  return configuredTenant;
}

const looksLikeEmail = (value: unknown): value is string =>
  typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

/**
 * Extrai o e-mail do id_token.
 *
 * `preferred_username` só é aceito quando de fato parece um e-mail. No Google ele sempre é; no
 * Microsoft Entra ele é o UPN, que frequentemente NÃO é o e-mail do usuário — pode ser
 * `fulano@empresa.onmicrosoft.com`, um alias interno ou um login sem domínio roteável. Gravar isso
 * como e-mail da conta produz identidade errada e pode colidir com o e-mail de outra pessoa.
 */
function extractEmail(payload: JWTPayload): string | null {
  if (looksLikeEmail(payload.email)) return payload.email.trim();
  if (looksLikeEmail(payload.preferred_username)) return payload.preferred_username.trim();
  return null;
}

/**
 * Decide se o e-mail pode ser tratado como verificado pelo provedor.
 *
 * Isto governa a vinculação automática a uma conta existente (`resolveOAuthUser`), então é uma
 * fronteira de segurança: dizer "verificado" sem que o provedor garanta abre tomada de conta por
 * e-mail. Cada provedor tem contrato próprio:
 *
 * - **Google** emite `email_verified` (claim padrão OIDC). É a fonte da verdade.
 * - **Microsoft Entra NÃO emite `email_verified`** no id_token v2.0. A claim equivalente é
 *   `xms_edov` (*email domain owner verified*), que precisa ser habilitada como claim opcional no
 *   app registration. Sem ela, nada é verificado — e essa é a resposta segura, não um bug: o
 *   usuário cai no fluxo de confirmação em vez de ser vinculado às cegas.
 *
 * Ler `email_verified` para os dois, como se fazia antes, tornava TODO usuário Microsoft não
 * verificado: quem já tinha conta por senha nunca conseguia vincular, e todo usuário novo nascia
 * sem a garantia que o SSO deveria trazer de graça.
 *
 * - **Conta pessoal Microsoft** (tenant `9188040d-…`) nunca terá `xms_edov`: a claim afirma que o
 *   dono do DOMÍNIO verificou o endereço, e o dono de `gmail.com` não é a Microsoft. Só que a
 *   Microsoft exige confirmação por código no endereço para criar a conta — a mesma prova de posse
 *   que sustenta o `email_verified` do Google. Exigir `xms_edov` aqui deixava esse usuário sem
 *   saída nenhuma: nunca vincula, e o produto tem justamente esse público.
 */
function isEmailVerifiedByProvider(provider: OAuthProviderName, payload: JWTPayload): boolean {
  if (provider === 'google') {
    return payload.email_verified === true;
  }

  // Microsoft: `xms_edov` vem como boolean ou como a string "1"/"true", dependendo da configuração
  // da claim opcional. Aceita as duas formas; qualquer outra coisa é não verificado.
  const edov = (payload as Record<string, unknown>).xms_edov;
  const edovIsTrue = edov === true || edov === 1 || edov === '1' || edov === 'true';

  // `xms_edov` afirma que o dono do domínio verificou o endereço da claim `email` — não diz nada
  // sobre o `preferred_username`. Sem exigir `email` aqui, um usuário Entra com `mail` vazio caía
  // no UPN de `extractEmail` e ainda assim saía verificado, vinculando conta alheia.
  if (edovIsTrue && looksLikeEmail(payload.email)) return true;

  // Conta pessoal: a prova de posse é da criação da conta, não do domínio. Exige a claim `email` —
  // `preferred_username` é UPN e pode ser um alias interno que ninguém confirmou, então aceitá-lo
  // aqui devolveria o buraco que este ramo existe para fechar.
  if (isConsumerTenant(payload.tid) && looksLikeEmail(payload.email)) return true;

  // `email_verified` não é emitida pela Microsoft hoje, mas se um dia for, é sinal legítimo.
  return payload.email_verified === true;
}

function payloadToIdentity(provider: OAuthProviderName, payload: JWTPayload): OAuthIdentity {
  return {
    provider,
    subject: String(payload.sub),
    email: extractEmail(payload),
    emailVerified: isEmailVerifiedByProvider(provider, payload),
    displayName: typeof payload.name === 'string' ? payload.name : null,
    avatarUrl: typeof payload.picture === 'string' ? payload.picture : null,
    providerTenantId: typeof payload.tid === 'string' ? payload.tid : null,
  };
}

export async function verifyGoogleIdToken(idToken: string, nonce: string): Promise<OAuthIdentity> {
  const config = getGoogleOAuthConfig();
  const { payload } = await jwtVerify(idToken, googleJwks, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: config.clientId,
  });

  if (payload.nonce !== nonce) {
    throw new Error('OAUTH_NONCE_INVALID');
  }

  return payloadToIdentity('google', payload);
}

export async function verifyMicrosoftIdToken(
  idToken: string,
  nonce: string,
): Promise<OAuthIdentity> {
  const config = getMicrosoftOAuthConfig();
  const tenant = config.tenant;

  const { payload } = await jwtVerify(idToken, microsoftJwks(microsoftKeyTenant(idToken, tenant)), {
    audience: config.clientId,
  });

  assertMicrosoftIssuer(payload, tenant);

  if (payload.nonce !== nonce) {
    throw new Error('OAUTH_NONCE_INVALID');
  }

  return payloadToIdentity('microsoft', payload);
}

export async function verifyProviderIdToken(
  provider: OAuthProviderName,
  idToken: string,
  nonce: string,
): Promise<OAuthIdentity> {
  if (provider === 'google') {
    return verifyGoogleIdToken(idToken, nonce);
  }
  return verifyMicrosoftIdToken(idToken, nonce);
}

export async function exchangeProviderCode(
  provider: OAuthProviderName,
  input: { code: string; codeVerifier: string },
): Promise<TokenExchangeResponse> {
  if (provider === 'google') {
    return exchangeGoogleCode(input);
  }
  return exchangeMicrosoftCode(input);
}

export function buildProviderAuthorizeUrl(
  provider: OAuthProviderName,
  input: { state: string; nonce: string; codeChallenge: string },
): string {
  if (provider === 'google') {
    return buildGoogleAuthorizeUrl(input);
  }
  return buildMicrosoftAuthorizeUrl(input);
}

/** Exportado só para teste — a lógica de identidade é fronteira de segurança e precisa de prova. */
export const __testing__ = { payloadToIdentity, extractEmail, isEmailVerifiedByProvider };
