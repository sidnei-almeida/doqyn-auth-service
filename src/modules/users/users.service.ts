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

export function isUserLoginAllowed(status: AuthUserStatus): boolean {
  return status === 'active' || status === 'pending_verification';
}
