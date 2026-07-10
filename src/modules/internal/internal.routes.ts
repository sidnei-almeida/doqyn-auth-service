import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { loadEnv } from '../../config/env.js';
import { ForbiddenError } from '../../utils/errors.js';
import { AUTH_ERROR_MESSAGES } from '../../utils/authErrorCodes.js';
import { emailParamSchema, userIdParamSchema } from '../users/users.schemas.js';
import { membershipIdParamSchema } from '../admin/admin.schemas.js';
import {
  createInternalUserSchema,
  updateUserAvatarMetadataSchema,
  verifySessionInternalSchema,
} from './internal.schemas.js';
import {
  internalCreateUser,
  internalDisableUser,
  internalEnableUser,
  internalFindUserByEmail,
  internalGetMembership,
  internalGetTenant,
  internalGetTenantAccessGroups,
  internalGetUserAvatarMetadata,
  internalGetUserOrThrow,
  internalListTenantMembers,
  internalUpdateUserAvatarMetadata,
  internalVerifySession,
} from './internal.service.js';
import { assertDatabaseAvailable } from '../../utils/routeErrors.js';

function verifyInternalApiKey(request: FastifyRequest): void {
  const env = loadEnv();
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new ForbiddenError();
  }

  const token = authHeader.slice(7);
  if (token !== env.DOQYN_INTERNAL_API_KEY) {
    throw new ForbiddenError();
  }
}

async function internalAuthHook(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  verifyInternalApiKey(request);
}

export async function internalRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', internalAuthHook);

  app.post('/internal/users', async (request, reply) => {
    const body = createInternalUserSchema.parse(request.body);
    const user = await internalCreateUser(body);

    return reply.send({
      ok: true,
      user,
    });
  });

  app.post('/internal/users/:id/disable', async (request, reply) => {
    const params = userIdParamSchema.parse(request.params);
    const user = await internalDisableUser(params.id);

    return reply.send({
      ok: true,
      user,
    });
  });

  app.post('/internal/users/:id/enable', async (request, reply) => {
    const params = userIdParamSchema.parse(request.params);
    const user = await internalEnableUser(params.id);

    return reply.send({
      ok: true,
      user,
    });
  });

  app.get('/internal/users/by-email/:email', async (request, reply) => {
    const rawEmail = decodeURIComponent((request.params as { email: string }).email);
    const params = emailParamSchema.parse({ email: rawEmail });
    const user = await internalFindUserByEmail(params.email);

    if (!user) {
      return reply.status(404).send({
        ok: false,
        message: 'Usuário não encontrado.',
      });
    }

    return reply.send({
      ok: true,
      user,
    });
  });

  app.patch('/internal/users/:id/avatar-metadata', async (request, reply) => {
    const params = userIdParamSchema.parse(request.params);
    const body = updateUserAvatarMetadataSchema.parse(request.body);
    const user = await internalUpdateUserAvatarMetadata(params.id, body);
    return reply.send({ ok: true, user });
  });

  app.get('/internal/users/:id/avatar-metadata', async (request, reply) => {
    const params = userIdParamSchema.parse(request.params);
    const metadata = await internalGetUserAvatarMetadata(params.id);
    return reply.send({ ok: true, metadata });
  });

  app.get('/internal/users/:userId', async (request, reply) => {
    const params = userIdParamSchema.parse({ id: (request.params as { userId: string }).userId });
    const user = await internalGetUserOrThrow(params.id);
    return reply.send({ ok: true, user });
  });

  app.post('/internal/sessions/verify', async (request, reply) => {
    try {
      const body = verifySessionInternalSchema.parse(request.body);
      const result = await internalVerifySession(body.sessionToken);

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
    } catch (error) {
      assertDatabaseAvailable(error);
      throw error;
    }
  });

  app.get('/internal/tenants/:tenantId', async (request, reply) => {
    const tenantId = (request.params as { tenantId: string }).tenantId;
    const tenant = await internalGetTenant(tenantId);
    return reply.send({ ok: true, tenant });
  });

  app.get('/internal/tenants/:tenantId/access-groups', async (request, reply) => {
    const tenantId = (request.params as { tenantId: string }).tenantId;
    const groups = await internalGetTenantAccessGroups(tenantId);
    return reply.send({ ok: true, groups });
  });

  app.get('/internal/tenants/:tenantId/members', async (request, reply) => {
    const tenantId = (request.params as { tenantId: string }).tenantId;
    const members = await internalListTenantMembers(tenantId);
    return reply.send({ ok: true, members });
  });

  app.get('/internal/memberships/:membershipId', async (request, reply) => {
    const params = membershipIdParamSchema.parse(request.params);
    const membership = await internalGetMembership(params.membershipId);
    return reply.send({ ok: true, membership });
  });
}
