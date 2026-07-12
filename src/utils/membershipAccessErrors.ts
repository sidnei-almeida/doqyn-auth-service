import type { AuthErrorCode } from './authErrorCodes.js';
import { AUTH_ERROR_MESSAGES } from './authErrorCodes.js';

type MembershipLike = {
  status: 'pending' | 'active' | 'blocked' | 'rejected' | 'removed';
  tenant?: { status?: string };
};

export function resolveMembershipAccessError(memberships: MembershipLike[]): {
  code: AuthErrorCode;
  message: string;
  statusCode: number;
  details?: Record<string, unknown>;
} {
  const visible = memberships.filter((membership) => membership.status !== 'removed');

  if (visible.length === 0) {
    return {
      code: 'NO_ACTIVE_MEMBERSHIP',
      message: AUTH_ERROR_MESSAGES.NO_ACTIVE_MEMBERSHIP,
      statusCode: 403,
    };
  }

  // Provisionamento falhou — prioridade sobre MEMBERSHIP_PENDING genérico.
  const provisioningFailed = visible.find(
    (membership) =>
      membership.tenant?.status === 'provisioning_failed' ||
      membership.tenant?.status === 'pending_provisioning',
  );
  if (provisioningFailed) {
    return {
      code: 'TENANT_PROVISIONING_FAILED',
      message: AUTH_ERROR_MESSAGES.TENANT_PROVISIONING_FAILED,
      statusCode: 403,
      details: { status: provisioningFailed.tenant?.status ?? 'provisioning_failed' },
    };
  }

  const blocked = visible.find((membership) => membership.status === 'blocked');
  if (blocked) {
    return {
      code: 'MEMBERSHIP_BLOCKED',
      message: AUTH_ERROR_MESSAGES.MEMBERSHIP_BLOCKED,
      statusCode: 403,
      details: { status: 'blocked' },
    };
  }

  const rejected = visible.find((membership) => membership.status === 'rejected');
  if (rejected) {
    return {
      code: 'MEMBERSHIP_REJECTED',
      message: AUTH_ERROR_MESSAGES.MEMBERSHIP_REJECTED,
      statusCode: 403,
      details: { status: 'rejected' },
    };
  }

  const pendingOnly = visible.every((membership) => membership.status === 'pending');
  if (pendingOnly) {
    return {
      code: 'MEMBERSHIP_PENDING',
      message: AUTH_ERROR_MESSAGES.MEMBERSHIP_PENDING,
      statusCode: 403,
      details: { status: 'pending' },
    };
  }

  const inactiveTenant = visible.find(
    (membership) => membership.status === 'active' && membership.tenant?.status !== 'active',
  );
  if (inactiveTenant) {
    return {
      code: 'TENANT_INACTIVE',
      message: AUTH_ERROR_MESSAGES.TENANT_INACTIVE,
      statusCode: 403,
      details: { status: inactiveTenant.tenant?.status ?? 'inactive' },
    };
  }

  return {
    code: 'NO_ACTIVE_MEMBERSHIP',
    message: AUTH_ERROR_MESSAGES.NO_ACTIVE_MEMBERSHIP,
    statusCode: 403,
  };
}

export function membershipStatusToErrorCode(
  status: MembershipLike['status'],
): AuthErrorCode {
  switch (status) {
    case 'pending':
      return 'MEMBERSHIP_PENDING';
    case 'blocked':
      return 'MEMBERSHIP_BLOCKED';
    case 'rejected':
      return 'MEMBERSHIP_REJECTED';
    case 'removed':
      return 'MEMBERSHIP_REMOVED';
    default:
      return 'MEMBERSHIP_NOT_ACTIVE';
  }
}
