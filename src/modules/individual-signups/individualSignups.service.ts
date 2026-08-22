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
import type {
  IndividualSignupAttachInput,
  IndividualSignupInput,
} from './individualSignups.schemas.js';
import {
  assertUserCanAttachTenant,
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

/**
 * Cadastro PF em dois modos.
 *
 * Sem `attachToUserId`, cria um usuário novo com senha — o fluxo original. Com ele, o
 * usuário já existe e está autenticado (hoje: acabou de entrar por OAuth e ainda não tem
 * tenant); nesse caso não há senha nem e-mail no corpo, e o cadastro apenas anexa tenant e
 * membership à conta existente. Sem esse segundo modo quem entra pelo Google fica sem
 * saída: o callback do OAuth já criou o usuário, e criar de novo bate em EMAIL_ALREADY_EXISTS.
 */
export async function submitIndividualSignup(
  input: IndividualSignupInput | IndividualSignupAttachInput,
  ipHash?: string,
  userAgentHash?: string,
  options?: { attachToUserId?: string },
): Promise<IndividualSignupSuccess> {
  const attachToUserId = options?.attachToUserId;
  const credentials = attachToUserId ? null : (input as IndividualSignupInput);

  if (credentials) {
    const passwordError = validatePasswordStrength(credentials.password);
    if (passwordError) {
      throw new ValidationError(passwordError, 'WEAK_PASSWORD');
    }
  }

  const email = credentials ? normalizeEmail(credentials.email) : null;
  const whatsapp = normalizePhone(input.whatsapp, input.country as CountryCode);
  const taxId = normalizeTaxId(input.taxId);
  const taxIdHash = hashLookup(taxId);
  const emailLookupHash = email ? hashLookup(email) : null;
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

  if (emailLookupHash) {
    const existingUser = await prisma.authUser.findUnique({ where: { emailLookupHash } });
    if (existingUser) {
      throw new ConflictError(
        'Este e-mail já está em uso. Faça login ou use outro e-mail.',
        'EMAIL_ALREADY_EXISTS',
      );
    }
  } else {
    await assertUserCanAttachTenant(attachToUserId!);
  }

  const tenantTextId = generateIndividualTenantId(input.firstName, input.lastName);
  const passwordHash = credentials ? await hashPassword(credentials.password) : null;

  const created = await prisma.$transaction(async (tx) => {
    const profile = {
      firstNameEncrypted: encryptField(input.firstName),
      lastNameEncrypted: encryptField(input.lastName),
      whatsappEncrypted: encryptField(whatsapp),
      whatsappLookupHash: hashLookup(whatsapp),
      // Quem chega por OAuth nasce `pending_verification`; concluir o cadastro com um
      // e-mail que o provedor já verificou é o que ativa a conta.
      status: 'active' as const,
    };

    const user =
      attachToUserId && !email
        ? await tx.authUser.update({ where: { id: attachToUserId }, data: profile })
        : await tx.authUser.create({
            data: {
              emailEncrypted: encryptField(email!),
              emailLookupHash: emailLookupHash!,
              ...profile,
            },
          });

    if (passwordHash) {
      await tx.authCredential.create({
        data: { userId: user.id, passwordHash },
      });
    }

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
