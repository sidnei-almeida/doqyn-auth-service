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
import { generateBusinessTenantId } from '../../utils/tenantId.js';
import { recordTermsAcceptance } from '../terms/termsAcceptance.service.js';
import type { PublicMembership } from '../memberships/memberships.schemas.js';
import { buildSessionContext } from '../memberships/sessionContext.service.js';
import type { PublicUser } from '../users/users.schemas.js';
import { toPublicUser } from '../users/users.service.js';
import type {
  CompanySignupAttachInput,
  CompanySignupInput,
} from './companySignups.schemas.js';
import {
  assertUserCanAttachTenant,
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

/** Dois modos, mesma lógica do cadastro PF — ver `individualSignups.service.ts`. */
export async function submitCompanySignup(
  input: CompanySignupInput | CompanySignupAttachInput,
  ipHash?: string,
  userAgentHash?: string,
  options?: { attachToUserId?: string },
): Promise<CompanySignupSuccess> {
  const attachToUserId = options?.attachToUserId;
  const credentials = attachToUserId ? null : (input as CompanySignupInput);

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

  // Escopado por país: o mesmo taxIdHash pode legitimamente colidir entre países diferentes
  // (ex.: um CNPJ brasileiro e um RUC paraguaio com a mesma sequência de dígitos). Tenants
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
    throw new ConflictError(
      'Já existe uma empresa cadastrada com este documento fiscal.',
      'COMPANY_ALREADY_EXISTS',
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

  const tenantTextId = generateBusinessTenantId(input.companyName);
  const collectionPrefix = tenantTextId;
  const passwordHash = credentials ? await hashPassword(credentials.password) : null;
  const displayName = input.companyName.trim();

  const created = await prisma.$transaction(async (tx) => {
    const profile = {
      firstNameEncrypted: encryptField(input.firstName),
      lastNameEncrypted: encryptField(input.lastName),
      whatsappEncrypted: encryptField(whatsapp),
      whatsappLookupHash: hashLookup(whatsapp),
      status: 'active' as const,
    };

    // `emailVerified` só é afirmado ao criar a conta neste fluxo. No modo de anexar, quem
    // responde pela verificação é o provedor que autenticou a sessão, e nem todo provedor
    // garante isso — o Microsoft Entra só emite a claim equivalente (`xms_edov`) quando ela
    // é habilitada no app registration. Sobrescrever aqui carimbaria verificado sem prova.
    const createOnlyFields = { emailVerified: true };

    const user =
      attachToUserId && !email
        ? await tx.authUser.update({ where: { id: attachToUserId }, data: profile })
        : await tx.authUser.create({
            data: {
              emailEncrypted: encryptField(email!),
              emailLookupHash: emailLookupHash!,
              ...profile,
              ...createOnlyFields,
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
        tenantType: 'business',
        displayNameEncrypted: encryptField(displayName),
        displayNameLookupHash: hashLookup(displayName.toLowerCase()),
        slug: slugify(input.companyName),
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
    country: input.country,
    taxIdType: input.taxIdType,
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
