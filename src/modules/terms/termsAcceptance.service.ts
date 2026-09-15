import type { Prisma, TermsAcceptanceFlow } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { DEFAULT_LOCALE, normalizeLocale } from '../../utils/locales.js';

type PrismaTransaction = Prisma.TransactionClient;

type RecordTermsAcceptanceInput = {
  flow: TermsAcceptanceFlow;
  termsVersion: string;
  /** Idioma do texto aceito; fora da lista, cai no padrão. */
  locale?: string | null;
  privacyVersion?: string | null;
  userId?: string | null;
  membershipId?: string | null;
  tenantId?: string | null;
  ipAddressHash?: string | null;
  userAgentHash?: string | null;
  acceptedAt?: Date;
};

export async function recordTermsAcceptance(
  input: RecordTermsAcceptanceInput,
  tx?: PrismaTransaction,
) {
  const client = tx ?? prisma;

  return client.authTermsAcceptance.create({
    data: {
      flow: input.flow,
      termsVersion: input.termsVersion,
      locale: normalizeLocale(input.locale) ?? DEFAULT_LOCALE,
      privacyVersion: input.privacyVersion ?? null,
      userId: input.userId ?? null,
      membershipId: input.membershipId ?? null,
      tenantId: input.tenantId ?? null,
      ipAddressHash: input.ipAddressHash ?? null,
      userAgentHash: input.userAgentHash ?? null,
      acceptedAt: input.acceptedAt ?? new Date(),
    },
  });
}
