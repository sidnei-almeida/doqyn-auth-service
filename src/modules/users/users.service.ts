import type { AuthUser, AuthUserStatus } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import {
  decryptField,
  encryptField,
  hashLookup,
} from '../../security/crypto.js';
import { hashPassword } from '../../security/password.js';
import { normalizeEmail, normalizePhone } from '../../utils/normalize.js';
import type { PublicUser } from './users.schemas.js';

export function toPublicUser(user: AuthUser): PublicUser {
  return {
    id: user.id,
    email: decryptField(user.emailEncrypted),
    firstName: user.firstNameEncrypted ? decryptField(user.firstNameEncrypted) : null,
    lastName: user.lastNameEncrypted ? decryptField(user.lastNameEncrypted) : null,
    whatsapp: user.whatsappEncrypted ? decryptField(user.whatsappEncrypted) : null,
    status: user.status,
    emailVerified: user.emailVerified,
    ...(user.lastLoginAt ? { lastLoginAt: user.lastLoginAt.toISOString() } : {}),
    avatarVersion: user.avatarVersion ?? 0,
    ...(user.avatarUpdatedAt ? { avatarUpdatedAt: user.avatarUpdatedAt.toISOString() } : {}),
    avatarStatus:
      user.avatarStatus === 'active' || user.avatarStatus === 'removed'
        ? user.avatarStatus
        : null,
  };
}

export interface CreateUserInput {
  email: string;
  firstName?: string;
  lastName?: string;
  whatsapp?: string;
  temporaryPassword?: string;
}

export async function findUserByEmailLookup(email: string): Promise<AuthUser | null> {
  const normalized = normalizeEmail(email);
  const emailLookupHash = hashLookup(normalized);
  return prisma.authUser.findUnique({ where: { emailLookupHash } });
}

export async function findUserById(id: string): Promise<AuthUser | null> {
  return prisma.authUser.findUnique({ where: { id } });
}

export async function createOrGetUser(input: CreateUserInput): Promise<PublicUser> {
  const normalizedEmail = normalizeEmail(input.email);
  const emailLookupHash = hashLookup(normalizedEmail);

  const existing = await prisma.authUser.findUnique({ where: { emailLookupHash } });
  if (existing) {
    return toPublicUser(existing);
  }

  const whatsappNormalized = input.whatsapp ? normalizePhone(input.whatsapp) : null;

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.authUser.create({
      data: {
        emailEncrypted: encryptField(normalizedEmail),
        emailLookupHash,
        firstNameEncrypted: input.firstName ? encryptField(input.firstName) : null,
        lastNameEncrypted: input.lastName ? encryptField(input.lastName) : null,
        whatsappEncrypted: whatsappNormalized ? encryptField(whatsappNormalized) : null,
        whatsappLookupHash: whatsappNormalized ? hashLookup(whatsappNormalized) : null,
        status: 'active',
      },
    });

    if (input.temporaryPassword) {
      const passwordHash = await hashPassword(input.temporaryPassword);
      await tx.authCredential.create({
        data: {
          userId: created.id,
          passwordHash,
        },
      });
    }

    return created;
  });

  return toPublicUser(user);
}

export async function disableUser(userId: string): Promise<PublicUser> {
  const user = await prisma.authUser.update({
    where: { id: userId },
    data: { status: 'disabled' },
  });
  return toPublicUser(user);
}

export async function enableUser(userId: string): Promise<PublicUser> {
  const user = await prisma.authUser.update({
    where: { id: userId },
    data: { status: 'active' },
  });
  return toPublicUser(user);
}

export async function updateUserPassword(userId: string, newPassword: string): Promise<void> {
  const passwordHash = await hashPassword(newPassword);
  await prisma.authCredential.upsert({
    where: { userId },
    create: {
      userId,
      passwordHash,
    },
    update: {
      passwordHash,
      passwordUpdatedAt: new Date(),
    },
  });
}

export async function getUserCredential(userId: string) {
  return prisma.authCredential.findUnique({ where: { userId } });
}

export async function updateUserEmail(userId: string, email: string): Promise<PublicUser> {
  const normalized = normalizeEmail(email);
  const emailLookupHash = hashLookup(normalized);

  const user = await prisma.authUser.update({
    where: { id: userId },
    data: {
      emailEncrypted: encryptField(normalized),
      emailLookupHash,
      emailVerified: true,
    },
  });

  return toPublicUser(user);
}

export function isUserLoginAllowed(status: AuthUserStatus): boolean {
  return status === 'active' || status === 'pending_verification';
}

export type UpdateUserAvatarMetadataInput = {
  storageProvider?: 'r2' | 'local' | null;
  objectKey?: string | null;
  contentType?: string | null;
  version: number;
  size?: number | null;
  status: 'active' | 'removed';
};

export async function updateUserAvatarMetadata(
  userId: string,
  input: UpdateUserAvatarMetadataInput,
): Promise<PublicUser> {
  const user = await prisma.authUser.update({
    where: { id: userId },
    data: {
      avatarStorageProvider: input.storageProvider ?? null,
      avatarObjectKey: input.objectKey ?? null,
      avatarContentType: input.contentType ?? null,
      avatarVersion: input.version,
      avatarUpdatedAt: new Date(),
      avatarSize: input.size ?? null,
      avatarStatus: input.status,
    },
  });

  return toPublicUser(user);
}

export async function getUserAvatarMetadata(userId: string): Promise<{
  storageProvider: string | null;
  objectKey: string | null;
  contentType: string | null;
  version: number;
  status: string | null;
} | null> {
  const user = await prisma.authUser.findUnique({
    where: { id: userId },
    select: {
      avatarStorageProvider: true,
      avatarObjectKey: true,
      avatarContentType: true,
      avatarVersion: true,
      avatarStatus: true,
    },
  });

  if (!user) return null;

  return {
    storageProvider: user.avatarStorageProvider,
    objectKey: user.avatarObjectKey,
    contentType: user.avatarContentType,
    version: user.avatarVersion ?? 0,
    status: user.avatarStatus,
  };
}

/**
 * Busca por prefixo de handle, entre empresas.
 *
 * É o **único** caminho de busca digitável que o schema permite: nome está cifrado e e-mail só tem
 * hash determinístico, e nenhum dos dois responde prefixo. O handle existe exatamente para isto.
 *
 * `usernameDiscoverable` é a linha entre ter identificador e estar num diretório. Quem se retirou
 * some da busca sem perder o handle — e some do mesmo jeito que quem não existe, porque uma
 * resposta diferente contaria que ele existe.
 */
export async function searchUsersByUsernamePrefix(
  prefix: string,
  limit = 8,
): Promise<Array<{ id: string; username: string; displayName: string }>> {
  const normalized = prefix.trim().toLowerCase();
  if (normalized.length < 2) return [];

  const users = await prisma.authUser.findMany({
    where: {
      username: { startsWith: normalized },
      usernameDiscoverable: true,
      status: 'active',
    },
    select: { id: true, username: true, firstNameEncrypted: true, lastNameEncrypted: true },
    orderBy: { username: 'asc' },
    take: Math.min(Math.max(limit, 1), 20),
  });

  return users.map((user) => ({
    id: user.id,
    username: user.username ?? '',
    // O nome de exibição só é decifrado **depois** do filtro: o que decide quem aparece é o
    // handle, e nunca o campo cifrado.
    displayName: [
      user.firstNameEncrypted ? decryptField(user.firstNameEncrypted) : '',
      user.lastNameEncrypted ? decryptField(user.lastNameEncrypted) : '',
    ]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(' '),
  }));
}

/** O handle está livre? Reservado e formato inválido contam como ocupado para quem escolhe. */
export async function isUsernameAvailable(username: string): Promise<boolean> {
  const existing = await prisma.authUser.findUnique({ where: { username } });
  return !existing;
}
