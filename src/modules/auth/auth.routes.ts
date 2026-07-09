import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { formatTermsValidationResponse } from '../terms/termsAcceptance.validation.js';
import {
  AUTH_DATABASE_UNAVAILABLE_CODE,
  AUTH_DATABASE_UNAVAILABLE_MESSAGE,
  isPrismaConnectionError,
} from '../../db/databaseHealth.js';
import { AppError } from '../../utils/errors.js';
import { DatabaseUnavailableError } from '../../db/databaseHealth.js';
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
  handleChangePassword,
  handlePasswordReset,
  handlePasswordResetRequest,
  login,
  logout,
  selectTenant,
} from './auth.service.js';
import { loginSchema } from './auth.schemas.js';
import { changePasswordSchema } from '../change-password/changePassword.schemas.js';
import { validateSessionByToken } from '../sessions/sessions.service.js';
import { selectTenantSchema } from '../admin/admin.schemas.js';
import { accessRequestSchema } from '../access-requests/accessRequests.schemas.js';
import { submitAccessRequest } from '../access-requests/accessRequests.service.js';
import { companySignupSchema } from '../company-signups/companySignups.schemas.js';
import { submitCompanySignup } from '../company-signups/companySignups.service.js';
import { individualSignupSchema } from '../individual-signups/individualSignups.schemas.js';
import { submitIndividualSignup } from '../individual-signups/individualSignups.service.js';
import { requireSession, type AuthenticatedRequest } from '../admin/adminAuth.js';
import { AUTH_ERROR_MESSAGES } from '../../utils/authErrorCodes.js';
import { assertDatabaseAvailable } from '../../utils/routeErrors.js';

function getSessionTokenFromRequest(request: FastifyRequest): string | undefined {
  const cookieName = getSessionCookieName();
  return request.cookies[cookieName];
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/login', async (request, reply) => {
    try {
      const body = loginSchema.parse(request.body);
      const ctx = extractRequestContext(request);

      const result = await login(body, ctx);

      if (!result.success) {
        return reply.status(result.statusCode).send({
          ok: false,
          code: result.code,
          message: result.message,
          ...(result.details ? { details: result.details } : {}),
        });
      }

      setSessionCookie(reply, result.sessionToken, {
        maxAgeSeconds: getSessionTtlSeconds(),
      });

      return reply.send({
        ok: true,
        user: result.user,
      });
    } catch (error) {
      assertDatabaseAvailable(error);
      throw error;
    }
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
        message: AUTH_ERROR_MESSAGES[result.code as keyof typeof AUTH_ERROR_MESSAGES] ?? 'Sessão inválida.',
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
      return reply.status(result.statusCode).send({
        ok: false,
        code: result.code,
        message: result.message,
      });
    }

    return reply.send({
      ok: true,
      user: result.context.user,
      activeMembership: result.context.activeMembership,
      memberships: result.context.memberships,
    });
  });

  app.post('/auth/access-requests', async (request, reply) => {
    const parsed = accessRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      const termsError = formatTermsValidationResponse(parsed.error);
      return reply.status(400).send({
        ok: false,
        message: termsError.message,
        code: termsError.code,
      });
    }
    const ctx = extractRequestContext(request);

    const result = await submitAccessRequest(parsed.data, ctx.ipHash, ctx.userAgentHash);
    return reply.send(result);
  });

  app.post('/auth/company-signups', async (request, reply) => {
    const parsed = companySignupSchema.safeParse(request.body);
    if (!parsed.success) {
      const termsError = formatTermsValidationResponse(parsed.error);
      return reply.status(400).send({
        ok: false,
        message: termsError.message,
        code: termsError.code,
      });
    }
    const ctx = extractRequestContext(request);

    const result = await submitCompanySignup(parsed.data, ctx.ipHash, ctx.userAgentHash);

    setSessionCookie(reply, result.sessionToken, {
      maxAgeSeconds: getSessionTtlSeconds(),
    });

    return reply.send({
      ok: true,
      message: result.message,
      user: result.user,
      tenant: result.tenant,
      activeMembership: result.activeMembership,
    });
  });

  app.post('/auth/individual-signups', async (request, reply) => {
    const parsed = individualSignupSchema.safeParse(request.body);
    if (!parsed.success) {
      const termsError = formatTermsValidationResponse(parsed.error);
      return reply.status(400).send({
        ok: false,
        message: termsError.message,
        code: termsError.code,
      });
    }
    const ctx = extractRequestContext(request);

    const result = await submitIndividualSignup(parsed.data, ctx.ipHash, ctx.userAgentHash);

    setSessionCookie(reply, result.sessionToken, {
      maxAgeSeconds: getSessionTtlSeconds(),
    });

    return reply.send({
      ok: true,
      message: result.message,
      user: result.user,
      tenant: result.tenant,
      activeMembership: result.activeMembership,
    });
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

  app.post('/auth/change-password', async (request, reply) => {
    const token = getSessionTokenFromRequest(request);
    if (!token) {
      return reply.status(401).send({
        ok: false,
        message: 'Não autenticado.',
        code: 'UNAUTHORIZED',
      });
    }

    const sessionResult = await validateSessionByToken(token);
    if (!sessionResult.valid) {
      return reply.status(401).send({
        ok: false,
        message: 'Sessão inválida.',
        code: 'INVALID_SESSION',
      });
    }

    const parsed = changePasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        message: 'Dados inválidos.',
        code: 'VALIDATION_ERROR',
      });
    }

    const ctx = extractRequestContext(request);
    const result = await handleChangePassword(sessionResult.user.id, parsed.data, token, ctx);

    if (!result.ok) {
      return reply.status(400).send({
        ok: false,
        message: result.message,
        code: result.code,
      });
    }

    return reply.send({
      ok: true,
      message: result.message,
      revokedOtherSessions: result.revokedOtherSessions,
    });
  });
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, _request, reply) => {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'FST_ERR_CTP_EMPTY_JSON_BODY'
    ) {
      return reply.status(400).send({
        ok: false,
        message:
          'Corpo JSON ausente. Envie {} ou omita o header Content-Type: application/json em requisições sem corpo.',
        code: 'EMPTY_JSON_BODY',
      });
    }

    if (error instanceof AppError || error instanceof DatabaseUnavailableError) {
      return reply.status(error.statusCode).send({
        ok: false,
        message: error.message,
        code: error.code,
      });
    }

    if (error instanceof ZodError || (error && typeof error === 'object' && 'issues' in error)) {
      return reply.status(400).send({
        ok: false,
        message: 'Dados inválidos.',
        code: 'VALIDATION_ERROR',
      });
    }

    if (isPrismaConnectionError(error)) {
      return reply.status(503).send({
        ok: false,
        message: AUTH_DATABASE_UNAVAILABLE_MESSAGE,
        code: AUTH_DATABASE_UNAVAILABLE_CODE,
      });
    }

    console.error('Unhandled error:', error);
    return reply.status(500).send({
      ok: false,
      message: 'Erro interno do servidor.',
    });
  });
}
