import type { FastifyInstance, FastifyRequest } from 'fastify';
import { extractRequestContext } from '../../security/requestContext.js';
import {
  getSessionCookieName,
  getSessionTtlSeconds,
  setSessionCookie,
} from '../../security/cookies.js';
import { type AuthenticatedRequest, requireAdminActor } from '../admin/adminAuth.js';
import { validateSessionByToken } from '../sessions/sessions.service.js';
import {
  acceptInviteSchema,
  createInviteSchema,
  inviteIdParamSchema,
  inviteTokenParamSchema,
} from './invites.schemas.js';
import {
  acceptInvite,
  createInvite,
  getInviteByToken,
  listPendingInvites,
  revokeInvite,
  type InviteAcceptSession,
} from './invites.service.js';

/** Sessão válida do navegador, se houver. Conta que já existe só aceita convite logada nela. */
async function resolveCurrentSession(
  request: FastifyRequest,
): Promise<InviteAcceptSession | undefined> {
  const token = request.cookies[getSessionCookieName()];
  if (!token) return undefined;
  const session = await validateSessionByToken(token);
  return session.valid ? { userId: session.user.id, token } : undefined;
}

export async function inviteRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/invites', { preHandler: requireAdminActor }, async (request, reply) => {
    const body = createInviteSchema.parse(request.body ?? {});
    const ctx = extractRequestContext(request);
    const actor = (request as AuthenticatedRequest).adminActor!;
    const result = await createInvite(actor, body, ctx.ipHash);
    return reply.status(201).send(result);
  });

  app.get('/auth/invites', { preHandler: requireAdminActor }, async (request, reply) => {
    const query = (request.query ?? {}) as { tenantId?: string };
    const actor = (request as AuthenticatedRequest).adminActor!;
    const invites = await listPendingInvites(actor, query.tenantId);
    return reply.send({ ok: true, invites });
  });

  app.get('/auth/invites/:token', async (request, reply) => {
    const params = inviteTokenParamSchema.parse(request.params);
    const result = await getInviteByToken(params.token);
    return reply.send(result);
  });

  app.post('/auth/invites/:token/accept', async (request, reply) => {
    const params = inviteTokenParamSchema.parse(request.params);
    const body = acceptInviteSchema.parse(request.body ?? {});
    const ctx = extractRequestContext(request);
    const currentSession = await resolveCurrentSession(request);
    const result = await acceptInvite(
      params.token,
      body,
      ctx.ipHash,
      ctx.userAgentHash,
      currentSession,
    );

    if (result.sessionToken) {
      setSessionCookie(reply, result.sessionToken, {
        maxAgeSeconds: getSessionTtlSeconds(),
      });
    }

    return reply.send(result);
  });

  app.post(
    '/auth/invites/:inviteId/revoke',
    { preHandler: requireAdminActor },
    async (request, reply) => {
      const params = inviteIdParamSchema.parse(request.params);
      const ctx = extractRequestContext(request);
      const actor = (request as AuthenticatedRequest).adminActor!;
      const result = await revokeInvite(actor, params.inviteId, ctx.ipHash);
      return reply.send(result);
    },
  );
}
