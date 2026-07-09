import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';
import { getSessionCookieName } from '../src/security/cookies.js';
import { createOrGetUser, disableUser } from '../src/modules/users/users.service.js';
import { createTestMembership, createTestTenant } from './helpers.js';
import { TEST_ENV } from './setup.js';
import { encryptField } from '../src/security/crypto.js';
import { OAUTH_PENDING_COOKIE } from '../src/modules/oauth/oauth.pendingCookie.js';
import type { OAuthIdentity } from '../src/modules/oauth/oauth.types.js';
import * as oauthProviders from '../src/modules/oauth/oauth.providers.js';
import { sanitizeReturnUrl } from '../src/modules/oauth/oauth.returnUrl.js';
import { createCodeChallenge } from '../src/modules/oauth/oauth.pkce.js';

const mockIdentity: OAuthIdentity = {
  provider: 'google',
  subject: 'google-subject-123',
  email: 'oauth.user@empresa.com',
  emailVerified: true,
  displayName: 'OAuth User',
  avatarUrl: null,
  providerTenantId: null,
};

function buildPendingCookie(payload: Record<string, unknown>): string {
  return encryptField(JSON.stringify({ createdAt: Date.now(), ...payload }));
}

describe('oauth', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('/oauth/google/start redireciona com state, nonce e PKCE', async () => {
    const buildSpy = vi.spyOn(oauthProviders, 'buildProviderAuthorizeUrl');

    const response = await app.inject({
      method: 'GET',
      url: '/oauth/google/start?returnUrl=/upload',
    });

    expect(response.statusCode).toBe(302);
    const location = response.headers.location ?? '';
    expect(location).toContain('accounts.google.com');
    expect(buildSpy).toHaveBeenCalled();
    const args = buildSpy.mock.calls[0]?.[1];
    expect(args?.state).toBeTruthy();
    expect(args?.nonce).toBeTruthy();
    expect(args?.codeChallenge).toBeTruthy();

    const setCookie = String(response.headers['set-cookie'] ?? '');
    expect(setCookie).toContain(`${OAUTH_PENDING_COOKIE}=`);
  });

  it('/oauth/microsoft/start redireciona com state, nonce e PKCE', async () => {
    const buildSpy = vi.spyOn(oauthProviders, 'buildProviderAuthorizeUrl');

    const response = await app.inject({
      method: 'GET',
      url: '/oauth/microsoft/start?returnUrl=/dashboard',
    });

    expect(response.statusCode).toBe(302);
    expect(String(response.headers.location)).toContain('login.microsoftonline.com');
    expect(buildSpy).toHaveBeenCalled();
  });

  it('callback rejeita state inválido', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/oauth/google/callback?code=abc&state=wrong-state',
      headers: {
        cookie: `${OAUTH_PENDING_COOKIE}=${buildPendingCookie({
          provider: 'google',
          state: 'expected-state',
          nonce: 'nonce-1',
          codeVerifier: 'verifier-1',
          returnUrl: '/upload',
        })}`,
      },
    });

    expect(response.statusCode).toBe(302);
    expect(String(response.headers.location)).toContain('status=error');
    expect(String(response.headers.location)).toContain('OAUTH_STATE_INVALID');
  });

  it('callback cria AuthOAuthAccount para usuário novo', async () => {
    vi.spyOn(oauthProviders, 'exchangeProviderCode').mockResolvedValue({
      id_token: 'fake-id-token',
    });
    vi.spyOn(oauthProviders, 'verifyProviderIdToken').mockResolvedValue(mockIdentity);

    const response = await app.inject({
      method: 'GET',
      url: '/oauth/google/callback?code=valid-code&state=state-1',
      headers: {
        cookie: `${OAUTH_PENDING_COOKIE}=${buildPendingCookie({
          provider: 'google',
          state: 'state-1',
          nonce: 'nonce-1',
          codeVerifier: 'verifier-1',
          returnUrl: '/upload',
        })}`,
      },
    });

    expect(response.statusCode).toBe(302);
    expect(String(response.headers.location)).toContain('status=onboarding_required');

    const oauthAccounts = await prisma.authOAuthAccount.count();
    expect(oauthAccounts).toBe(1);

    const cookieName = getSessionCookieName();
    expect(String(response.headers['set-cookie'])).toContain(`${cookieName}=`);
  });

  it('callback vincula conta existente com e-mail verificado', async () => {
    const user = await createOrGetUser({
      email: 'oauth.user@empresa.com',
      temporaryPassword: 'senha-segura-123',
    });

    vi.spyOn(oauthProviders, 'exchangeProviderCode').mockResolvedValue({
      id_token: 'fake-id-token',
    });
    vi.spyOn(oauthProviders, 'verifyProviderIdToken').mockResolvedValue(mockIdentity);

    await app.inject({
      method: 'GET',
      url: '/oauth/google/callback?code=valid-code&state=state-link',
      headers: {
        cookie: `${OAUTH_PENDING_COOKIE}=${buildPendingCookie({
          provider: 'google',
          state: 'state-link',
          nonce: 'nonce-link',
          codeVerifier: 'verifier-link',
          returnUrl: '/upload',
        })}`,
      },
    });

    const linked = await prisma.authOAuthAccount.findFirst({ where: { userId: user.id } });
    expect(linked?.provider).toBe('google');
    expect(linked?.providerSubject).toBe('google-subject-123');
  });

  it('callback não vincula e-mail não verificado', async () => {
    await createOrGetUser({
      email: 'oauth.user@empresa.com',
      temporaryPassword: 'senha-segura-123',
    });

    vi.spyOn(oauthProviders, 'exchangeProviderCode').mockResolvedValue({
      id_token: 'fake-id-token',
    });
    vi.spyOn(oauthProviders, 'verifyProviderIdToken').mockResolvedValue({
      ...mockIdentity,
      emailVerified: false,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/oauth/google/callback?code=valid-code&state=state-unverified',
      headers: {
        cookie: `${OAUTH_PENDING_COOKIE}=${buildPendingCookie({
          provider: 'google',
          state: 'state-unverified',
          nonce: 'nonce-unverified',
          codeVerifier: 'verifier-unverified',
          returnUrl: '/upload',
        })}`,
      },
    });

    expect(String(response.headers.location)).toContain('OAUTH_EMAIL_NOT_VERIFIED');
    const oauthAccounts = await prisma.authOAuthAccount.count();
    expect(oauthAccounts).toBe(0);
  });

  it('usuário disabled não entra via OAuth', async () => {
    const user = await createOrGetUser({
      email: 'disabled.oauth@empresa.com',
      temporaryPassword: 'senha-segura-123',
    });
    await prisma.authOAuthAccount.create({
      data: {
        userId: user.id,
        provider: 'google',
        providerSubject: 'disabled-subject',
        email: 'disabled.oauth@empresa.com',
        emailVerified: true,
      },
    });
    await disableUser(user.id);

    vi.spyOn(oauthProviders, 'exchangeProviderCode').mockResolvedValue({
      id_token: 'fake-id-token',
    });
    vi.spyOn(oauthProviders, 'verifyProviderIdToken').mockResolvedValue({
      ...mockIdentity,
      subject: 'disabled-subject',
      email: 'disabled.oauth@empresa.com',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/oauth/google/callback?code=valid-code&state=state-disabled',
      headers: {
        cookie: `${OAUTH_PENDING_COOKIE}=${buildPendingCookie({
          provider: 'google',
          state: 'state-disabled',
          nonce: 'nonce-disabled',
          codeVerifier: 'verifier-disabled',
          returnUrl: '/upload',
        })}`,
      },
    });

    expect(String(response.headers.location)).toContain('USER_DISABLED');
  });

  it('usuário pending continua pending após OAuth', async () => {
    const user = await createOrGetUser({
      email: 'pending.oauth@empresa.com',
      temporaryPassword: 'senha-segura-123',
    });
    const tenant = await createTestTenant('tenant_pending_oauth');
    await createTestMembership(user.id, tenant.id, 'pending');

    vi.spyOn(oauthProviders, 'exchangeProviderCode').mockResolvedValue({
      id_token: 'fake-id-token',
    });
    vi.spyOn(oauthProviders, 'verifyProviderIdToken').mockResolvedValue({
      ...mockIdentity,
      subject: 'pending-subject',
      email: 'pending.oauth@empresa.com',
    });

    await prisma.authOAuthAccount.create({
      data: {
        userId: user.id,
        provider: 'google',
        providerSubject: 'pending-subject',
        email: 'pending.oauth@empresa.com',
        emailVerified: true,
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/oauth/google/callback?code=valid-code&state=state-pending',
      headers: {
        cookie: `${OAUTH_PENDING_COOKIE}=${buildPendingCookie({
          provider: 'google',
          state: 'state-pending',
          nonce: 'nonce-pending',
          codeVerifier: 'verifier-pending',
          returnUrl: '/upload',
        })}`,
      },
    });

    expect(String(response.headers.location)).toContain('status=membership_pending');
  });

  it('returnUrl externo é bloqueado', () => {
    expect(sanitizeReturnUrl('https://evil.com')).toBe('/upload');
    expect(sanitizeReturnUrl('/upload')).toBe('/upload');
    expect(sanitizeReturnUrl('/dashboard')).toBe('/dashboard');
  });

  it('PKCE gera code_challenge consistente', () => {
    const challenge = createCodeChallenge('test-verifier-value');
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
