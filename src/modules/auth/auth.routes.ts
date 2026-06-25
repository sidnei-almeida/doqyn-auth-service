import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../../utils/errors.js';
import {
  clearSessionCookie,
  getSessionCookieName,
  getSessionTtlSeconds,
  setSessionCookie,
} from '../../security/cookies.js';
import { extractRequestContext } from '../../security/requestContext.js';
import {
  requestPasswordResetSchema,
  resetPasswordSchema,
} from '../password-reset/passwordReset.schemas.js';
import {
  getSession,
  handlePasswordReset,
  handlePasswordResetRequest,
  login,
  logout,
  selectTenant,
} from './auth.service.js';
import { loginSchema } from './auth.schemas.js';
import { selectTenantSchema } from '../admin/admin.schemas.js';
import { accessRequestSchema } from '../access-requests/accessRequests.schemas.js';
import { submitAccessRequest } from '../access-requests/accessRequests.service.js';
import { requireSession, type AuthenticatedRequest } from '../admin/adminAuth.js';

function getSessionTokenFromRequest(request: FastifyRequest): string | undefined {
  const cookieName = getSessionCookieName();
  return request.cookies[cookieName];
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const ctx = extractRequestContext(request);

    const result = await login(body, ctx);

    if (!result.success) {
      return reply.status(401).send({
        ok: false,
        message: result.message,
      });
    }

    setSessionCookie(reply, result.sessionToken, {
      maxAgeSeconds: getSessionTtlSeconds(),
    });

    return reply.send({
      ok: true,
      user: result.user,
    });
  });

  app.post('/auth/logout', async (request, reply) => {
    const ctx = extractRequestContext(request);
    const token = getSessionTokenFromRequest(request);

    await logout(token, ctx);
    clearSessionCookie(reply);

    return reply.send({ ok: true });
  });

  app.get('/auth/session', async (request, reply) => {
    const token = getSessionTokenFromRequest(request);
    const result = await getSession(token);

    if (!result.ok) {
      return reply.send({
        ok: false,
        code: result.code,
      });
    }

    return reply.send({
      ok: true,
      user: result.user,
      activeMembership: result.activeMembership,
      memberships: result.memberships,
    });
  });

  app.post('/auth/select-tenant', { preHandler: requireSession }, async (request, reply) => {
    const body = selectTenantSchema.parse(request.body);
    const token = getSessionTokenFromRequest(request);
    const authUser = (request as AuthenticatedRequest).authUser!;

    const result = await selectTenant(token!, authUser.id, body.tenantId, body.membershipId);

    if (!result.ok) {
      return reply.status(400).send({ ok: false, message: result.message });
    }

    return reply.send({
      ok: true,
      user: result.context.user,
      activeMembership: result.context.activeMembership,
      memberships: result.context.memberships,
    });
  });

  app.post('/auth/access-requests', async (request, reply) => {
    const body = accessRequestSchema.parse(request.body);
    const ctx = extractRequestContext(request);

    const result = await submitAccessRequest(body, ctx.ipHash, ctx.userAgentHash);
    return reply.send(result);
  });

  app.post('/auth/request-password-reset', async (request, reply) => {
    const body = requestPasswordResetSchema.parse(request.body);
    const ctx = extractRequestContext(request);

    const result = await handlePasswordResetRequest(body.email, ctx);

    const response: Record<string, unknown> = {
      ok: true,
      message: result.message,
    };

    if (result.resetToken) {
      response.resetToken = result.resetToken;
    }

    return reply.send(response);
  });

  app.post('/auth/reset-password', async (request, reply) => {
    const body = resetPasswordSchema.parse(request.body);
    const ctx = extractRequestContext(request);

    const result = await handlePasswordReset(body.token, body.newPassword, ctx);

    if (!result.ok) {
      return reply.status(400).send({
        ok: false,
        message: result.message,
      });
    }

    return reply.send({ ok: true });
  });
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        ok: false,
        message: error.message,
        code: error.code,
      });
    }

    if (error && typeof error === 'object' && 'issues' in error) {
      return reply.status(400).send({
        ok: false,
        message: 'Dados inválidos.',
      });
    }

    console.error('Unhandled error:', error);
    return reply.status(500).send({
      ok: false,
      message: 'Erro interno do servidor.',
    });
  });
}
