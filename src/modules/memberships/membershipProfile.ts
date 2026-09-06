import type { AuthMembership, AuthNotificationPreference, AuthTenant } from '@prisma/client';
import { decryptField } from '../../security/crypto.js';

/**
 * O que a pessoa declarou, e como ela quer ser avisada.
 *
 * Morava em `access-requests`, que saiu junto com o pedido de acesso. Os dois helpers que
 * sobreviveram nunca dependeram do pedido: leem a própria membership e a preferência de
 * notificação, que continuam existindo para quem entra por convite.
 */

function decryptOptional(value: string | null | undefined): string | null {
  if (!value) return null;
  return decryptField(value);
}

export type MembershipNotificationPreferencesDto = {
  email: boolean;
  whatsapp: boolean;
  documentCreated: boolean;
  documentUpdated: boolean;
  documentRequiresSignature: boolean;
  accessApproved: boolean;
  accessRejected: boolean;
} | null;

/**
 * Cargo, setor e motivo, lidos da membership.
 *
 * Devolve `undefined` quando nada foi declarado — a ficha então não mostra a seção, em vez de
 * mostrar uma seção de campos vazios.
 */
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

export function buildNotificationPreferencesDto(
  prefs: AuthNotificationPreference | null,
): MembershipNotificationPreferencesDto {
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
