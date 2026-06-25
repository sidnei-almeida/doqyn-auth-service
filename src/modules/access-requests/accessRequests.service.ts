import { prisma } from '../../db/prisma.js';
import { encryptField, hashLookup } from '../../security/crypto.js';
import { hashPassword } from '../../security/password.js';
import {
  detectTaxIdType,
  maskTaxId,
  normalizeEmail,
  normalizePhone,
  normalizeTaxId,
  slugify,
} from '../../utils/normalize.js';
import { logAuthAudit } from '../audit/authAudit.service.js';
import type { AccessRequestInput } from './accessRequests.schemas.js';

const GENERIC_SUCCESS_MESSAGE =
  'Solicitação recebida. Se os dados estiverem corretos, entraremos em contato em breve.';

export async function submitAccessRequest(
  input: AccessRequestInput,
  ipHash?: string,
  userAgentHash?: string,
): Promise<{ ok: true; message: string }> {
  const email = normalizeEmail(input.email);
  const whatsapp = normalizePhone(input.whatsapp);
  const taxId = normalizeTaxId(input.taxId);
  const taxIdHash = hashLookup(taxId);

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
    if (!existingCredential && input.password) {
      const passwordHash = await hashPassword(input.password);
      await tx.authCredential.create({ data: { userId: user.id, passwordHash } });
    }

    let tenant = await tx.authTenant.findFirst({ where: { taxIdHash } });
    if (!tenant) {
      const tenantType = input.personType === 'business' ? 'business' : 'individual';
      tenant = await tx.authTenant.create({
        data: {
          tenantId: `tenant_${taxIdHash.slice(0, 16)}`,
          tenantType,
          displayNameEncrypted: encryptField(input.tenantDisplayName),
          displayNameLookupHash: hashLookup(input.tenantDisplayName.toLowerCase()),
          slug: slugify(input.tenantDisplayName),
          taxIdType: detectTaxIdType(taxId),
          taxIdMasked: maskTaxId(taxId),
          taxIdHash,
          status: 'pending',
        },
      });
    }

    let membership = await tx.authMembership.findUnique({
      where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
    });

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
    }

    await tx.authAccessRequest.create({
      data: {
        userId: user.id,
        tenantId: tenant.id,
        membershipId: membership.id,
        status: 'pending',
        personType: input.personType,
        taxIdType: detectTaxIdType(taxId),
        taxIdMasked: maskTaxId(taxId),
        taxIdHash,
        tenantDisplayNameEncrypted: encryptField(input.tenantDisplayName),
        jobTitleEncrypted: encryptField(input.jobTitle),
        departmentEncrypted: encryptField(input.departmentText),
        reasonEncrypted: encryptField(input.reason),
        operationalNotificationsConsent: input.operationalNotificationsConsent,
      },
    });

    await tx.authNotificationPreference.upsert({
      where: { membershipId: membership.id },
      create: { membershipId: membership.id },
      update: {},
    });

    return { userId: user.id, membershipId: membership.id };
  });

  await logAuthAudit('access.requested', {
    userId: result.userId,
    ipHash,
    userAgentHash,
    metadata: { membershipId: result.membershipId },
  });

  return { ok: true, message: GENERIC_SUCCESS_MESSAGE };
}
