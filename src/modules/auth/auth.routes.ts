import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import {
  formatTermsValidationResponse,
  mapTermsValidationError,
} from '../terms/termsAcceptance.validation.js';
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
import {
  emailChangeTokenParamSchema,
  requestEmailChangeSchema,
} from '../email-change/emailChange.schemas.js';
import {
  confirmEmailChange,
  getEmailChangeStatus,
  previewEmailChange,
  requestEmailChange,
} from '../email-change/emailChange.service.js';
import { assertEmailChangeEnabled } from '../email-change/emailChange.guard.js';
import {
  confirmEmailVerificationCodeSchema,
  emailVerificationStatusQuerySchema,
  emailVerificationTicketSchema,
  emailVerificationTokenParamSchema,
} from '../email-verification/emailVerification.schemas.js';
import {
  confirmEmailVerificationCode,
  confirmEmailVerificationToken,
  getEmailVerificationStatus,
  resolveVerificationTicket,
  sendEmailVerificationCode,
} from '../email-verification/emailVerification.service.js';
import { validateSessionByToken } from '../sessions/sessions.service.js';
import { selectTenantSchema } from '../admin/admin.schemas.js';
import { accessRequestSchema } from '../access-requests/accessRequests.schemas.js';
import { submitAccessRequest } from '../access-requests/accessRequests.service.js';
import {
  companySignupAttachSchema,
  companySignupSchema,
} from '../company-signups/companySignups.schemas.js';
import { submitCompanySignup } from '../company-signups/companySignups.service.js';
import {
  individualSignupAttachSchema,
  individualSignupSchema,
} from '../individual-signups/individualSignups.schemas.js';
import { submitIndividualSignup } from '../individual-signups/individualSignups.service.js';
import { normalizeUsername, validateUsernameShape } from '../users/username.js';
import { isUsernameAvailable } from '../users/users.service.js';
import { requireSession, type AuthenticatedRequest } from '../admin/adminAuth.js';
import { AUTH_ERROR_MESSAGES } from '../../utils/authErrorCodes.js';
import { assertDatabaseAvailable } from '../../utils/routeErrors.js';
import {
  checkAccessRequestRateLimit,
  checkSignupRateLimit,
  checkUsernameAvailabilityRateLimit,
} from '../../security/rateLimit.js';

function getSessionTokenFromRequest(request: FastifyRequest): string | undefined {
  const cookieName = getSessionCookieName();
  return request.cookies[cookieName];
}

/**
 * Usuário já autenticado no momento do cadastro, se houver.
 *
 * É o que separa os dois modos das rotas de cadastro: sem sessão, cria conta nova com senha;
 * com sessão, anexa tenant e membership à conta existente. O caso real é quem acabou de
 * entrar por OAuth — o callback já criou o usuário, então tentar criar de novo esbarraria em
 * EMAIL_ALREADY_EXISTS e o onboarding ficaria sem saída.
 */
async function resolveSignupSessionUserId(request: FastifyRequest): Promise<string | null> {
  const token = getSessionTokenFromRequest(request);
  if (!token) return null;

  const sessionResult = await validateSessionByToken(token);
  return sessionResult.valid ? sessionResult.user.id : null;
}

/**
 * Resposta de validação do cadastro.
 *
 * Antes devolvia sempre o genérico "Dados inválidos.", o que escondeu por completo o fato de
 * o frontend não estar enviando `country` e `taxIdType` — nenhum cadastro passava, e a
 * resposta não dizia por quê. Agora a mensagem do primeiro problema vai junto, e campo
 * ausente é nomeado (a mensagem do Zod nesse caso é só "Required").
 */
function signupValidationResponse(error: ZodError): { code: string; message: string } {
  const termsError = mapTermsValidationError(error);
  if (termsError) return termsError;

  const issue = error.issues[0];
  if (!issue) return { code: 'VALIDATION_ERROR', message: 'Dados inválidos.' };

  const field = issue.path.join('.');
  const message =
    issue.code === 'invalid_type' && issue.received === 'undefined'
      ? `Campo obrigatório ausente: ${field}.`
      : field
        ? `${issue.message} (campo: ${field})`
        : issue.message;

  return { code: 'VALIDATION_ERROR', message };
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
        message:
          AUTH_ERROR_MESSAGES[result.code as keyof typeof AUTH_ERROR_MESSAGES] ??
          'Sessão inválida.',
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
    await checkAccessRequestRateLimit(ctx.ipHash);

    const result = await submitAccessRequest(parsed.data, ctx.ipHash, ctx.userAgentHash);
    return reply.send(result);
  });

  app.post('/auth/company-signups', async (request, reply) => {
    const attachToUserId = await resolveSignupSessionUserId(request);
    const parsed = (attachToUserId ? companySignupAttachSchema : companySignupSchema).safeParse(
      request.body,
    );
    if (!parsed.success) {
      const validationError = signupValidationResponse(parsed.error);
      return reply.status(400).send({
        ok: false,
        message: validationError.message,
        code: validationError.code,
      });
    }
    const ctx = extractRequestContext(request);
    await checkSignupRateLimit(ctx.ipHash);

    const result = await submitCompanySignup(
      parsed.data,
      ctx.ipHash,
      ctx.userAgentHash,
      attachToUserId ? { attachToUserId } : undefined,
    );

    // Sem sessão quando o e-mail ainda não foi provado: a conta existe, mas o acesso só abre
    // depois do código. O ticket é o que a tela de confirmação usa para pedir e conferir.
    if (result.sessionToken) {
      setSessionCookie(reply, result.sessionToken, {
        maxAgeSeconds: getSessionTtlSeconds(),
      });
    }

    return reply.send({
      ok: true,
      message: result.message,
      user: result.user,
      tenant: result.tenant,
      activeMembership: result.activeMembership,
      ...(result.emailVerificationRequired
        ? {
            emailVerificationRequired: true,
            verificationTicket: result.verificationTicket,
          }
        : {}),
    });
  });

  /**
   * O apelido está livre?
   *
   * Pública porque é usada no cadastro, antes de existir sessão. Devolve também a forma inválida e
   * a reservada, porque para quem escolhe as três respostas são a mesma: "esse não dá, escolha
   * outro".
   *
   * A resposta não diz **de quem** é o handle, mas dizer quais existem já é meia lista. Por isso
   * tem teto por IP próprio: o de cadastro não vale aqui, porque só é consumido no POST, e esta
   * rota é um GET que ninguém precisa concluir para usar.
   */
  app.get('/auth/username-available', async (request, reply) => {
    const ctx = extractRequestContext(request);
    await checkUsernameAvailabilityRateLimit(ctx.ipHash);

    const raw = (request.query as { username?: string }).username ?? '';
    const username = normalizeUsername(raw);
    const problem = validateUsernameShape(username);

    if (problem) {
      return reply.send({ ok: true, username, available: false, reason: problem });
    }

    const available = await isUsernameAvailable(username);
    return reply.send({
      ok: true,
      username,
      available,
      ...(available ? {} : { reason: 'taken' as const }),
    });
  });

  app.post('/auth/individual-signups', async (request, reply) => {
    const attachToUserId = await resolveSignupSessionUserId(request);
    const parsed = (
      attachToUserId ? individualSignupAttachSchema : individualSignupSchema
    ).safeParse(request.body);
    if (!parsed.success) {
      const validationError = signupValidationResponse(parsed.error);
      return reply.status(400).send({
        ok: false,
        message: validationError.message,
        code: validationError.code,
      });
    }
    const ctx = extractRequestContext(request);
    await checkSignupRateLimit(ctx.ipHash);

    const result = await submitIndividualSignup(
      parsed.data,
      ctx.ipHash,
      ctx.userAgentHash,
      attachToUserId ? { attachToUserId } : undefined,
    );

    // Sem sessão quando o e-mail ainda não foi provado: a conta existe, mas o acesso só abre
    // depois do código. O ticket é o que a tela de confirmação usa para pedir e conferir.
    if (result.sessionToken) {
      setSessionCookie(reply, result.sessionToken, {
        maxAgeSeconds: getSessionTtlSeconds(),
      });
    }

    return reply.send({
      ok: true,
      message: result.message,
      user: result.user,
      tenant: result.tenant,
      activeMembership: result.activeMembership,
      ...(result.emailVerificationRequired
        ? {
            emailVerificationRequired: true,
            verificationTicket: result.verificationTicket,
          }
        : {}),
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

  app.get('/auth/account/email-change', async (request, reply) => {
    assertEmailChangeEnabled();
    const token = getSessionTokenFromRequest(request);
    if (!token) {
      return reply
        .status(401)
        .send({ ok: false, message: 'Não autenticado.', code: 'UNAUTHORIZED' });
    }
    const sessionResult = await validateSessionByToken(token);
    if (!sessionResult.valid) {
      return reply
        .status(401)
        .send({ ok: false, message: 'Sessão inválida.', code: 'INVALID_SESSION' });
    }
    const status = await getEmailChangeStatus(sessionResult.user.id);
    return reply.send({ ok: true, ...status });
  });

  app.post('/auth/account/email-change/request', async (request, reply) => {
    assertEmailChangeEnabled();
    const token = getSessionTokenFromRequest(request);
    if (!token) {
      return reply
        .status(401)
        .send({ ok: false, message: 'Não autenticado.', code: 'UNAUTHORIZED' });
    }
    const sessionResult = await validateSessionByToken(token);
    if (!sessionResult.valid) {
      return reply
        .status(401)
        .send({ ok: false, message: 'Sessão inválida.', code: 'INVALID_SESSION' });
    }
    const body = requestEmailChangeSchema.parse(request.body ?? {});
    const ctx = extractRequestContext(request);
    const result = await requestEmailChange(sessionResult.user.id, body, token, ctx.ipHash);
    return reply.send(result);
  });

  app.get('/auth/account/email-change/:token', async (request, reply) => {
    assertEmailChangeEnabled();
    const params = emailChangeTokenParamSchema.parse(request.params);
    const result = await previewEmailChange(params.token);
    return reply.send(result);
  });

  app.post('/auth/account/email-change/:token/confirm', async (request, reply) => {
    assertEmailChangeEnabled();
    const params = emailChangeTokenParamSchema.parse(request.params);
    const ctx = extractRequestContext(request);
    const result = await confirmEmailChange(params.token, ctx.ipHash);
    return reply.send(result);
  });

  // As rotas de verificação são públicas de propósito, e é o ticket que as fecha.
  //
  // Quem precisa confirmar o e-mail é justamente quem o login acabou de recusar: não há sessão
  // para exigir. Aceitar só o endereço deixaria qualquer um despejar e-mail em qualquer cadastro,
  // então o passe assinado — emitido depois da senha certa, ou do cadastro — é o que autoriza.
  app.get('/auth/email-verification', async (request, reply) => {
    const query = emailVerificationStatusQuerySchema.parse(request.query ?? {});
    const userId = resolveVerificationTicket(query.ticket);
    const status = await getEmailVerificationStatus(userId);
    return reply.send({ ok: true, ...status });
  });

  app.post('/auth/email-verification/send', async (request, reply) => {
    const body = emailVerificationTicketSchema.parse(request.body ?? {});
    const ctx = extractRequestContext(request);
    const result = await sendEmailVerificationCode(
      resolveVerificationTicket(body.ticket),
      ctx.ipHash,
    );
    return reply.send(result);
  });

  // Reenviar é o mesmo envio de novo — a rota existe separada só porque a tela chama as duas
  // coisas por nomes diferentes, e um "resend" que bate em "/send" confunde quem lê o log.
  app.post('/auth/email-verification/resend', async (request, reply) => {
    const body = emailVerificationTicketSchema.parse(request.body ?? {});
    const ctx = extractRequestContext(request);
    const result = await sendEmailVerificationCode(
      resolveVerificationTicket(body.ticket),
      ctx.ipHash,
    );
    return reply.send(result);
  });

  app.post('/auth/email-verification/confirm', async (request, reply) => {
    const body = confirmEmailVerificationCodeSchema.parse(request.body ?? {});
    const ctx = extractRequestContext(request);
    const result = await confirmEmailVerificationCode(
      resolveVerificationTicket(body.ticket),
      body.code,
      ctx.ipHash,
    );
    return reply.send(result);
  });

  // O caminho do link, e ele não pede nem ticket: quem clica está no aparelho onde leu o e-mail,
  // que raramente é o mesmo onde a conta foi aberta. O token de 32 bytes é o que autentica.
  //
  // Confirmar não devolve sessão em nenhum dos dois caminhos. A pessoa faz login depois, e é aí
  // que as checagens de vínculo com a empresa rodam — dar sessão aqui as contornaria.
  app.post('/auth/email-verification/:token/confirm', async (request, reply) => {
    const params = emailVerificationTokenParamSchema.parse(request.params);
    const ctx = extractRequestContext(request);
    const result = await confirmEmailVerificationToken(params.token, ctx.ipHash);
    return reply.send(result);
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
