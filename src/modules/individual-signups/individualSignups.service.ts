import type { CountryCode } from 'libphonenumber-js/min';
import { prisma } from '../../db/prisma.js';
import { encryptField, hashLookup } from '../../security/crypto.js';
import { hashPassword, validatePasswordStrength } from '../../security/password.js';
import { ConflictError, ValidationError } from '../../utils/errors.js';
import {
  maskTaxId,
  normalizeEmail,
  normalizePhone,
  normalizeTaxId,
  slugify,
} from '../../utils/normalize.js';
import { generateIndividualTenantId } from '../../utils/tenantId.js';
import { recordTermsAcceptance } from '../terms/termsAcceptance.service.js';
import type { PublicMembership } from '../memberships/memberships.schemas.js';
import type { PublicUser } from '../users/users.schemas.js';
import type { IndividualSignupInput } from './individualSignups.schemas.js';
import {
  finalizeSignupProvisioning,
  logSignupCreatedAudits,
} from '../signups/signupOrchestrator.js';

export const SHARED_INDIVIDUAL_COLLECTION_PREFIX = 'compartilhado';

const PROVISIONING_FAILURE_MESSAGE =
  'Seu cadastro foi recebido, mas ainda estamos preparando o ambiente. Tente novamente em alguns minutos ou fale com o suporte.';

export interface IndividualSignupSuccess {
  ok: true;
  message: string;
  user: PublicUser;
  tenant: {
    tenantId: string;
    tenantType: 'individual';
    displayName: string;
    status: string;
  };
  activeMembership: PublicMembership;
  sessionToken: string;
}

export async function submitIndividualSignup(
  input: IndividualSignupInput,
  ipHash?: string,
  userAgentHash?: string,
): Promise<IndividualSignupSuccess> {
  const passwordError = validatePasswordStrength(input.password);
  if (passwordError) {
    throw new ValidationError(passwordError, 'WEAK_PASSWORD');
  }

  const email = normalizeEmail(input.email);
  const whatsapp = normalizePhone(input.whatsapp, input.country as CountryCode);
  const taxId = normalizeTaxId(input.taxId);
  const taxIdHash = hashLookup(taxId);
  const emailLookupHash = hashLookup(email);
  const displayName = `${input.firstName.trim()} ${input.lastName.trim()}`.trim();

  // Escopado por país: o mesmo taxIdHash pode legitimamente colidir entre países diferentes
  // (ex.: um CPF brasileiro e um SSN americano com a mesma sequência de dígitos). Tenants
  // criados antes do suporte multi-país têm country nulo — tratados como BR (única origem
  // possível pra eles), senão a checagem de duplicidade pararia de pegar duplicatas antigas.
  const existingTenant = await prisma.authTenant.findFirst({
    where:
      input.country === 'BR'
        ? { taxIdHash, OR: [{ country: 'BR' }, { country: null }] }
        : { taxIdHash, country: input.country },
  });
  if (
    existingTenant &&
    ['active', 'pending', 'pending_provisioning', 'provisioning_failed'].includes(
      existingTenant.status,
    )
  ) {
    throw input.country === 'BR'
      ? new ConflictError('Já existe um cadastro com este CPF.', 'CPF_ALREADY_EXISTS')
      : new ConflictError(
          'Já existe um cadastro com este documento fiscal.',
          'TAX_ID_ALREADY_EXISTS',
        );
  }

  const existingUser = await prisma.authUser.findUnique({ where: { emailLookupHash } });
  if (existingUser) {
    throw new ConflictError(
      'Este e-mail já está em uso. Faça login ou use outro e-mail.',
      'EMAIL_ALREADY_EXISTS',
    );
  }

  const tenantTextId = generateIndividualTenantId(input.firstName, input.lastName);
  const passwordHash = await hashPassword(input.password);

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
      },
    });

    await tx.authCredential.create({
      data: { userId: user.id, passwordHash },
    });

    const tenant = await tx.authTenant.create({
      data: {
        tenantId: tenantTextId,
        tenantType: 'individual',
        displayNameEncrypted: encryptField(displayName),
        displayNameLookupHash: hashLookup(displayName.toLowerCase()),
        slug: slugify(displayName),
        country: input.country,
        taxIdType: input.taxIdType,
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
        { membershipId: membership.id, role: 'individual_admin' },
        { membershipId: membership.id, role: 'user' },
      ],
    });

    await tx.authNotificationPreference.create({
      data: { membershipId: membership.id },
    });

    await recordTermsAcceptance(
      {
        flow: 'individual_registration',
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

  await logSignupCreatedAudits('individual_signup', {
    userId: created.user.id,
    tenantTextId: created.tenant.tenantId,
    targetMembershipId: created.membership.id,
    ipHash,
    userAgentHash,
  });

  const result = await finalizeSignupProvisioning({
    created,
    tenantType: 'individual',
    displayName,
    country: input.country,
    taxIdType: input.taxIdType,
    collectionPrefix: SHARED_INDIVIDUAL_COLLECTION_PREFIX,
    successMessage: 'Seu acesso CPF foi criado com sucesso.',
    provisioningFailureMessage: PROVISIONING_FAILURE_MESSAGE,
    auditPrefix: 'individual_signup',
    ipHash,
    userAgentHash,
  });

  return {
    ...result,
    tenant: {
      ...result.tenant,
      tenantType: 'individual',
    },
  };
}
