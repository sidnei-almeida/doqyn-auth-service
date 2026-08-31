import type { AuthUser } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { provisionTenantInMainApp } from '../../integrations/appProvisioning.js';
import { hashSessionToken } from '../../security/crypto.js';
import { ConflictError, ValidationError } from '../../utils/errors.js';
import { logAuthAudit, type AuditAction } from '../audit/authAudit.service.js';
import type { PublicMembership } from '../memberships/memberships.schemas.js';
import { toPublicMembership } from '../memberships/memberships.service.js';
import { createSession } from '../sessions/sessions.service.js';
import type { PublicUser } from '../users/users.schemas.js';
import { toPublicUser } from '../users/users.service.js';

export type CreatedSignupEntities = {
  user: AuthUser;
  tenant: { id: string; tenantId: string };
  membership: { id: string };
};

export type SignupSuccessBase = {
  ok: true;
  message: string;
  user: PublicUser;
  tenant: {
    tenantId: string;
    tenantType: 'individual' | 'business';
    displayName: string;
    status: string;
  };
  activeMembership: PublicMembership;
  /**
   * Só existe quando o e-mail já está provado — hoje, quando o cadastro anexa uma conta que veio
   * de Google ou Microsoft. Cadastro por formulário não abre sessão: o endereço ainda é uma
   * afirmação, e entregar acesso aqui era o buraco que a verificação fecha.
   */
  sessionToken?: string;
  /** Quando presente, a conta existe mas está trancada até o código do e-mail ser conferido. */
  emailVerificationRequired?: true;
  /** O passe que autoriza pedir e conferir o código sem sessão. */
  verificationTicket?: string;
};

/**
 * Provisiona o tenant no app principal, ativa membership e — só se o e-mail já estiver provado —
 * abre sessão. Compartilhado por signup individual e empresa.
 */
export async function finalizeSignupProvisioning(input: {
  created: CreatedSignupEntities;
  tenantType: 'individual' | 'business';
  displayName: string;
  /** ISO 3166-1 alpha-2 do tenant (ex.: BR, PY, US, ES). */
  country: string;
  /** Tipo de documento fiscal detectado (ex.: cpf, cnpj, ruc, ssn, ein) — repassado ao Mongo, não fixo por tenantType. */
  taxIdType: string;
  collectionPrefix: string;
  successMessage: string;
  provisioningFailureMessage: string;
  auditPrefix: 'individual_signup' | 'company_signup';
  ipHash?: string;
  userAgentHash?: string;
}): Promise<SignupSuccessBase> {
  const auditBase = {
    userId: input.created.user.id,
    tenantTextId: input.created.tenant.tenantId,
    targetMembershipId: input.created.membership.id,
    ipHash: input.ipHash,
    userAgentHash: input.userAgentHash,
  };

  await logAuthAudit(`${input.auditPrefix}.provision_started` as AuditAction, auditBase);

  const provision = await provisionTenantInMainApp({
    tenantId: input.created.tenant.tenantId,
    tenantType: input.tenantType,
    displayName: input.displayName,
    country: input.country,
    taxIdType: input.taxIdType,
    collectionPrefix: input.collectionPrefix,
    createdByUserId: input.created.user.id,
    createdByMembershipId: input.created.membership.id,
  });

  if (!provision.ok) {
    await prisma.authTenant.update({
      where: { id: input.created.tenant.id },
      data: { status: 'provisioning_failed' },
    });

    await logAuthAudit(`${input.auditPrefix}.provision_failed` as AuditAction, {
      ...auditBase,
      metadata: { error: provision.error, statusCode: provision.statusCode },
    });

    throw new ValidationError(input.provisioningFailureMessage, 'TENANT_PROVISIONING_FAILED');
  }

  const activated = await prisma.$transaction(async (tx) => {
    const tenant = await tx.authTenant.update({
      where: { id: input.created.tenant.id },
      data: { status: 'active' },
    });

    const membership = await tx.authMembership.update({
      where: { id: input.created.membership.id },
      data: { status: 'active', approvedAt: new Date() },
      include: {
        tenant: true,
        roles: true,
        accessGroupLinks: { include: { accessGroup: true } },
      },
    });

    return { tenant, membership };
  });

  await logAuthAudit(`${input.auditPrefix}.provision_succeeded` as AuditAction, auditBase);

  const { awaitTenantMemberSync } = await import('../../integrations/memberSync.js');
  await awaitTenantMemberSync(activated.membership.id);

  const membershipWithRelations = await prisma.authMembership.findUniqueOrThrow({
    where: { id: activated.membership.id },
    include: {
      tenant: true,
      roles: true,
      accessGroupLinks: { include: { accessGroup: true } },
    },
  });

  const base = {
    ok: true as const,
    user: toPublicUser(input.created.user),
    tenant: {
      tenantId: activated.tenant.tenantId,
      tenantType: input.tenantType,
      displayName: input.displayName,
      status: activated.tenant.status,
    },
    activeMembership: toPublicMembership(membershipWithRelations),
  };

  // A empresa foi criada e o membership está ativo — o que falta é a prova de que o e-mail é de
  // quem se cadastrou. Sem ela não há sessão: era exatamente assim que alguém abria conta com o
  // endereço de outra pessoa e entrava no app no mesmo segundo.
  //
  // Quem anexou uma conta de Google ou Microsoft está isento; o provedor já fez a prova.
  const { hasLinkedOAuthAccount } = await import('../users/users.service.js');
  const emailAlreadyProven =
    input.created.user.emailVerified || (await hasLinkedOAuthAccount(input.created.user.id));

  if (!emailAlreadyProven) {
    const { sendEmailVerificationCode } =
      await import('../email-verification/emailVerification.service.js');
    const { issueEmailVerificationTicket } = await import('../../security/verificationTicket.js');

    // O envio não pode derrubar um cadastro que já criou empresa e membership. Se o e-mail não
    // sair, a pessoa pede outro código pela tela de confirmação.
    await sendEmailVerificationCode(input.created.user.id, input.ipHash).catch(() => undefined);

    return {
      ...base,
      message: 'Conta criada. Confirme seu e-mail para entrar.',
      emailVerificationRequired: true,
      verificationTicket: issueEmailVerificationTicket(input.created.user.id),
    };
  }

  const session = await createSession(input.created.user.id, input.ipHash, input.userAgentHash);
  await prisma.authSession.update({
    where: { sessionTokenHash: hashSessionToken(session.token) },
    data: { activeMembershipId: activated.membership.id },
  });

  return {
    ...base,
    message: input.successMessage,
    sessionToken: session.token,
  };
}

export async function logSignupCreatedAudits(
  prefix: 'individual_signup' | 'company_signup',
  auditBase: {
    userId: string;
    tenantTextId: string;
    targetMembershipId: string;
    ipHash?: string;
    userAgentHash?: string;
  },
): Promise<void> {
  await logAuthAudit(`${prefix}.requested` as AuditAction, auditBase);
  await logAuthAudit(`${prefix}.tenant_created` as AuditAction, auditBase);
  await logAuthAudit(`${prefix}.admin_created` as AuditAction, auditBase);
}

/**
 * Guarda do cadastro autenticado: a sessão só pode anexar um tenant se a conta ainda não
 * tiver nenhum vínculo. Sem isto, uma sessão válida criaria tenants em sequência, cada um
 * com um documento fiscal diferente.
 */
export async function assertUserCanAttachTenant(userId: string): Promise<void> {
  const existing = await prisma.authMembership.findFirst({
    where: { userId, status: { not: 'removed' } },
    select: { id: true },
  });

  if (existing) {
    throw new ConflictError(
      'Sua conta já está vinculada a um espaço de trabalho.',
      'MEMBERSHIP_ALREADY_EXISTS',
    );
  }
}
