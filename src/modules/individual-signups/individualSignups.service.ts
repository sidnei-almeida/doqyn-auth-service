import { prisma } from '../../db/prisma.js';
import { provisionTenantInMainApp } from '../../integrations/appProvisioning.js';
import { encryptField, hashLookup, hashSessionToken } from '../../security/crypto.js';
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
import { generateIndividualTenantId } from '../../utils/tenantId.js';
import { logAuthAudit } from '../audit/authAudit.service.js';
import type { PublicMembership } from '../memberships/memberships.schemas.js';
import { toPublicMembership } from '../memberships/memberships.service.js';
import { createSession } from '../sessions/sessions.service.js';
import type { PublicUser } from '../users/users.schemas.js';
import { toPublicUser } from '../users/users.service.js';
import type { IndividualSignupInput } from './individualSignups.schemas.js';

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
  const whatsapp = normalizePhone(input.whatsapp);
  const taxId = normalizeTaxId(input.taxId);
  const taxIdHash = hashLookup(taxId);
  const emailLookupHash = hashLookup(email);
  const displayName = `${input.firstName.trim()} ${input.lastName.trim()}`.trim();

  const existingTenant = await prisma.authTenant.findFirst({ where: { taxIdHash } });
  if (
    existingTenant &&
    ['active', 'pending', 'pending_provisioning', 'provisioning_failed'].includes(
      existingTenant.status,
    )
  ) {
    throw new ConflictError('Já existe um cadastro com este CPF.', 'CPF_ALREADY_EXISTS');
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
        { membershipId: membership.id, role: 'individual_admin' },
        { membershipId: membership.id, role: 'user' },
      ],
    });

    await tx.authNotificationPreference.create({
      data: { membershipId: membership.id },
    });

    return { user, tenant, membership };
  });

  const auditBase = {
    userId: created.user.id,
    tenantTextId: created.tenant.tenantId,
    targetMembershipId: created.membership.id,
    ipHash,
    userAgentHash,
  };

  await logAuthAudit('individual_signup.requested', auditBase);
  await logAuthAudit('individual_signup.tenant_created', auditBase);
  await logAuthAudit('individual_signup.admin_created', auditBase);
  await logAuthAudit('individual_signup.provision_started', auditBase);

  const provision = await provisionTenantInMainApp({
    tenantId: created.tenant.tenantId,
    tenantType: 'individual',
    displayName,
    collectionPrefix: SHARED_INDIVIDUAL_COLLECTION_PREFIX,
    createdByUserId: created.user.id,
    createdByMembershipId: created.membership.id,
  });

  if (!provision.ok) {
    await prisma.authTenant.update({
      where: { id: created.tenant.id },
      data: { status: 'provisioning_failed' },
    });

    await logAuthAudit('individual_signup.provision_failed', {
      ...auditBase,
      metadata: { error: provision.error, statusCode: provision.statusCode },
    });

    throw new ValidationError(PROVISIONING_FAILURE_MESSAGE, 'PROVISIONING_FAILED');
  }

  const activated = await prisma.$transaction(async (tx) => {
    const tenant = await tx.authTenant.update({
      where: { id: created.tenant.id },
      data: { status: 'active' },
    });

    const membership = await tx.authMembership.update({
      where: { id: created.membership.id },
      data: { status: 'active', approvedAt: new Date() },
      include: {
        tenant: true,
        roles: true,
        accessGroupLinks: { include: { accessGroup: true } },
      },
    });

    return { tenant, membership };
  });

  await logAuthAudit('individual_signup.provision_succeeded', auditBase);

  const session = await createSession(created.user.id, ipHash, userAgentHash);
  await prisma.authSession.update({
    where: { sessionTokenHash: hashSessionToken(session.token) },
    data: { activeMembershipId: activated.membership.id },
  });

  const membershipWithRelations = await prisma.authMembership.findUniqueOrThrow({
    where: { id: activated.membership.id },
    include: {
      tenant: true,
      roles: true,
      accessGroupLinks: { include: { accessGroup: true } },
    },
  });

  return {
    ok: true,
    message: 'Seu acesso CPF foi criado com sucesso.',
    user: toPublicUser(created.user),
    tenant: {
      tenantId: activated.tenant.tenantId,
      tenantType: 'individual',
      displayName,
      status: activated.tenant.status,
    },
    activeMembership: toPublicMembership(membershipWithRelations),
    sessionToken: session.token,
  };
}
