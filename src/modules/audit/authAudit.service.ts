import type { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { safeLog } from '../../utils/safeLog.js';

export type AuditAction =
  | 'user.created'
  | 'user.disabled'
  | 'user.enabled'
  | 'user.deactivated'
  | 'user.anonymized'
  | 'user.sessions_revoked'
  | 'login.success'
  | 'login.failed'
  | 'logout'
  | 'session.verified'
  | 'password.reset_requested'
  | 'password.reset_completed'
  | 'password.updated'
  | 'access.requested'
  | 'company_signup.requested'
  | 'company_signup.tenant_created'
  | 'company_signup.admin_created'
  | 'company_signup.default_groups_created'
  | 'company_signup.provision_started'
  | 'company_signup.provision_succeeded'
  | 'company_signup.provision_failed'
  | 'individual_signup.requested'
  | 'individual_signup.tenant_created'
  | 'individual_signup.admin_created'
  | 'individual_signup.provision_started'
  | 'individual_signup.provision_succeeded'
  | 'individual_signup.provision_failed'
  | 'membership.approved'
  | 'membership.rejected'
  | 'membership.blocked'
  | 'membership.unblocked'
  | 'membership.removed'
  | 'membership.access_updated'
  | 'member.roles_updated'
  | 'member.access_groups_updated'
  | 'member.sessions_revoked'
  | 'access_group.created'
  | 'access_group.updated'
  | 'access_group.deleted'
  | 'access_group.member_added'
  | 'access_group.member_removed'
  | 'tenant.created'
  | 'tenant.updated'
  | 'tenant.blocked'
  | 'tenant.unblocked'
  | 'tenant.admin_transferred'
  | 'tenant.selected'
  | 'account.deletion_requested';

export interface AuditContext {
  userId?: string;
  actorMembershipId?: string;
  targetUserId?: string;
  targetMembershipId?: string;
  tenantTextId?: string;
  ipHash?: string;
  userAgentHash?: string;
  metadata?: Record<string, unknown>;
}

function sanitizeMetadata(metadata?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === 'string' && /password|token|secret|hash|encrypted/i.test(key)) {
      sanitized[key] = '[REDACTED]';
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      sanitized[key] = sanitizeMetadata(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export async function logAuthAudit(
  action: AuditAction,
  context: AuditContext = {},
): Promise<void> {
  const metadata = sanitizeMetadata(context.metadata);
  safeLog(`audit:${action}`, {
    userId: context.userId,
    tenantTextId: context.tenantTextId,
    targetMembershipId: context.targetMembershipId,
  });

  await prisma.authAuditLog.create({
    data: {
      userId: context.userId ?? null,
      actorMembershipId: context.actorMembershipId ?? null,
      targetUserId: context.targetUserId ?? null,
      targetMembershipId: context.targetMembershipId ?? null,
      tenantTextId: context.tenantTextId ?? null,
      action,
      ipHash: context.ipHash ?? null,
      userAgentHash: context.userAgentHash ?? null,
      metadata: (metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

export function auditCtx(
  actor: { userId: string; membership?: { membershipId: string; tenantId: string } },
  extras?: Partial<AuditContext>,
): AuditContext {
  return {
    userId: actor.userId,
    actorMembershipId: actor.membership?.membershipId,
    tenantTextId: actor.membership?.tenantId,
    ...extras,
  };
}
