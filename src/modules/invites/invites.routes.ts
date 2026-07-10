import type { FastifyInstance } from 'fastify';
import { extractRequestContext } from '../../security/requestContext.js';
import { getSessionTtlSeconds, setSessionCookie } from '../../security/cookies.js';
import { type AuthenticatedRequest, requireAdminActor } from '../admin/adminAuth.js';
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
  revokeInvite,
} from './invites.service.js';

export async function inviteRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/invites', { preHandler: requireAdminActor }, async (request, reply) => {
    const body = createInviteSchema.parse(request.body ?? {});
    const ctx = extractRequestContext(request);
    const actor = (request as AuthenticatedRequest).adminActor!;
    const result = await createInvite(actor, body, ctx.ipHash);
    return reply.status(201).send(result);
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
    const result = await acceptInvite(params.token, body, ctx.ipHash, ctx.userAgentHash);

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
