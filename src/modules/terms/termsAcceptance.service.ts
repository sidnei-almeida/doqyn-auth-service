import type { Prisma, TermsAcceptanceFlow } from '@prisma/client';
import { prisma } from '../../db/prisma.js';

type PrismaTransaction = Prisma.TransactionClient;

type RecordTermsAcceptanceInput = {
  flow: TermsAcceptanceFlow;
  termsVersion: string;
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

