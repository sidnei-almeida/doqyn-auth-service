import type { FastifyInstance } from 'fastify';
import {
  createAccessGroupSchema,
  groupIdParamSchema,
  updateAccessGroupSchema,
} from '../access-groups/accessGroups.schemas.js';
import { extractRequestContext } from '../../security/requestContext.js';
import {
  adminAddGroupMember,
  adminCreateGroup,
  adminDeleteGroup,
  adminListGroupMembers,
  adminListGroups,
  adminRemoveGroupMember,
  adminUpdateGroup,
  approveMembership,
  blockMembership,
  blockTenant,
  createTenantAdmin,
  getMemberDetail,
  getTenant,
  listAccessRequestsForAdmin,
  listMembers,
  listTenants,
  rejectMembership,
  removeMember,
  revokeMemberSessions,
  transferAdmin,
  unblockMembership,
  unblockTenant,
  updateMemberAccessGroups,
  updateMemberRoles,
  updateTenantAdmin,
} from './admin.service.js';
import {
  adminAccessRequestsQuerySchema,
  adminGroupsQuerySchema,
  adminListQuerySchema,
  adminTenantsQuerySchema,
  approveMembershipSchema,
  blockMembershipSchema,
  createTenantAdminSchema,
  membershipIdParamSchema,
  rejectMembershipSchema,
  tenantIdParamSchema,
  transferAdminSchema,
  updateMemberAccessGroupsSchema,
  updateMemberRolesSchema,
  updateTenantAdminSchema,
} from './admin.schemas.js';
import { type AuthenticatedRequest, requireAdminActor } from './adminAuth.js';

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAdminActor);

  // --- Members ---
  app.get('/auth/admin/members', async (request, reply) => {
    const query = adminListQuerySchema.parse(request.query);
    const actor = (request as AuthenticatedRequest).adminActor!;
    const result = await listMembers(actor, query);
    return reply.send({ ok: true, ...result });
  });

  app.get('/auth/admin/members/:membershipId', async (request, reply) => {
    const params = membershipIdParamSchema.parse(request.params);
    const actor = (request as AuthenticatedRequest).adminActor!;
    const member = await getMemberDetail(actor, params.membershipId);
    return reply.send({ ok: true, member });
  });

  app.patch('/auth/admin/members/:membershipId/roles', async (request, reply) => {
    const params = membershipIdParamSchema.parse(request.params);
    const body = updateMemberRolesSchema.parse(request.body);
    const ctx = extractRequestContext(request);
    const actor = (request as AuthenticatedRequest).adminActor!;
    const membership = await updateMemberRoles(actor, params.membershipId, body.roles, ctx);
    return reply.send({ ok: true, membership });
  });

  app.patch('/auth/admin/members/:membershipId/access-groups', async (request, reply) => {
    const params = membershipIdParamSchema.parse(request.params);
    const body = updateMemberAccessGroupsSchema.parse(request.body);
    const ctx = extractRequestContext(request);
    const actor = (request as AuthenticatedRequest).adminActor!;
    const membership = await updateMemberAccessGroups(
      actor,
      params.membershipId,
      body.accessGroupIds,
      ctx,
    );
    return reply.send({ ok: true, membership });
  });

  app.post('/auth/admin/members/:membershipId/approve', async (request, reply) => {
    const params = membershipIdParamSchema.parse(request.params);
    const body = approveMembershipSchema.parse(request.body);
    const ctx = extractRequestContext(request);
    const actor = (request as AuthenticatedRequest).adminActor!;
    const membership = await approveMembership(
      actor,
      params.membershipId,
      body,
      ctx.ipHash,
      ctx.userAgentHash,
    );
    return reply.send({ ok: true, membership });
  });

  app.post('/auth/admin/members/:membershipId/reject', async (request, reply) => {
    const params = membershipIdParamSchema.parse(request.params);
    const body = rejectMembershipSchema.parse(request.body ?? {});
    const ctx = extractRequestContext(request);
    const actor = (request as AuthenticatedRequest).adminActor!;
    const membership = await rejectMembership(
      actor,
      params.membershipId,
      body,
      ctx.ipHash,
      ctx.userAgentHash,
    );
    return reply.send({ ok: true, membership });
  });

  app.post('/auth/admin/members/:membershipId/block', async (request, reply) => {
    const params = membershipIdParamSchema.parse(request.params);
    const body = blockMembershipSchema.parse(request.body ?? {});
    const ctx = extractRequestContext(request);
    const actor = (request as AuthenticatedRequest).adminActor!;
    const membership = await blockMembership(
      actor,
      params.membershipId,
      body,
      ctx.ipHash,
      ctx.userAgentHash,
    );
    return reply.send({ ok: true, membership });
  });

  app.post('/auth/admin/members/:membershipId/unblock', async (request, reply) => {
    const params = membershipIdParamSchema.parse(request.params);
    const ctx = extractRequestContext(request);
    const actor = (request as AuthenticatedRequest).adminActor!;
    const membership = await unblockMembership(
      actor,
      params.membershipId,
      ctx.ipHash,
      ctx.userAgentHash,
    );
    return reply.send({ ok: true, membership });
  });

  app.post('/auth/admin/members/:membershipId/remove', async (request, reply) => {
    const params = membershipIdParamSchema.parse(request.params);
    const ctx = extractRequestContext(request);
    const actor = (request as AuthenticatedRequest).adminActor!;
    const membership = await removeMember(actor, params.membershipId, ctx);
    return reply.send({ ok: true, membership });
  });

  app.post('/auth/admin/members/:membershipId/revoke-sessions', async (request, reply) => {
    const params = membershipIdParamSchema.parse(request.params);
    const ctx = extractRequestContext(request);
    const actor = (request as AuthenticatedRequest).adminActor!;
    const result = await revokeMemberSessions(actor, params.membershipId, ctx);
    return reply.send({ ok: true, ...result });
  });

  app.get('/auth/admin/access-requests', async (request, reply) => {
    const query = adminAccessRequestsQuerySchema.parse(request.query);
    const actor = (request as AuthenticatedRequest).adminActor!;
    const requests = await listAccessRequestsForAdmin(actor, query.tenantId, query.status);
    return reply.send({ ok: true, requests });
  });

  // --- Access groups ---
  app.get('/auth/admin/access-groups', async (request, reply) => {
    const query = adminGroupsQuerySchema.parse(request.query);
    const actor = (request as AuthenticatedRequest).adminActor!;
    const groups = await adminListGroups(actor, query.tenantId, {
      status: query.status,
      search: query.search,
    });
    return reply.send({ ok: true, groups });
  });

  app.post('/auth/admin/access-groups', async (request, reply) => {
    const body = createAccessGroupSchema.parse(request.body);
    const query = adminGroupsQuerySchema.parse(request.query);
    const ctx = extractRequestContext(request);
    const actor = (request as AuthenticatedRequest).adminActor!;
    const group = await adminCreateGroup(actor, body, query.tenantId, ctx);
    return reply.send({ ok: true, group });
  });

  app.patch('/auth/admin/access-groups/:groupId', async (request, reply) => {
    const params = groupIdParamSchema.parse(request.params);
    const body = updateAccessGroupSchema.parse(request.body);
    const query = adminGroupsQuerySchema.parse(request.query);
    const ctx = extractRequestContext(request);
    const actor = (request as AuthenticatedRequest).adminActor!;
    const group = await adminUpdateGroup(actor, params.groupId, body, query.tenantId, ctx);
    return reply.send({ ok: true, group });
  });

  app.delete('/auth/admin/access-groups/:groupId', async (request, reply) => {
    const params = groupIdParamSchema.parse(request.params);
    const query = adminGroupsQuerySchema.parse(request.query);
    const ctx = extractRequestContext(request);
    const actor = (request as AuthenticatedRequest).adminActor!;
    const group = await adminDeleteGroup(actor, params.groupId, query.tenantId, ctx);
    return reply.send({ ok: true, group });
  });

  app.get('/auth/admin/access-groups/:groupId/members', async (request, reply) => {
    const params = groupIdParamSchema.parse(request.params);
    const query = adminGroupsQuerySchema.parse(request.query);
    const actor = (request as AuthenticatedRequest).adminActor!;
    const members = await adminListGroupMembers(actor, params.groupId, query.tenantId);
    return reply.send({ ok: true, members });
  });

  app.post('/auth/admin/access-groups/:groupId/members/:membershipId', async (request, reply) => {
    const groupParams = groupIdParamSchema.parse(request.params);
    const memberParams = membershipIdParamSchema.parse(request.params);
    const query = adminGroupsQuerySchema.parse(request.query);
    const ctx = extractRequestContext(request);
    const actor = (request as AuthenticatedRequest).adminActor!;
    await adminAddGroupMember(
      actor,
      groupParams.groupId,
      memberParams.membershipId,
      query.tenantId,
      ctx,
    );
    return reply.send({ ok: true });
  });

  app.delete('/auth/admin/access-groups/:groupId/members/:membershipId', async (request, reply) => {
    const groupParams = groupIdParamSchema.parse(request.params);
    const memberParams = membershipIdParamSchema.parse(request.params);
    const query = adminGroupsQuerySchema.parse(request.query);
    const ctx = extractRequestContext(request);
    const actor = (request as AuthenticatedRequest).adminActor!;
    await adminRemoveGroupMember(
      actor,
      groupParams.groupId,
      memberParams.membershipId,
      query.tenantId,
      ctx,
    );
    return reply.send({ ok: true });
  });

  // --- Tenants ---
  app.get('/auth/admin/tenants', async (request, reply) => {
    const query = adminTenantsQuerySchema.parse(request.query);
    const actor = (request as AuthenticatedRequest).adminActor!;
    const result = await listTenants(actor, query);
    return reply.send({ ok: true, ...result });
  });

  app.get('/auth/admin/tenants/:tenantId', async (request, reply) => {
    const params = tenantIdParamSchema.parse(request.params);
    const actor = (request as AuthenticatedRequest).adminActor!;
    const tenant = await getTenant(actor, params.tenantId);
    return reply.send({ ok: true, tenant });
  });

  app.post('/auth/admin/tenants', async (request, reply) => {
    const body = createTenantAdminSchema.parse(request.body);
    const ctx = extractRequestContext(request);
    const actor = (request as AuthenticatedRequest).adminActor!;
    const tenant = await createTenantAdmin(actor, body, ctx);
    return reply.send({ ok: true, tenant });
  });

  app.patch('/auth/admin/tenants/:tenantId', async (request, reply) => {
    const params = tenantIdParamSchema.parse(request.params);
    const body = updateTenantAdminSchema.parse(request.body);
    const ctx = extractRequestContext(request);
    const actor = (request as AuthenticatedRequest).adminActor!;
    const tenant = await updateTenantAdmin(actor, params.tenantId, body, ctx);
    return reply.send({ ok: true, tenant });
  });

  app.post('/auth/admin/tenants/:tenantId/block', async (request, reply) => {
    const params = tenantIdParamSchema.parse(request.params);
    const ctx = extractRequestContext(request);
    const actor = (request as AuthenticatedRequest).adminActor!;
    const tenant = await blockTenant(actor, params.tenantId, ctx);
    return reply.send({ ok: true, tenant });
  });

  app.post('/auth/admin/tenants/:tenantId/unblock', async (request, reply) => {
    const params = tenantIdParamSchema.parse(request.params);
    const ctx = extractRequestContext(request);
    const actor = (request as AuthenticatedRequest).adminActor!;
    const tenant = await unblockTenant(actor, params.tenantId, ctx);
    return reply.send({ ok: true, tenant });
  });

  app.post('/auth/admin/tenants/:tenantId/transfer-admin', async (request, reply) => {
    const params = tenantIdParamSchema.parse(request.params);
    const body = transferAdminSchema.parse(request.body);
    const ctx = extractRequestContext(request);
    const actor = (request as AuthenticatedRequest).adminActor!;
    const result = await transferAdmin(
      actor,
      params.tenantId,
      body.fromMembershipId,
      body.toMembershipId,
      ctx,
    );
    return reply.send({ ok: true, ...result });
  });
}
