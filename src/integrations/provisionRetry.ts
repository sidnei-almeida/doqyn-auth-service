import { decryptField } from '../security/crypto.js';
import { prisma } from '../db/prisma.js';
import { provisionTenantInMainApp } from './appProvisioning.js';
import { awaitTenantMemberSync } from './memberSync.js';
import { logAuthAudit } from '../modules/audit/authAudit.service.js';

const SHARED_INDIVIDUAL_COLLECTION_PREFIX = 'compartilhado';

export type RetryProvisioningResult =
  | { ok: true; tenantId: string; membershipId: string }
  | { ok: false; error: string; statusCode?: number };

/**
 * Re-tenta provisionamento de tenant em `provisioning_failed`.
 * Em sucesso: ativa tenant + memberships pending do criador e sincroniza member no app.
 */
export async function retryFailedTenantProvisioning(
  tenantUuid: string,
): Promise<RetryProvisioningResult> {
  const tenant = await prisma.authTenant.findUnique({
    where: { id: tenantUuid },
    include: {
      memberships: {
        where: { status: 'pending' },
        orderBy: { createdAt: 'asc' },
        take: 1,
      },
    },
  });

  if (!tenant) {
    return { ok: false, error: 'Tenant não encontrado.', statusCode: 404 };
  }

  if (tenant.status !== 'provisioning_failed' && tenant.status !== 'pending_provisioning') {
    return { ok: false, error: `Tenant não está em falha de provisionamento (${tenant.status}).` };
  }

  const membership = tenant.memberships[0];
  if (!membership) {
    return { ok: false, error: 'Nenhuma membership pendente para reprocessar.' };
  }

  const displayName = tenant.displayNameEncrypted
    ? decryptField(tenant.displayNameEncrypted)
    : tenant.tenantId;

  const collectionPrefix =
    tenant.tenantType === 'individual'
      ? SHARED_INDIVIDUAL_COLLECTION_PREFIX
      : tenant.tenantId;

  await logAuthAudit('tenant.provision_retry_started', {
    userId: membership.userId,
    tenantTextId: tenant.tenantId,
    targetMembershipId: membership.id,
    metadata: { previousStatus: tenant.status },
  });

  const provision = await provisionTenantInMainApp({
    tenantId: tenant.tenantId,
    tenantType: tenant.tenantType === 'individual' ? 'individual' : 'business',
    displayName,
    collectionPrefix,
    createdByUserId: membership.userId,
    createdByMembershipId: membership.id,
  });

  if (!provision.ok) {
    await prisma.authTenant.update({
      where: { id: tenant.id },
      data: { status: 'provisioning_failed' },
    });

    await logAuthAudit('tenant.provision_retry_failed', {
      userId: membership.userId,
      tenantTextId: tenant.tenantId,
      targetMembershipId: membership.id,
      metadata: { error: provision.error, statusCode: provision.statusCode },
    });

    return {
      ok: false,
      error: provision.error,
      statusCode: provision.statusCode,
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.authTenant.update({
      where: { id: tenant.id },
      data: { status: 'active' },
    });
    await tx.authMembership.update({
      where: { id: membership.id },
      data: { status: 'active', approvedAt: new Date() },
    });
  });

  await logAuthAudit('tenant.provision_retry_succeeded', {
    userId: membership.userId,
    tenantTextId: tenant.tenantId,
    targetMembershipId: membership.id,
  });

  await awaitTenantMemberSync(membership.id);

  return {
    ok: true,
    tenantId: tenant.tenantId,
    membershipId: membership.id,
  };
}

/** Tenta recuperar tenants do usuário que falharam no provisionamento. */
export async function retryProvisioningForUserMemberships(
  memberships: Array<{ id: string; status: string; tenant: { id: string; status: string } }>,
): Promise<boolean> {
  let anyRecovered = false;

  for (const membership of memberships) {
    if (
      membership.status === 'pending' &&
      (membership.tenant.status === 'provisioning_failed' ||
        membership.tenant.status === 'pending_provisioning')
    ) {
      const result = await retryFailedTenantProvisioning(membership.tenant.id);
      if (result.ok) anyRecovered = true;
    }
  }

  return anyRecovered;
}
