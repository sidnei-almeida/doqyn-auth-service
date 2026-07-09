import type { FastifyInstance } from 'fastify';
import { extractRequestContext } from '../../security/requestContext.js';
import {
  getSessionTtlSeconds,
  setSessionCookie,
} from '../../security/cookies.js';
import {
  buildOAuthFrontendRedirect,
  completeOAuthCallback,
  logOAuthStarted,
  startOAuthFlow,
} from './oauth.service.js';
import type { OAuthProviderName } from './oauth.types.js';
import {
  clearOAuthPendingCookie,
  readOAuthPendingCookie,
  setOAuthPendingCookie,
} from './oauth.pendingCookie.js';
import { isOAuthProviderEnabled } from './oauth.config.js';

function registerProviderRoutes(app: FastifyInstance, provider: OAuthProviderName): void {
  app.get(`/oauth/${provider}/start`, async (request, reply) => {
    if (!isOAuthProviderEnabled(provider)) {
      return reply.status(404).send({
        ok: false,
        code: 'OAUTH_PROVIDER_DISABLED',
        message: 'Provedor OAuth indisponível.',
      });
    }

    const ctx = extractRequestContext(request);
    const returnUrl =
      typeof request.query === 'object' &&
      request.query !== null &&
      'returnUrl' in request.query &&
      typeof request.query.returnUrl === 'string'
        ? request.query.returnUrl
        : undefined;

    const { redirectUrl, pending } = startOAuthFlow(provider, returnUrl);
    await logOAuthStarted(provider, ctx);
    setOAuthPendingCookie(reply, pending);
    return reply.redirect(redirectUrl);
  });

  app.get(`/oauth/${provider}/callback`, async (request, reply) => {
    const ctx = extractRequestContext(request);
    const pending = readOAuthPendingCookie(request);
    const query = request.query as Record<string, string | undefined>;

    const result = await completeOAuthCallback({
      provider,
      code: query.code,
      state: query.state,
      pending,
      ctx,
    });

    clearOAuthPendingCookie(reply);

    if (result.ok) {
      setSessionCookie(reply, result.sessionToken, {
        maxAgeSeconds: getSessionTtlSeconds(),
      });
    }

    const redirectUrl = buildOAuthFrontendRedirect({
      result,
      returnUrl: pending?.returnUrl,
    });

    return reply.redirect(redirectUrl);
  });
}

export async function oauthRoutes(app: FastifyInstance): Promise<void> {
  registerProviderRoutes(app, 'google');
  registerProviderRoutes(app, 'microsoft');
}
