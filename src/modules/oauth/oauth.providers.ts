import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
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

function microsoftJwks(tenant: string) {
  return createRemoteJWKSet(
    new URL(`https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`),
  );
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
 */
function isEmailVerifiedByProvider(
  provider: OAuthProviderName,
  payload: JWTPayload,
): boolean {
  if (provider === 'google') {
    return payload.email_verified === true;
  }

  // Microsoft: `xms_edov` vem como boolean ou como a string "1"/"true", dependendo da configuração
  // da claim opcional. Aceita as duas formas; qualquer outra coisa é não verificado.
  const edov = (payload as Record<string, unknown>).xms_edov;
  if (edov === true || edov === 1 || edov === '1' || edov === 'true') return true;

  // `email_verified` não é emitida pela Microsoft hoje, mas se um dia for, é sinal legítimo.
  return payload.email_verified === true;
}

function payloadToIdentity(
  provider: OAuthProviderName,
  payload: JWTPayload,
): OAuthIdentity {
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

export async function verifyGoogleIdToken(
  idToken: string,
  nonce: string,
): Promise<OAuthIdentity> {
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
  const issuer = `https://login.microsoftonline.com/${tenant}/v2.0`;

  const { payload } = await jwtVerify(idToken, microsoftJwks(tenant), {
    issuer,
    audience: config.clientId,
  });

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
