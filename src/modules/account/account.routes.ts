import type { FastifyInstance } from 'fastify';
import { extractRequestContext } from '../../security/requestContext.js';
import { accountDeletionRequestSchema, userIdParamSchema } from '../admin/admin.schemas.js';
import {
  requireAdminActor,
  requireSession,
  type AuthenticatedRequest,
} from '../admin/adminAuth.js';
import {
  anonymizeUser,
  deactivateUser,
  requestAccountDeletion,
  revokeUserSessionsAdmin,
  updateOwnProfile,
} from './account.service.js';
import { updateDirectoryVisibilitySchema, updateOwnProfileSchema } from './account.schemas.js';
import { setUsernameDiscoverable } from '../users/users.service.js';

export async function accountRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/auth/account/request-deletion',
    { preHandler: requireSession },
    async (request, reply) => {
      const body = accountDeletionRequestSchema.parse(request.body ?? {});
      const ctx = extractRequestContext(request);
      const authUser = (request as AuthenticatedRequest).authUser!;
      const result = await requestAccountDeletion(authUser.id, body.reason, ctx);
      return reply.send(result);
    },
  );

  app.patch('/auth/account/profile', { preHandler: requireSession }, async (request, reply) => {
    const body = updateOwnProfileSchema.parse(request.body ?? {});
    const ctx = extractRequestContext(request);
    const authUser = (request as AuthenticatedRequest).authUser!;
    const user = await updateOwnProfile(authUser.id, body, ctx);
    return reply.send({ ok: true, user });
  });

  /**
   * Sair da busca entre empresas, ou voltar para ela.
   *
   * A coluna nascia `true` e não tinha desligamento: quem ganhou apelido foi inscrito num
   * diretório sem ter dito que queria. O handle continua existindo em qualquer caso — ele é a
   * identidade de quem já a encontrou antes.
   */
  app.patch(
    '/auth/account/directory-visibility',
    { preHandler: requireSession },
    async (request, reply) => {
      const body = updateDirectoryVisibilitySchema.parse(request.body ?? {});
      const authUser = (request as AuthenticatedRequest).authUser!;
      const user = await setUsernameDiscoverable(authUser.id, body.discoverable);
      return reply.send({ ok: true, user });
    },
  );

  app.post(
    '/auth/admin/users/:userId/deactivate',
    { preHandler: requireAdminActor },
    async (request, reply) => {
      const params = userIdParamSchema.parse(request.params);
      const ctx = extractRequestContext(request);
      const actor = (request as AuthenticatedRequest).adminActor!;
      const user = await deactivateUser(actor, params.userId, ctx);
      return reply.send({ ok: true, user });
    },
  );

  app.post(
    '/auth/admin/users/:userId/anonymize',
    { preHandler: requireAdminActor },
    async (request, reply) => {
      const params = userIdParamSchema.parse(request.params);
      const ctx = extractRequestContext(request);
      const actor = (request as AuthenticatedRequest).adminActor!;
      const user = await anonymizeUser(actor, params.userId, ctx);
      return reply.send({ ok: true, user });
    },
  );

  app.post(
    '/auth/admin/users/:userId/revoke-sessions',
    { preHandler: requireAdminActor },
    async (request, reply) => {
      const params = userIdParamSchema.parse(request.params);
      const ctx = extractRequestContext(request);
      const actor = (request as AuthenticatedRequest).adminActor!;
      const result = await revokeUserSessionsAdmin(actor, params.userId, ctx);
      return reply.send({ ok: true, ...result });
    },
  );
}
