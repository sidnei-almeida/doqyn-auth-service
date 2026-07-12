import { prisma } from '../../db/prisma.js';
import { encryptField, hashLookup } from '../../security/crypto.js';
import { hashPassword, validatePasswordStrength } from '../../security/password.js';
import { ConflictError, ValidationError } from '../../utils/errors.js';
import {
  detectTaxIdType,
  maskTaxId,
  normalizeEmail,
  normalizePhone,
  normalizeTaxId,
  slugify,
} from '../../utils/normalize.js';
import { generateBusinessTenantId } from '../../utils/tenantId.js';
import { recordTermsAcceptance } from '../terms/termsAcceptance.service.js';
import type { PublicMembership } from '../memberships/memberships.schemas.js';
import { buildSessionContext } from '../memberships/sessionContext.service.js';
import type { PublicUser } from '../users/users.schemas.js';
import { toPublicUser } from '../users/users.service.js';
import type { CompanySignupInput } from './companySignups.schemas.js';
import {
  finalizeSignupProvisioning,
  logSignupCreatedAudits,
} from '../signups/signupOrchestrator.js';

const PROVISIONING_FAILURE_MESSAGE =
  'Sua empresa foi cadastrada, mas ainda estamos preparando o ambiente. Tente novamente em alguns minutos ou fale com o suporte.';

export interface CompanySignupSuccess {
  ok: true;
  message: string;
  user: PublicUser;
  tenant: {
    tenantId: string;
    tenantType: 'business';
    displayName: string;
    status: string;
  };
  activeMembership: PublicMembership;
  sessionToken: string;
}

export async function submitCompanySignup(
  input: CompanySignupInput,
  ipHash?: string,
  userAgentHash?: string,
): Promise<CompanySignupSuccess> {
  const passwordError = validatePasswordStrength(input.password);
  if (passwordError) {
    throw new ValidationError(passwordError, 'WEAK_PASSWORD');
  }

  const email = normalizeEmail(input.email);
  const whatsapp = normalizePhone(input.whatsapp);
  const taxId = normalizeTaxId(input.taxId);
  const taxIdHash = hashLookup(taxId);
  const emailLookupHash = hashLookup(email);

  const existingTenant = await prisma.authTenant.findFirst({ where: { taxIdHash } });
  if (
    existingTenant &&
    ['active', 'pending', 'pending_provisioning', 'provisioning_failed'].includes(
      existingTenant.status,
    )
  ) {
    throw new ConflictError(
      'Já existe uma empresa cadastrada com este CNPJ.',
      'COMPANY_ALREADY_EXISTS',
    );
  }

  const existingUser = await prisma.authUser.findUnique({ where: { emailLookupHash } });
  if (existingUser) {
    throw new ConflictError(
      'Este e-mail já está em uso. Faça login ou use outro e-mail.',
      'EMAIL_ALREADY_EXISTS',
    );
  }

  const tenantTextId = generateBusinessTenantId(input.companyName);
  const collectionPrefix = tenantTextId;
  const passwordHash = await hashPassword(input.password);
  const displayName = input.companyName.trim();

  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.authUser.create({
      data: {
        emailEncrypted: encryptField(email),
        emailLookupHash,
        firstNameEncrypted: encryptField(input.firstName),
        lastNameEncrypted: encryptField(input.lastName),
        whatsappEncrypted: encryptField(whatsapp),
        whatsappLookupHash: hashLookup(whatsapp),
        status: 'active',
        emailVerified: true,
      },
    });

    await tx.authCredential.create({
      data: { userId: user.id, passwordHash },
    });

    const tenant = await tx.authTenant.create({
      data: {
        tenantId: tenantTextId,
        tenantType: 'business',
        displayNameEncrypted: encryptField(displayName),
        displayNameLookupHash: hashLookup(displayName.toLowerCase()),
        slug: slugify(input.companyName),
        taxIdType: detectTaxIdType(taxId),
        taxIdMasked: maskTaxId(taxId),
        taxIdHash,
        status: 'pending_provisioning',
      },
    });

    const membership = await tx.authMembership.create({
      data: {
        userId: user.id,
        tenantId: tenant.id,
        status: 'pending',
      },
    });

    await tx.authMembershipRole.createMany({
      data: [
        { membershipId: membership.id, role: 'company_admin' },
        { membershipId: membership.id, role: 'user' },
      ],
    });

    await tx.authNotificationPreference.create({
      data: { membershipId: membership.id },
    });

    await recordTermsAcceptance(
      {
        flow: 'company_registration',
        termsVersion: input.acceptedTermsVersion,
        userId: user.id,
        membershipId: membership.id,
        tenantId: tenant.id,
        ipAddressHash: ipHash,
        userAgentHash: userAgentHash,
      },
      tx,
    );

    return { user, tenant, membership };
  });

  await logSignupCreatedAudits('company_signup', {
    userId: created.user.id,
    tenantTextId: created.tenant.tenantId,
    targetMembershipId: created.membership.id,
    ipHash,
    userAgentHash,
  });

  const result = await finalizeSignupProvisioning({
    created,
    tenantType: 'business',
    displayName,
    collectionPrefix,
    successMessage: 'Empresa cadastrada com sucesso. Seu ambiente foi criado.',
    provisioningFailureMessage: PROVISIONING_FAILURE_MESSAGE,
    auditPrefix: 'company_signup',
    ipHash,
    userAgentHash,
  });

  return {
    ...result,
    tenant: {
      ...result.tenant,
      tenantType: 'business',
    },
  };
}

export async function buildCompanySignupSessionResponse(userId: string, membershipId: string) {
  const user = await prisma.authUser.findUniqueOrThrow({ where: { id: userId } });
  const context = await buildSessionContext(toPublicUser(user), membershipId);
  return context;
}
