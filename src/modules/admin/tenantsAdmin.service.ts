import type { TenantStatus, TenantType, TenantRole } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { decryptField } from '../../security/crypto.js';
import { ConflictError, NotFoundError } from '../../utils/errors.js';
import { auditCtx, logAuthAudit } from '../audit/authAudit.service.js';
import {
  findMembershipById,
  setMembershipRoles,
} from '../memberships/memberships.service.js';
import { revokeAllTenantSessions } from '../sessions/sessionsRevoke.service.js';
import {
  createTenant,
  findTenantByTextId,
  toPublicTenant,
  type PublicTenant,
} from '../tenants/tenants.service.js';
import {
  assertPlatformOperation,
  assertLastAdminProtection,
} from './adminAuthorization.js';
import type { AdminActor } from './admin.types.js';
import type { PaginatedResult } from './membersAdmin.service.js';

export interface ListTenantsFilters {
  status?: TenantStatus;
  tenantType?: TenantType;
  search?: string;
  page?: number;
  limit?: number;
}

export interface CreateTenantAdminInput {
  tenantId: string;
  tenantType: TenantType;
  displayName?: string;
  taxId?: string;
  slug?: string;
}

export interface UpdateTenantAdminInput {
  displayName?: string;
  slug?: string;
  status?: TenantStatus;
}

export async function listTenants(
  actor: AdminActor,
  filters: ListTenantsFilters = {},
): Promise<PaginatedResult<PublicTenant>> {
  assertPlatformOperation(actor);

  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 20));

  const where = {
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.tenantType ? { tenantType: filters.tenantType } : {}),
  };

  let all = await prisma.authTenant.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });

  if (filters.search) {
    const q = filters.search.toLowerCase();
    all = all.filter((t) => {
      const name = t.displayNameEncrypted ? decryptField(t.displayNameEncrypted).toLowerCase() : '';
      return (
        t.tenantId.toLowerCase().includes(q) ||
        (t.slug?.toLowerCase().includes(q) ?? false) ||
        name.includes(q)
      );
    });
  }

  const total = all.length;
  const offset = (page - 1) * limit;
  const pageItems = all.slice(offset, offset + limit);

  return {
    items: pageItems.map(toPublicTenant),
    total,
    page,
    limit,
  };
}

export async function getTenant(actor: AdminActor, tenantTextId: string): Promise<PublicTenant> {
  assertPlatformOperation(actor);
  const tenant = await findTenantByTextId(tenantTextId);
  if (!tenant) throw new NotFoundError('Tenant não encontrado.');
  return toPublicTenant(tenant);
}

export async function createTenantAdmin(
  actor: AdminActor,
  input: CreateTenantAdminInput,
  ctx?: { ipHash?: string; userAgentHash?: string },
): Promise<PublicTenant> {
  assertPlatformOperation(actor);

  const existing = await findTenantByTextId(input.tenantId);
  if (existing) {
    throw new ConflictError('Tenant já existe.', 'TENANT_EXISTS');
  }

  const tenant = await createTenant({
    tenantId: input.tenantId,
    tenantType: input.tenantType,
    displayName: input.displayName,
    taxId: input.taxId,
    slug: input.slug,
    status: 'pending',
  });

  await logAuthAudit(
    'tenant.created',
    auditCtx(actor, {
      tenantTextId: tenant.tenantId,
      ipHash: ctx?.ipHash,
      userAgentHash: ctx?.userAgentHash,
      metadata: { tenantType: input.tenantType },
    }),
  );

  return toPublicTenant(tenant);
}

export async function updateTenantAdmin(
  actor: AdminActor,
  tenantTextId: string,
  input: UpdateTenantAdminInput,
  ctx?: { ipHash?: string; userAgentHash?: string },
): Promise<PublicTenant> {
  assertPlatformOperation(actor);
  const tenant = await findTenantByTextId(tenantTextId);
  if (!tenant) throw new NotFoundError('Tenant não encontrado.');

  const { encryptField, hashLookup } = await import('../../security/crypto.js');
  const { slugify } = await import('../../utils/normalize.js');

  const displayName = input.displayName?.trim();
  const updated = await prisma.authTenant.update({
    where: { id: tenant.id },
    data: {
      displayNameEncrypted:
        displayName !== undefined
          ? displayName
            ? encryptField(displayName)
            : null
          : undefined,
      displayNameLookupHash:
        displayName !== undefined
          ? displayName
            ? hashLookup(displayName.toLowerCase())
            : null
          : undefined,
      slug: input.slug !== undefined ? input.slug : displayName ? slugify(displayName) : undefined,
      status: input.status,
    },
  });

  await logAuthAudit(
    'tenant.updated',
    auditCtx(actor, {
      tenantTextId,
      ipHash: ctx?.ipHash,
      userAgentHash: ctx?.userAgentHash,
      metadata: { fields: Object.keys(input) },
    }),
  );

  return toPublicTenant(updated);
}

export async function blockTenant(
  actor: AdminActor,
  tenantTextId: string,
  ctx?: { ipHash?: string; userAgentHash?: string },
): Promise<PublicTenant> {
  assertPlatformOperation(actor);
  const tenant = await findTenantByTextId(tenantTextId);
  if (!tenant) throw new NotFoundError('Tenant não encontrado.');

  const now = new Date();
  const updated = await prisma.authTenant.update({
    where: { id: tenant.id },
    data: {
      status: 'blocked',
      blockedAt: now,
      blockedByMembershipId: actor.membership.membershipId,
    },
  });

  const revokedCount = await revokeAllTenantSessions(tenant.id);

  await logAuthAudit(
    'tenant.blocked',
    auditCtx(actor, {
      tenantTextId,
      ipHash: ctx?.ipHash,
      userAgentHash: ctx?.userAgentHash,
      metadata: { revokedSessions: revokedCount },
    }),
  );

  return toPublicTenant(updated);
}

export async function unblockTenant(
  actor: AdminActor,
  tenantTextId: string,
  ctx?: { ipHash?: string; userAgentHash?: string },
): Promise<PublicTenant> {
  assertPlatformOperation(actor);
  const tenant = await findTenantByTextId(tenantTextId);
  if (!tenant) throw new NotFoundError('Tenant não encontrado.');

  const updated = await prisma.authTenant.update({
    where: { id: tenant.id },
    data: {
      status: 'active',
      blockedAt: null,
      blockedByMembershipId: null,
    },
  });

  await logAuthAudit(
    'tenant.unblocked',
    auditCtx(actor, {
      tenantTextId,
      ipHash: ctx?.ipHash,
      userAgentHash: ctx?.userAgentHash,
    }),
  );

  return toPublicTenant(updated);
}

export async function transferAdmin(
  actor: AdminActor,
  tenantTextId: string,
  fromMembershipId: string,
  toMembershipId: string,
  ctx?: { ipHash?: string; userAgentHash?: string },
): Promise<{ from: string; to: string }> {
  assertPlatformOperation(actor);
  const tenant = await findTenantByTextId(tenantTextId);
  if (!tenant) throw new NotFoundError('Tenant não encontrado.');

  const from = await findMembershipById(fromMembershipId);
  const to = await findMembershipById(toMembershipId);
  if (!from || from.tenantId !== tenant.id) {
    throw new NotFoundError('Membership de origem não encontrada.');
  }
  if (!to || to.tenantId !== tenant.id) {
    throw new NotFoundError('Membership de destino não encontrada.');
  }
  if (to.status !== 'active') {
    throw new ConflictError('Membership de destino precisa estar ativa.');
  }

  const adminRole = tenant.tenantType === 'business' ? 'company_admin' : 'individual_admin';
  const fromRoles = from.roles.map((r) => r.role);
  if (!fromRoles.includes(adminRole)) {
    throw new ConflictError('Membership de origem não possui role de admin.');
  }

  await assertLastAdminProtection(tenant.id, fromMembershipId, fromRoles.filter((r) => r !== adminRole));

  const toRoles = to.roles.map((r) => r.role);
  const newToRoles = toRoles.includes(adminRole) ? toRoles : [...toRoles, adminRole];
  const newFromRoles = fromRoles.filter((r) => r !== adminRole);

  await setMembershipRoles(fromMembershipId, newFromRoles as TenantRole[]);
  await setMembershipRoles(toMembershipId, newToRoles as TenantRole[]);

  await logAuthAudit(
    'tenant.admin_transferred',
    auditCtx(actor, {
      targetMembershipId: toMembershipId,
      tenantTextId,
      ipHash: ctx?.ipHash,
      userAgentHash: ctx?.userAgentHash,
      metadata: { fromMembershipId, toMembershipId, adminRole },
    }),
  );

  return { from: fromMembershipId, to: toMembershipId };
}
