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

function payloadToIdentity(
  provider: OAuthProviderName,
  payload: JWTPayload,
): OAuthIdentity {
  const email =
    typeof payload.email === 'string'
      ? payload.email
      : typeof payload.preferred_username === 'string'
        ? payload.preferred_username
        : null;

  return {
    provider,
    subject: String(payload.sub),
    email,
    emailVerified: payload.email_verified === true,
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
