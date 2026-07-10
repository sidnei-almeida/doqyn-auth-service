import type { InviteStatus, TenantRole } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { getPublicAppBaseUrl, isProduction, loadEnv } from '../../config/env.js';
import { decryptField, encryptField, hashInviteToken, hashLookup } from '../../security/crypto.js';
import { generateInviteToken } from '../../security/sessionToken.js';
import { hashPassword, validatePasswordStrength } from '../../security/password.js';
import {
  checkInviteAcceptRateLimit,
  checkInviteCreateRateLimit,
} from '../../security/rateLimit.js';
import {
  ConflictError,
  GoneError,
  NotFoundError,
  ValidationError,
} from '../../utils/errors.js';
import { normalizeEmail, normalizePhone } from '../../utils/normalize.js';
import { auditCtx, logAuthAudit } from '../audit/authAudit.service.js';
import { assertCanGrantRoles, resolveTenantScope } from '../admin/adminAuthorization.js';
import type { AdminActor } from '../admin/admin.types.js';
import { setMembershipRoles } from '../memberships/memberships.service.js';
import { findUserByEmailLookup, findUserById, getUserCredential, toPublicUser } from '../users/users.service.js';
import {
  getTenantFromDomain,
  resolveTenantSmtpTransport,
} from '../tenant-email/tenantOutboundEmail.service.js';
import { sendInviteEmail } from './inviteEmail.js';
import type { AcceptInviteInput, CreateInviteInput } from './invites.schemas.js';
import { recordTermsAcceptance } from '../terms/termsAcceptance.service.js';
import { createSession } from '../sessions/sessions.service.js';
import { hashSessionToken } from '../../security/crypto.js';
import { awaitTenantMemberSync } from '../../integrations/memberSync.js';

const DEFAULT_INVITE_ROLES: TenantRole[] = ['user'];
const INVITE_ACCESS_REASON = 'Acesso concedido via convite administrativo.';

function normalizeRoles(roles: TenantRole[]): TenantRole[] {
  const unique = [...new Set(roles.length ? roles : DEFAULT_INVITE_ROLES)];
  if (!unique.includes('user')) {
    unique.push('user');
  }
  return unique;
}

function invitePathForToken(token: string): string {
  return `/convite/${encodeURIComponent(token)}`;
}

function buildInviteLink(token: string): string {
  const env = loadEnv();
  const baseUrl = getPublicAppBaseUrl(env);
  return `${baseUrl}${invitePathForToken(token)}`;
}

async function expireStaleInvites(): Promise<void> {
  const now = new Date();
  await prisma.authInvite.updateMany({
    where: {
      status: 'pending',
      expiresAt: { lte: now },
    },
    data: { status: 'expired' },
  });
}

async function getTenantUuid(actor: AdminActor, requestedTenantId?: string) {
  const tenantTextId = resolveTenantScope(actor, requestedTenantId);
  const tenant = await prisma.authTenant.findUnique({ where: { tenantId: tenantTextId } });
  if (!tenant) {
    throw new NotFoundError('Empresa não encontrada.');
  }
  return tenant;
}

async function findInviteByToken(token: string) {
  await expireStaleInvites();
  const tokenHash = hashInviteToken(token);
  return prisma.authInvite.findUnique({
    where: { tokenHash },
    include: {
      roles: true,
      tenant: true,
    },
  });
}

export async function createInvite(
  actor: AdminActor,
  input: CreateInviteInput,
  ipHash?: string,
) {
  if (ipHash) {
    checkInviteCreateRateLimit(ipHash);
  }

  const email = normalizeEmail(input.email);
  const roles = normalizeRoles(input.roles as TenantRole[]);
  assertCanGrantRoles(actor, roles);

  const tenant = await getTenantUuid(actor, input.tenantId);
  const emailLookupHash = hashLookup(email);
  const expiresAt = new Date(
    Date.now() + loadEnv().INVITE_TTL_DAYS * 24 * 60 * 60 * 1000,
  );
  const token = generateInviteToken();
  const tokenHash = hashInviteToken(token);
  const firstName = input.firstName?.trim() || '';
  const lastName = input.lastName?.trim() || '';

  const existingMembership = await prisma.authMembership.findFirst({
    where: {
      tenantId: tenant.id,
      user: { emailLookupHash },
      status: { in: ['active', 'pending'] },
    },
  });
  if (existingMembership) {
    throw new ConflictError(
      'Este e-mail já possui vínculo com a empresa.',
      'MEMBER_ALREADY_EXISTS',
    );
  }

  const existingPending = await prisma.authInvite.findFirst({
    where: {
      tenantId: tenant.id,
      emailLookupHash,
      status: 'pending',
      expiresAt: { gt: new Date() },
    },
    include: { roles: true },
  });

  let inviteId: string;
  if (existingPending) {
    const updated = await prisma.$transaction(async (tx) => {
      await tx.authInviteRole.deleteMany({ where: { inviteId: existingPending.id } });
      const invite = await tx.authInvite.update({
        where: { id: existingPending.id },
        data: {
          tokenHash,
          expiresAt,
          invitedByUserId: actor.userId,
          invitedByMembershipId: actor.membership.membershipId,
          firstNameEncrypted: firstName ? encryptField(firstName) : null,
          lastNameEncrypted: lastName ? encryptField(lastName) : null,
          status: 'pending',
          acceptedAt: null,
          acceptedByUserId: null,
          acceptedMembershipId: null,
        },
      });
      await tx.authInviteRole.createMany({
        data: roles.map((role) => ({ inviteId: invite.id, role })),
      });
      return invite;
    });
    inviteId = updated.id;
  } else {
    const created = await prisma.$transaction(async (tx) => {
      const invite = await tx.authInvite.create({
        data: {
          tenantId: tenant.id,
          emailEncrypted: encryptField(email),
          emailLookupHash,
          firstNameEncrypted: firstName ? encryptField(firstName) : null,
          lastNameEncrypted: lastName ? encryptField(lastName) : null,
          invitedByUserId: actor.userId,
          invitedByMembershipId: actor.membership.membershipId,
          tokenHash,
          expiresAt,
        },
      });
      await tx.authInviteRole.createMany({
        data: roles.map((role) => ({ inviteId: invite.id, role })),
      });
      return invite;
    });
    inviteId = created.id;
  }

  const inviteLink = buildInviteLink(token);
  const tenantDisplayName = tenant.displayNameEncrypted
    ? decryptField(tenant.displayNameEncrypted)
    : tenant.tenantId;

  const inviter = await findUserById(actor.userId);
  const inviterPublic = inviter ? toPublicUser(inviter) : null;
  const inviterName =
    [inviterPublic?.firstName, inviterPublic?.lastName].filter(Boolean).join(' ').trim() ||
    inviterPublic?.email ||
    'Administrador';
  const inviterEmail = inviterPublic?.email ?? '';
  const smtpTransport = await resolveTenantSmtpTransport(tenant.id);
  const fromDomain = await getTenantFromDomain(tenant.id);

  const emailResult = await sendInviteEmail({
    to: email,
    tenantDisplayName,
    invitePath: invitePathForToken(token),
    inviterName,
    inviterEmail,
    tenantUuid: tenant.id,
    smtpTransport,
    fromDomain,
    expiresInDays: loadEnv().INVITE_TTL_DAYS,
  });

  await logAuthAudit(
    'invite.created',
    auditCtx(actor, {
      tenantTextId: tenant.tenantId,
      metadata: {
        inviteId,
        emailLookupHash,
        roles,
        resent: Boolean(existingPending),
        emailSent: emailResult.sent,
        emailSkipReason: emailResult.reason,
      },
      ipHash,
    }),
  );

  const response: {
    ok: true;
    invite: {
      id: string;
      email: string;
      roles: TenantRole[];
      expiresAt: string;
      status: InviteStatus;
    };
    inviteLink: string;
    inviteToken?: string;
    emailSent: boolean;
    emailSkipReason?: string;
  } = {
    ok: true,
    invite: {
      id: inviteId,
      email,
      roles,
      expiresAt: expiresAt.toISOString(),
      status: 'pending',
    },
    inviteLink,
    emailSent: emailResult.sent,
    ...(emailResult.reason ? { emailSkipReason: emailResult.reason } : {}),
  };

  if (!isProduction(loadEnv())) {
    response.inviteToken = token;
  }

  return response;
}

export async function getInviteByToken(token: string) {
  const invite = await findInviteByToken(token);
  if (!invite) {
    throw new NotFoundError('Convite inválido ou expirado.', 'INVITE_NOT_FOUND');
  }

  if (invite.status === 'revoked') {
    throw new GoneError('Este convite foi revogado.', 'INVITE_REVOKED');
  }
  if (invite.status === 'accepted') {
    throw new GoneError('Este convite já foi utilizado.', 'INVITE_ALREADY_USED');
  }
  if (invite.status === 'expired' || invite.expiresAt <= new Date()) {
    throw new GoneError('Este convite expirou.', 'INVITE_EXPIRED');
  }

  const email = decryptField(invite.emailEncrypted);
  const existingUser = await findUserByEmailLookup(email);
  const existingCredential = existingUser ? await getUserCredential(existingUser.id) : null;

  return {
    ok: true,
    invite: {
      email,
      firstName: invite.firstNameEncrypted ? decryptField(invite.firstNameEncrypted) : undefined,
      lastName: invite.lastNameEncrypted ? decryptField(invite.lastNameEncrypted) : undefined,
      tenantDisplayName: invite.tenant.displayNameEncrypted
        ? decryptField(invite.tenant.displayNameEncrypted)
        : invite.tenant.tenantId,
      tenantTaxIdMasked: invite.tenant.taxIdMasked ?? undefined,
      roles: invite.roles.map((role) => role.role),
      expiresAt: invite.expiresAt.toISOString(),
      requiresAccountCreation: !existingUser,
      requiresPassword: !existingCredential,
      requiresWhatsapp: !existingUser?.whatsappEncrypted,
    },
  };
}

export async function acceptInvite(
  token: string,
  input: AcceptInviteInput,
  ipHash?: string,
  userAgentHash?: string,
) {
  if (ipHash) {
    checkInviteAcceptRateLimit(ipHash);
  }

  const invite = await findInviteByToken(token);
  if (!invite) {
    throw new NotFoundError('Convite inválido ou expirado.', 'INVITE_NOT_FOUND');
  }
  if (invite.status === 'revoked') {
    throw new GoneError('Este convite foi revogado.', 'INVITE_REVOKED');
  }
  if (invite.status === 'accepted') {
    throw new GoneError('Este convite já foi utilizado.', 'INVITE_ALREADY_USED');
  }
  if (invite.status === 'expired' || invite.expiresAt <= new Date()) {
    throw new GoneError('Este convite expirou.', 'INVITE_EXPIRED');
  }
  if (invite.status !== 'pending') {
    throw new GoneError('Este convite não está mais disponível.', 'INVITE_UNAVAILABLE');
  }

  const email = decryptField(invite.emailEncrypted);
  const roles = invite.roles.map((role) => role.role);
  const existingUser = await findUserByEmailLookup(email);
  const existingCredential = existingUser ? await getUserCredential(existingUser.id) : null;
  const requiresPassword = !existingCredential;
  const passwordInput = input.password?.trim() ?? '';

  if (existingUser) {
    const duplicate = await prisma.authMembership.findFirst({
      where: {
        tenantId: invite.tenantId,
        userId: existingUser.id,
        status: { in: ['active', 'pending', 'blocked'] },
      },
    });
    if (duplicate) {
      throw new ConflictError(
        'Este e-mail já possui acesso nesta empresa.',
        'MEMBER_ALREADY_EXISTS',
      );
    }
  }

  const firstName =
    input.firstName?.trim() ||
    (invite.firstNameEncrypted ? decryptField(invite.firstNameEncrypted) : '');
  const lastName =
    input.lastName?.trim() ||
    (invite.lastNameEncrypted ? decryptField(invite.lastNameEncrypted) : '');
  const jobTitle = input.jobTitle.trim();
  const departmentText = input.departmentText.trim();
  const whatsappInput = input.whatsapp?.trim() ?? '';
  const requiresWhatsapp = !existingUser?.whatsappEncrypted;

  if (!existingUser) {
    if (!firstName || !lastName) {
      throw new ValidationError('Nome e sobrenome são obrigatórios.', 'VALIDATION_ERROR');
    }
    const passwordError = validatePasswordStrength(passwordInput);
    if (passwordError) {
      throw new ValidationError(passwordError, 'WEAK_PASSWORD');
    }
    if (!whatsappInput) {
      throw new ValidationError('Informe um WhatsApp válido.', 'VALIDATION_ERROR');
    }
  } else {
    if (requiresPassword) {
      const passwordError = validatePasswordStrength(passwordInput);
      if (passwordError) {
        throw new ValidationError(passwordError, 'WEAK_PASSWORD');
      }
    }
    if (requiresWhatsapp && !whatsappInput) {
      throw new ValidationError('Informe um WhatsApp válido.', 'VALIDATION_ERROR');
    }
  }

  const whatsapp = whatsappInput ? normalizePhone(whatsappInput) : null;

  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    let userId = existingUser?.id;
    let passwordWasSet = false;

    if (!userId) {
      const passwordHash = await hashPassword(passwordInput);
      passwordWasSet = true;
      const user = await tx.authUser.create({
        data: {
          emailEncrypted: encryptField(email),
          emailLookupHash: hashLookup(email),
          firstNameEncrypted: encryptField(firstName),
          lastNameEncrypted: encryptField(lastName),
          whatsappEncrypted: encryptField(whatsapp!),
          whatsappLookupHash: hashLookup(whatsapp!),
          status: 'active',
        },
      });
      await tx.authCredential.create({
        data: { userId: user.id, passwordHash },
      });
      userId = user.id;
    } else if (requiresPassword) {
      const passwordHash = await hashPassword(passwordInput);
      await tx.authCredential.create({
        data: { userId, passwordHash },
      });
      passwordWasSet = true;
      await tx.authUser.update({
        where: { id: userId },
        data: {
          firstNameEncrypted: encryptField(firstName),
          lastNameEncrypted: encryptField(lastName),
          ...(whatsapp
            ? {
                whatsappEncrypted: encryptField(whatsapp),
                whatsappLookupHash: hashLookup(whatsapp),
              }
            : {}),
        },
      });
    } else if (whatsapp) {
      await tx.authUser.update({
        where: { id: userId },
        data: {
          firstNameEncrypted: encryptField(firstName),
          lastNameEncrypted: encryptField(lastName),
          whatsappEncrypted: encryptField(whatsapp),
          whatsappLookupHash: hashLookup(whatsapp),
        },
      });
    } else {
      await tx.authUser.update({
        where: { id: userId },
        data: {
          firstNameEncrypted: encryptField(firstName),
          lastNameEncrypted: encryptField(lastName),
        },
      });
    }

    const membership = await tx.authMembership.create({
      data: {
        userId,
        tenantId: invite.tenantId,
        status: 'active',
        approvedAt: now,
        approvedByMembershipId: invite.invitedByMembershipId,
        requestedJobTitleEncrypted: encryptField(jobTitle),
        requestedDepartmentEncrypted: encryptField(departmentText),
        requestedReasonEncrypted: encryptField(INVITE_ACCESS_REASON),
      },
    });

    await tx.authNotificationPreference.create({
      data: {
        membershipId: membership.id,
        email: input.operationalNotificationsConsent,
        whatsapp: input.operationalNotificationsConsent,
      },
    });

    await recordTermsAcceptance(
      {
        flow: 'invite_accept',
        termsVersion: input.acceptedTermsVersion,
        userId,
        membershipId: membership.id,
        tenantId: invite.tenantId,
        ipAddressHash: ipHash,
      },
      tx,
    );

    await tx.authInvite.update({
      where: { id: invite.id },
      data: {
        status: 'accepted',
        acceptedAt: now,
        acceptedByUserId: userId,
        acceptedMembershipId: membership.id,
      },
    });

    return { membershipId: membership.id, userId, passwordWasSet };
  });

  await setMembershipRoles(result.membershipId, roles);
  await awaitTenantMemberSync(result.membershipId);

  let sessionToken: string | undefined;
  if (result.passwordWasSet) {
    const session = await createSession(result.userId, ipHash, userAgentHash);
    await prisma.authSession.update({
      where: { sessionTokenHash: hashSessionToken(session.token) },
      data: { activeMembershipId: result.membershipId },
    });
    sessionToken = session.token;
  }

  await logAuthAudit('invite.accepted', {
    userId: result.userId,
    targetMembershipId: result.membershipId,
    tenantTextId: invite.tenant.tenantId,
    metadata: { inviteId: invite.id },
    ipHash,
  });

  return {
    ok: true,
    message: sessionToken
      ? 'Convite aceito com sucesso. Sua sessão foi iniciada.'
      : 'Convite aceito com sucesso. Entre com sua senha atual para acessar o DOQYN.',
    membershipId: result.membershipId,
    requiresLogin: !sessionToken,
    sessionEstablished: Boolean(sessionToken),
    sessionToken,
  };
}

export async function revokeInvite(actor: AdminActor, inviteId: string, ipHash?: string) {
  const invite = await prisma.authInvite.findUnique({
    where: { id: inviteId },
    include: { tenant: true },
  });
  if (!invite) {
    throw new NotFoundError('Convite não encontrado.');
  }

  resolveTenantScope(actor, invite.tenant.tenantId);

  if (invite.status !== 'pending') {
    throw new ConflictError('Apenas convites pendentes podem ser revogados.', 'INVITE_NOT_PENDING');
  }

  await prisma.authInvite.update({
    where: { id: inviteId },
    data: { status: 'revoked' },
  });

  await logAuthAudit(
    'invite.revoked',
    auditCtx(actor, {
      tenantTextId: invite.tenant.tenantId,
      metadata: { inviteId },
      ipHash,
    }),
  );

  return { ok: true, inviteId, status: 'revoked' as const };
}
