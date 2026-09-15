import type { AuthUser } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { encryptField, hashLookup } from '../../security/crypto.js';
import { normalizeEmail } from '../../utils/normalize.js';
import { logAuthAudit } from '../audit/authAudit.service.js';
import {
  claimUsername,
  findUserByEmailLookup,
  isUserLoginAllowed,
  toPublicUser,
} from '../users/users.service.js';
import type { PublicUser } from '../users/users.schemas.js';
import type { OAuthIdentity, OAuthPostLoginStatus } from './oauth.types.js';
import { redactEmail } from './oauth.config.js';
import { listUserMemberships } from '../memberships/memberships.service.js';
import { resolveMembershipAccessError } from '../../utils/membershipAccessErrors.js';

export async function findOAuthAccount(provider: string, providerSubject: string) {
  return prisma.authOAuthAccount.findUnique({
    where: {
      provider_providerSubject: {
        provider,
        providerSubject,
      },
    },
    include: { user: true },
  });
}

function splitDisplayName(displayName: string | null): { firstName?: string; lastName?: string } {
  if (!displayName?.trim()) return {};
  const parts = displayName.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

async function createOAuthUser(identity: OAuthIdentity): Promise<PublicUser> {
  if (!identity.email) {
    throw new Error('OAUTH_EMAIL_REQUIRED');
  }

  const normalizedEmail = normalizeEmail(identity.email);
  const emailLookupHash = hashLookup(normalizedEmail);
  const { firstName, lastName } = splitDisplayName(identity.displayName);

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.authUser.create({
      data: {
        emailEncrypted: encryptField(normalizedEmail),
        emailLookupHash,
        firstNameEncrypted: firstName ? encryptField(firstName) : null,
        lastNameEncrypted: lastName ? encryptField(lastName) : null,
        // Quem entra pelo Google ou pela Microsoft não escolhe apelido em formulário nenhum, e
        // sem ele a conta nasce invisível ao diretório — para sempre, porque não há tela de
        // trocar handle depois. Derivado do e-mail é o mesmo tratamento do backfill.
        username: await claimUsername(tx, undefined, normalizedEmail),
        status: 'pending_verification',
        emailVerified: identity.emailVerified,
      },
    });

    await tx.authOAuthAccount.create({
      data: {
        userId: created.id,
        provider: identity.provider,
        providerSubject: identity.subject,
        providerTenantId: identity.providerTenantId,
        email: normalizedEmail,
        emailVerified: identity.emailVerified,
        displayName: identity.displayName,
        avatarUrl: identity.avatarUrl,
        lastLoginAt: new Date(),
      },
    });

    return created;
  });

  await logAuthAudit('auth.oauth_user_created', {
    userId: user.id,
    metadata: {
      provider: identity.provider,
      email: redactEmail(normalizedEmail),
      providerTenantId: identity.providerTenantId,
    },
  });

  return toPublicUser(user);
}

/**
 * Liga a identidade do provedor a uma conta que já existia com o mesmo e-mail.
 *
 * Se essa conta nunca provou o e-mail, a senha dela não é de confiança: qualquer pessoa pode abrir
 * conta por formulário com o endereço de outra e esperar. Sem descartar a senha, o dono verdadeiro
 * entrava pelo Google numa conta cuja senha o invasor conhecia — e o vínculo ainda destravava o
 * login por senha dele. O provedor acabou de provar o e-mail, então a conta passa a verificada, a
 * senha some e as sessões caem, tudo na mesma transação do vínculo. Quem quiser senha pede reset.
 */
async function linkOAuthAccount(existingUser: AuthUser, identity: OAuthIdentity): Promise<void> {
  const normalizedEmail = identity.email ? normalizeEmail(identity.email) : null;
  const discardUntrustedPassword = !existingUser.emailVerified;

  await prisma.$transaction(async (tx) => {
    await tx.authOAuthAccount.create({
      data: {
        userId: existingUser.id,
        provider: identity.provider,
        providerSubject: identity.subject,
        providerTenantId: identity.providerTenantId,
        email: normalizedEmail,
        emailVerified: identity.emailVerified,
        displayName: identity.displayName,
        avatarUrl: identity.avatarUrl,
        lastLoginAt: new Date(),
      },
    });

    if (!discardUntrustedPassword) return;

    await tx.authCredential.deleteMany({ where: { userId: existingUser.id } });
    await tx.authSession.updateMany({
      where: { userId: existingUser.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.authUser.update({
      where: { id: existingUser.id },
      data: { emailVerified: true },
    });
  });

  await logAuthAudit('auth.oauth_account_linked', {
    userId: existingUser.id,
    metadata: {
      provider: identity.provider,
      email: redactEmail(normalizedEmail),
      providerTenantId: identity.providerTenantId,
      untrustedPasswordDiscarded: discardUntrustedPassword,
    },
  });
}

export function resolveOAuthPostLoginStatus(
  memberships: Awaited<ReturnType<typeof listUserMemberships>>,
): OAuthPostLoginStatus {
  const activeMemberships = memberships.filter(
    (membership) => membership.status === 'active' && membership.tenant.status === 'active',
  );
  const visibleMemberships = memberships.filter((membership) => membership.status !== 'removed');

  if (activeMemberships.length > 0) {
    return 'success';
  }

  if (visibleMemberships.length === 0) {
    return 'onboarding_required';
  }

  const accessError = resolveMembershipAccessError(memberships);
  switch (accessError.code) {
    case 'MEMBERSHIP_PENDING':
      return 'membership_pending';
    case 'TENANT_PROVISIONING_FAILED':
      return 'membership_pending';
    case 'MEMBERSHIP_BLOCKED':
      return 'membership_blocked';
    case 'MEMBERSHIP_REJECTED':
      return 'membership_rejected';
    default:
      return 'onboarding_required';
  }
}

export async function resolveOAuthUser(identity: OAuthIdentity): Promise<{
  user: PublicUser;
  linked: boolean;
  created: boolean;
  postLoginStatus: OAuthPostLoginStatus;
}> {
  const existingOAuth = await findOAuthAccount(identity.provider, identity.subject);

  if (existingOAuth) {
    if (!isUserLoginAllowed(existingOAuth.user.status)) {
      throw new Error('USER_DISABLED');
    }

    await prisma.authOAuthAccount.update({
      where: { id: existingOAuth.id },
      data: { lastLoginAt: new Date() },
    });

    const memberships = await listUserMemberships(existingOAuth.user.id);
    return {
      user: toPublicUser(existingOAuth.user),
      linked: false,
      created: false,
      postLoginStatus: resolveOAuthPostLoginStatus(memberships),
    };
  }

  if (identity.email) {
    const existingUser = await findUserByEmailLookup(identity.email);

    if (existingUser) {
      if (!identity.emailVerified) {
        throw new Error('OAUTH_EMAIL_NOT_VERIFIED');
      }

      if (!isUserLoginAllowed(existingUser.status)) {
        throw new Error('USER_DISABLED');
      }

      await linkOAuthAccount(existingUser, identity);

      const memberships = await listUserMemberships(existingUser.id);
      return {
        user: toPublicUser({ ...existingUser, emailVerified: true }),
        linked: true,
        created: false,
        postLoginStatus: resolveOAuthPostLoginStatus(memberships),
      };
    }
  }

  const user = await createOAuthUser(identity);
  return {
    user,
    linked: false,
    created: true,
    postLoginStatus: 'onboarding_required',
  };
}
