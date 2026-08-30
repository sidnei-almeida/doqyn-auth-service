import { timingSafeEqual } from 'node:crypto';
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
  internalListTenantAccessRequests,
  internalListTenantMembers,
  internalLookupUserByEmail,
  internalListUsernames,
  internalSearchUsersByUsername,
  internalUpdateUserAvatarMetadata,
  internalVerifySession,
} from './internal.service.js';
import { assertDatabaseAvailable } from '../../utils/routeErrors.js';

/** Comparação em tempo constante para evitar timing attacks na chave interna. */
function safeTokenEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function verifyInternalApiKey(request: FastifyRequest): void {
  const env = loadEnv();
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new ForbiddenError();
  }

  const token = authHeader.slice(7);
  if (!safeTokenEquals(token, env.DOQYN_INTERNAL_API_KEY)) {
    throw new ForbiddenError();
  }
}

async function internalAuthHook(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
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

  /**
   * O diretório DOQYN: existe alguém com este e-mail?
   *
   * Não colide com `/internal/users/:userId`: o roteador do Fastify dá precedência à rota estática
   * sobre a paramétrica, independente da ordem de registro.
   *
   * Nunca responde 404: encontrado e não encontrado têm a mesma forma, e só o campo `found` os
   * separa. O 404 diria "esse e-mail não é usuário" com o status HTTP, que é justamente o que a
   * resposta uniforme existe para não dizer de graça.
   */
  /**
   * A busca navegável: prefixo de handle.
   *
   * Mínimo de dois caracteres, e teto de resultados. Um prefixo de uma letra devolveria um pedaço
   * grande do diretório a cada tecla — e enumerar o cadastro inteiro em 26 chamadas é o mesmo
   * oráculo que a resposta uniforme do lookup existe para evitar.
   *
   * O teto por quem consulta não mora aqui: esta rota é chamada com a chave interna do Alpha, que
   * é quem conhece a sessão.
   */
  app.get('/internal/users/search', async (request, reply) => {
    const query = request.query as { q?: string; limit?: string };
    const prefix = (query.q ?? '').trim();

    if (prefix.length < 2) {
      return reply.send({ ok: true, users: [] });
    }

    const limit = Number.parseInt(query.limit ?? '8', 10);
    const users = await internalSearchUsersByUsername(prefix, Number.isFinite(limit) ? limit : 8);

    return reply.send({ ok: true, users });
  });

  /**
   * Apelidos por lote, para o app rotular quem já está na tela dele.
   *
   * `POST` porque a lista de ids não cabe com folga numa query string, e não porque escreve algo
   * — a rota é leitura pura, protegida pela chave interna como todo o resto deste módulo.
   */
  app.post('/internal/users/usernames', async (request, reply) => {
    const body = request.body as { userIds?: unknown };
    const ids = Array.isArray(body?.userIds)
      ? body.userIds.filter((id): id is string => typeof id === 'string')
      : [];

    const users = await internalListUsernames(ids);
    return reply.send({ ok: true, users });
  });

  app.get('/internal/users/lookup', async (request, reply) => {
    const query = request.query as { email?: string };
    const parsed = emailParamSchema.safeParse({ email: query.email?.trim() ?? '' });

    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        message: 'E-mail inválido.',
      });
    }

    const user = await internalLookupUserByEmail(parsed.data.email);

    return reply.send({
      ok: true,
      found: Boolean(user),
      user: user ?? null,
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

  app.get('/internal/tenants/:tenantId/access-requests', async (request, reply) => {
    const tenantId = (request.params as { tenantId: string }).tenantId;
    const status = (request.query as { status?: string }).status;
    const requests = await internalListTenantAccessRequests(tenantId, status);
    return reply.send({ ok: true, requests });
  });

  app.get('/internal/memberships/:membershipId', async (request, reply) => {
    const params = membershipIdParamSchema.parse(request.params);
    const membership = await internalGetMembership(params.membershipId);
    return reply.send({ ok: true, membership });
  });
}
