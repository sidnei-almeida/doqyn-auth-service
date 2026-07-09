import { loadEnv } from '../../config/env.js';
import type { RequestContext } from '../../security/requestContext.js';
import { createSession } from '../sessions/sessions.service.js';
import { prisma } from '../../db/prisma.js';
import { hashSessionToken } from '../../security/crypto.js';
import { logAuthAudit } from '../audit/authAudit.service.js';
import { listUserMemberships } from '../memberships/memberships.service.js';
import {
  createCodeChallenge,
  generateCodeVerifier,
  generateOAuthNonce,
  generateOAuthState,
} from './oauth.pkce.js';
import { sanitizeReturnUrl } from './oauth.returnUrl.js';
import type { OAuthProviderName, OAuthStartResult, OAuthCallbackResult } from './oauth.types.js';
import {
  buildProviderAuthorizeUrl,
  exchangeProviderCode,
  verifyProviderIdToken,
} from './oauth.providers.js';
import { isOAuthProviderEnabled, redactEmail } from './oauth.config.js';
import { resolveOAuthUser } from './oauth.accounts.service.js';
import type { OAuthPendingPayload } from './oauth.pendingCookie.js';
import { checkOAuthRateLimit } from '../../security/rateLimit.js';

export function startOAuthFlow(
  provider: OAuthProviderName,
  returnUrlInput: string | undefined,
): OAuthStartResult {
  if (!isOAuthProviderEnabled(provider)) {
    throw new Error('OAUTH_PROVIDER_DISABLED');
  }

  const state = generateOAuthState();
  const nonce = generateOAuthNonce();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = createCodeChallenge(codeVerifier);
  const returnUrl = sanitizeReturnUrl(returnUrlInput);

  const redirectUrl = buildProviderAuthorizeUrl(provider, {
    state,
    nonce,
    codeChallenge,
  });

  const pending: OAuthPendingPayload = {
    provider,
    state,
    nonce,
    codeVerifier,
    returnUrl,
    createdAt: Date.now(),
  };

  return { redirectUrl, pending };
}

export async function completeOAuthCallback(input: {
  provider: OAuthProviderName;
  code: string | undefined;
  state: string | undefined;
  pending: OAuthPendingPayload | null;
  ctx: RequestContext;
}): Promise<OAuthCallbackResult> {
  try {
    checkOAuthRateLimit(input.ctx.ipHash);
  } catch {
    return {
      ok: false,
      status: 'error',
      code: 'RATE_LIMIT',
      message: 'Muitas tentativas. Tente novamente mais tarde.',
    };
  }

  if (!input.pending || input.pending.provider !== input.provider) {
    await logAuthAudit('auth.oauth_failed', {
      ipHash: input.ctx.ipHash,
      userAgentHash: input.ctx.userAgentHash,
      metadata: { provider: input.provider, reason: 'missing_pending_cookie' },
    });
    return {
      ok: false,
      status: 'error',
      code: 'OAUTH_STATE_INVALID',
      message: 'Sessão OAuth expirada. Tente novamente.',
    };
  }

  if (!input.code || !input.state || input.state !== input.pending.state) {
    await logAuthAudit('auth.oauth_failed', {
      ipHash: input.ctx.ipHash,
      userAgentHash: input.ctx.userAgentHash,
      metadata: { provider: input.provider, reason: 'invalid_state' },
    });
    return {
      ok: false,
      status: 'error',
      code: 'OAUTH_STATE_INVALID',
      message: 'Não foi possível validar o retorno do provedor.',
    };
  }

  try {
    const tokenResponse = await exchangeProviderCode(input.provider, {
      code: input.code,
      codeVerifier: input.pending.codeVerifier,
    });

    if (!tokenResponse.id_token) {
      throw new Error('OAUTH_MISSING_ID_TOKEN');
    }

    const identity = await verifyProviderIdToken(
      input.provider,
      tokenResponse.id_token,
      input.pending.nonce,
    );

    const resolved = await resolveOAuthUser(identity);

    if (resolved.postLoginStatus === 'membership_blocked') {
      await logAuthAudit('auth.oauth_login_blocked', {
        userId: resolved.user.id,
        ipHash: input.ctx.ipHash,
        userAgentHash: input.ctx.userAgentHash,
        metadata: { provider: input.provider, reason: 'membership_blocked' },
      });
      return {
        ok: false,
        status: 'error',
        code: 'MEMBERSHIP_BLOCKED',
        message: 'Seu acesso a esta empresa foi bloqueado.',
      };
    }

    if (resolved.postLoginStatus === 'membership_rejected') {
      await logAuthAudit('auth.oauth_login_blocked', {
        userId: resolved.user.id,
        ipHash: input.ctx.ipHash,
        userAgentHash: input.ctx.userAgentHash,
        metadata: { provider: input.provider, reason: 'membership_rejected' },
      });
      return {
        ok: false,
        status: 'error',
        code: 'MEMBERSHIP_REJECTED',
        message: 'Sua solicitação de acesso a esta empresa foi rejeitada.',
      };
    }

    const session = await createSession(resolved.user.id, input.ctx.ipHash, input.ctx.userAgentHash);

    await prisma.authUser.update({
      where: { id: resolved.user.id },
      data: { lastLoginAt: new Date() },
    });

    const memberships = await listUserMemberships(resolved.user.id);
    const activeMemberships = memberships.filter(
      (membership) => membership.status === 'active' && membership.tenant.status === 'active',
    );

    if (activeMemberships.length === 1) {
      await prisma.authSession.update({
        where: { sessionTokenHash: hashSessionToken(session.token) },
        data: { activeMembershipId: activeMemberships[0].id },
      });
    }

    if (resolved.postLoginStatus === 'onboarding_required') {
      await logAuthAudit('auth.oauth_onboarding_required', {
        userId: resolved.user.id,
        ipHash: input.ctx.ipHash,
        userAgentHash: input.ctx.userAgentHash,
        metadata: {
          provider: input.provider,
          email: redactEmail(identity.email),
          created: resolved.created,
          linked: resolved.linked,
        },
      });
    } else {
      await logAuthAudit('auth.oauth_login_success', {
        userId: resolved.user.id,
        ipHash: input.ctx.ipHash,
        userAgentHash: input.ctx.userAgentHash,
        metadata: {
          provider: input.provider,
          email: redactEmail(identity.email),
        },
      });
    }

    await logAuthAudit('auth.oauth_completed', {
      userId: resolved.user.id,
      ipHash: input.ctx.ipHash,
      userAgentHash: input.ctx.userAgentHash,
      metadata: {
        provider: input.provider,
        status: resolved.postLoginStatus,
      },
    });

    return {
      ok: true,
      sessionToken: session.token,
      status: resolved.postLoginStatus,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown';
    await logAuthAudit('auth.oauth_failed', {
      ipHash: input.ctx.ipHash,
      userAgentHash: input.ctx.userAgentHash,
      metadata: { provider: input.provider, reason },
    });

    if (reason === 'USER_DISABLED') {
      return {
        ok: false,
        status: 'error',
        code: 'USER_DISABLED',
        message: 'Esta conta foi desativada. Entre em contato com o administrador.',
      };
    }

    if (reason === 'OAUTH_EMAIL_NOT_VERIFIED') {
      return {
        ok: false,
        status: 'error',
        code: 'OAUTH_EMAIL_NOT_VERIFIED',
        message: 'Não foi possível vincular a conta porque o e-mail do provedor não está verificado.',
      };
    }

    return {
      ok: false,
      status: 'error',
      code: 'OAUTH_CALLBACK_FAILED',
      message: 'Não foi possível concluir o login social. Tente novamente.',
    };
  }
}

export function buildOAuthFrontendRedirect(input: {
  result: OAuthCallbackResult;
  returnUrl?: string;
}): string {
  const env = loadEnv();
  const base = input.result.ok
    ? env.OAUTH_POST_LOGIN_REDIRECT_URL
    : env.OAUTH_ERROR_REDIRECT_URL;

  const url = new URL(base);

  if (input.result.ok) {
    url.searchParams.set('status', input.result.status);
    if (input.returnUrl) {
      url.searchParams.set('returnUrl', input.returnUrl);
    }
  } else {
    url.searchParams.set('status', 'error');
    url.searchParams.set('code', input.result.code);
    url.searchParams.set('message', input.result.message);
  }

  return url.toString();
}

export async function logOAuthStarted(
  provider: OAuthProviderName,
  ctx: RequestContext,
): Promise<void> {
  await logAuthAudit('auth.oauth_started', {
    ipHash: ctx.ipHash,
    userAgentHash: ctx.userAgentHash,
    metadata: { provider },
  });
}
