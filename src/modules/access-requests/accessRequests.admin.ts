import type { AuthAccessRequest, AuthMembership, AuthNotificationPreference, AuthTenant, AuthTermsAcceptance, AuthUser } from '@prisma/client';
import { decryptField } from '../../security/crypto.js';
import { toPublicUser } from '../users/users.service.js';

export type AdminAccessRequestDto = {
  id: string;
  status: string;
  membershipId: string | null;
  tenantId: string;
  tenantName: string | null;
  requestedAt: string;
  requester: {
    name: string;
    email: string;
    whatsapp: string | null;
    firstName: string | null;
    lastName: string | null;
  };
  requestedAccess: {
    personType: string;
    taxIdType: string;
    taxIdMasked: string | null;
    tenantDisplayName: string | null;
    jobTitle: string | null;
    departmentText: string | null;
    reason: string | null;
    requestedAt: string;
    source: 'access_request';
  };
  consent: {
    textVersion: string | null;
    acceptedAt: string;
    operationalNotificationsConsent: boolean;
  } | null;
  terms: {
    accepted: boolean;
    version: string | null;
    acceptedAt: string;
  } | null;
  notificationPreferences: {
    email: boolean;
    whatsapp: boolean;
    documentCreated: boolean;
    documentUpdated: boolean;
    documentRequiresSignature: boolean;
    accessApproved: boolean;
    accessRejected: boolean;
  } | null;
  decision: {
    decidedAt: string;
    decidedByMembershipId: string | null;
    status: string;
  } | null;
};

function decryptOptional(value: string | null | undefined): string | null {
  return value ? decryptField(value) : null;
}

export function buildRequestedAccessFromRecord(
  request: Pick<
    AuthAccessRequest,
    | 'personType'
    | 'taxIdType'
    | 'taxIdMasked'
    | 'tenantDisplayNameEncrypted'
    | 'jobTitleEncrypted'
    | 'departmentEncrypted'
    | 'reasonEncrypted'
    | 'requestedAt'
  >,
) {
  return {
    personType: request.personType,
    taxIdType: request.taxIdType,
    taxIdMasked: request.taxIdMasked,
    tenantDisplayName: decryptOptional(request.tenantDisplayNameEncrypted),
    jobTitle: decryptOptional(request.jobTitleEncrypted),
    departmentText: decryptOptional(request.departmentEncrypted),
    reason: decryptOptional(request.reasonEncrypted),
    requestedAt: request.requestedAt.toISOString(),
    source: 'access_request' as const,
  };
}

export function buildRequestedAccessFromMembership(
  membership: Pick<
    AuthMembership,
    | 'requestedJobTitleEncrypted'
    | 'requestedDepartmentEncrypted'
    | 'requestedReasonEncrypted'
    | 'createdAt'
  >,
  tenant: Pick<AuthTenant, 'taxIdType' | 'taxIdMasked' | 'displayNameEncrypted' | 'tenantId'>,
) {
  if (!membership.requestedJobTitleEncrypted && !membership.requestedDepartmentEncrypted) {
    return undefined;
  }

  return {
    personType: 'business',
    taxIdType: tenant.taxIdType ?? 'CNPJ',
    taxIdMasked: tenant.taxIdMasked,
    tenantDisplayName: tenant.displayNameEncrypted
      ? decryptField(tenant.displayNameEncrypted)
      : tenant.tenantId,
    jobTitle: decryptOptional(membership.requestedJobTitleEncrypted),
    departmentText: decryptOptional(membership.requestedDepartmentEncrypted),
    reason: decryptOptional(membership.requestedReasonEncrypted),
    requestedAt: membership.createdAt.toISOString(),
    source: 'invite' as const,
  };
}

export function buildConsentFromRecord(
  request: Pick<
    AuthAccessRequest,
    'consentTextVersion' | 'requestedAt' | 'operationalNotificationsConsent'
  >,
) {
  return {
    textVersion: request.consentTextVersion,
    acceptedAt: request.requestedAt.toISOString(),
    operationalNotificationsConsent: request.operationalNotificationsConsent,
  };
}

export function buildTermsFromAcceptance(
  acceptance: Pick<AuthTermsAcceptance, 'termsVersion' | 'acceptedAt'> | null | undefined,
) {
  if (!acceptance) return null;

  return {
    accepted: true,
    version: acceptance.termsVersion,
    acceptedAt: acceptance.acceptedAt.toISOString(),
  };
}

export function buildNotificationPreferencesDto(
  prefs: AuthNotificationPreference | null,
): AdminAccessRequestDto['notificationPreferences'] {
  if (!prefs) return null;
  return {
    email: prefs.email,
    whatsapp: prefs.whatsapp,
    documentCreated: prefs.documentCreated,
    documentUpdated: prefs.documentUpdated,
    documentRequiresSignature: prefs.documentRequiresSignature,
    accessApproved: prefs.accessApproved,
    accessRejected: prefs.accessRejected,
  };
}

export function serializeAdminAccessRequest(input: {
  request: AuthAccessRequest;
  user: AuthUser;
  tenantTextId: string;
  tenantDisplayName: string | null;
  notificationPreferences: AuthNotificationPreference | null;
  termsAcceptance?: Pick<AuthTermsAcceptance, 'termsVersion' | 'acceptedAt'> | null;
}): AdminAccessRequestDto {
  const publicUser = toPublicUser(input.user);
  const name =
    [publicUser.firstName, publicUser.lastName].filter(Boolean).join(' ') || publicUser.email;

  return {
    id: input.request.id,
    status: input.request.status,
    membershipId: input.request.membershipId,
    tenantId: input.tenantTextId,
    tenantName: input.tenantDisplayName,
    requestedAt: input.request.requestedAt.toISOString(),
    requester: {
      name,
      email: publicUser.email,
      whatsapp: publicUser.whatsapp ?? null,
      firstName: publicUser.firstName ?? null,
      lastName: publicUser.lastName ?? null,
    },
    requestedAccess: buildRequestedAccessFromRecord(input.request),
    consent: buildConsentFromRecord(input.request),
    terms: buildTermsFromAcceptance(input.termsAcceptance),
    notificationPreferences: buildNotificationPreferencesDto(input.notificationPreferences),
    decision:
      input.request.decidedAt || input.request.decidedByMembershipId
        ? {
            decidedAt: input.request.decidedAt?.toISOString() ?? input.request.updatedAt.toISOString(),
            decidedByMembershipId: input.request.decidedByMembershipId,
            status: input.request.status,
          }
        : null,
  };
}
