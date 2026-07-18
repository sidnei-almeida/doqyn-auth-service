import { prisma } from '../../db/prisma.js';
import { decryptField, encryptField, hashLookup } from '../../security/crypto.js';
import { hashPassword } from '../../security/password.js';
import {
  ConflictError,
  NotFoundError,
  TenantNotActiveError,
  ValidationError,
} from '../../utils/errors.js';
import {
  detectTaxIdType,
  maskTaxId,
  normalizeEmail,
  normalizePhone,
  normalizeTaxId,
} from '../../utils/normalize.js';
import { logAuthAudit } from '../audit/authAudit.service.js';
import { scheduleTenantMemberSync } from '../../integrations/memberSync.js';
import { recordTermsAcceptance } from '../terms/termsAcceptance.service.js';
import type { AccessRequestInput } from './accessRequests.schemas.js';
import { CONSENT_TEXT_VERSION } from './accessRequests.constants.js';

const SUCCESS_MESSAGE =
  'Sua solicitação foi enviada. Um administrador da empresa precisará aprovar seu acesso.';

export async function submitAccessRequest(
  input: AccessRequestInput,
  ipHash?: string,
  userAgentHash?: string,
): Promise<{ ok: true; message: string }> {
  const email = normalizeEmail(input.email);
  const whatsapp = normalizePhone(input.whatsapp);
  const taxId = normalizeTaxId(input.taxId);
  const taxIdHash = hashLookup(taxId);

  if (input.personType !== 'business') {
    throw new ValidationError(
      'Solicitação de acesso disponível apenas para empresas (CNPJ).',
      'INDIVIDUAL_ACCESS_NOT_SUPPORTED',
    );
  }

  const tenant = await prisma.authTenant.findFirst({ where: { taxIdHash } });

  if (tenant && tenant.tenantType !== 'business') {
    throw new ValidationError(
      'Solicitação de acesso disponível apenas para empresas.',
      'TENANT_NOT_BUSINESS',
    );
  }

  if (!tenant) {
    if (taxId.length !== 14) {
      throw new ValidationError('CNPJ inválido.', 'VALIDATION_ERROR');
    }
    throw new NotFoundError(
      'Empresa não encontrada. Verifique o CNPJ ou cadastre sua empresa no DOQYN.',
      'TENANT_NOT_FOUND',
    );
  }

  if (tenant.status !== 'active') {
    throw new TenantNotActiveError(
      'Esta empresa ainda não está disponível para novos acessos.',
    );
  }

  const tenantDisplayName =
    input.tenantDisplayName?.trim() ||
    (tenant.displayNameEncrypted ? decryptField(tenant.displayNameEncrypted) : 'Empresa');

  const result = await prisma.$transaction(async (tx) => {
    const emailLookupHash = hashLookup(email);
    let user = await tx.authUser.findUnique({ where: { emailLookupHash } });

    if (!user) {
      user = await tx.authUser.create({
        data: {
          emailEncrypted: encryptField(email),
          emailLookupHash,
          firstNameEncrypted: encryptField(input.firstName),
          lastNameEncrypted: encryptField(input.lastName),
          whatsappEncrypted: encryptField(whatsapp),
          whatsappLookupHash: hashLookup(whatsapp),
          status: 'active',
        },
      });
    } else {
      await tx.authUser.update({
        where: { id: user.id },
        data: {
          firstNameEncrypted: encryptField(input.firstName),
          lastNameEncrypted: encryptField(input.lastName),
          whatsappEncrypted: encryptField(whatsapp),
          whatsappLookupHash: hashLookup(whatsapp),
        },
      });
    }

    const existingCredential = await tx.authCredential.findUnique({ where: { userId: user.id } });
    if (!existingCredential) {
      const passwordHash = await hashPassword(input.password);
      await tx.authCredential.create({ data: { userId: user.id, passwordHash } });
    } else if (input.password) {
      const passwordHash = await hashPassword(input.password);
      await tx.authCredential.update({
        where: { userId: user.id },
        data: { passwordHash },
      });
    }

    let membership = await tx.authMembership.findUnique({
      where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
    });

    if (membership?.status === 'active') {
      throw new ConflictError('Você já possui acesso ativo nesta empresa.', 'MEMBERSHIP_EXISTS');
    }

    if (!membership) {
      membership = await tx.authMembership.create({
        data: {
          userId: user.id,
          tenantId: tenant.id,
          status: 'pending',
          requestedJobTitleEncrypted: encryptField(input.jobTitle),
          requestedDepartmentEncrypted: encryptField(input.departmentText),
          requestedReasonEncrypted: encryptField(input.reason),
        },
      });
    } else if (membership.status === 'pending') {
      await tx.authMembership.update({
        where: { id: membership.id },
        data: {
          requestedJobTitleEncrypted: encryptField(input.jobTitle),
          requestedDepartmentEncrypted: encryptField(input.departmentText),
          requestedReasonEncrypted: encryptField(input.reason),
        },
      });
    }

    const existingRequest = await tx.authAccessRequest.findFirst({
      where: {
        userId: user.id,
        tenantId: tenant.id,
        status: 'pending',
      },
    });

    let accessRequestId: string;

    if (!existingRequest) {
      const createdRequest = await tx.authAccessRequest.create({
        data: {
          userId: user.id,
          tenantId: tenant.id,
          membershipId: membership.id,
          status: 'pending',
          personType: input.personType,
          taxIdType: tenant.taxIdType ?? detectTaxIdType(taxId),
          taxIdMasked: maskTaxId(taxId),
          taxIdHash,
          tenantDisplayNameEncrypted: encryptField(tenantDisplayName),
          jobTitleEncrypted: encryptField(input.jobTitle),
          departmentEncrypted: encryptField(input.departmentText),
          reasonEncrypted: encryptField(input.reason),
          operationalNotificationsConsent: input.operationalNotificationsConsent,
          consentTextVersion: CONSENT_TEXT_VERSION,
        },
      });
      accessRequestId = createdRequest.id;
    } else {
      await tx.authAccessRequest.update({
        where: { id: existingRequest.id },
        data: {
          personType: input.personType,
          taxIdType: tenant.taxIdType ?? detectTaxIdType(taxId),
          taxIdMasked: maskTaxId(taxId),
          taxIdHash,
          tenantDisplayNameEncrypted: encryptField(tenantDisplayName),
          jobTitleEncrypted: encryptField(input.jobTitle),
          departmentEncrypted: encryptField(input.departmentText),
          reasonEncrypted: encryptField(input.reason),
          operationalNotificationsConsent: input.operationalNotificationsConsent,
          consentTextVersion: CONSENT_TEXT_VERSION,
          requestedAt: new Date(),
        },
      });
      accessRequestId = existingRequest.id;
    }

    await recordTermsAcceptance(
      {
        flow: 'access_request',
        termsVersion: input.acceptedTermsVersion,
        userId: user.id,
        membershipId: membership.id,
        tenantId: tenant.id,
        accessRequestId,
        ipAddressHash: ipHash,
        userAgentHash: userAgentHash,
      },
      tx,
    );

    await tx.authNotificationPreference.upsert({
      where: { membershipId: membership.id },
      create: { membershipId: membership.id },
      update: {},
    });

    return { userId: user.id, membershipId: membership.id, tenantTextId: tenant.tenantId };
  });

  await logAuthAudit('access.requested', {
    userId: result.userId,
    tenantTextId: result.tenantTextId,
    targetMembershipId: result.membershipId,
    ipHash,
    userAgentHash,
  });

  scheduleTenantMemberSync(result.membershipId);

  return { ok: true, message: SUCCESS_MESSAGE };
}
