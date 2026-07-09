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
  accessRequestId?: string | null;
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
      accessRequestId: input.accessRequestId ?? null,
      ipAddressHash: input.ipAddressHash ?? null,
      userAgentHash: input.userAgentHash ?? null,
      acceptedAt: input.acceptedAt ?? new Date(),
    },
  });
}

export async function getLatestTermsAcceptanceForAccessRequest(accessRequestId: string) {
  return prisma.authTermsAcceptance.findFirst({
    where: { accessRequestId },
    orderBy: { acceptedAt: 'desc' },
  });
}

export async function listTermsAcceptancesForAccessRequests(accessRequestIds: string[]) {
  if (accessRequestIds.length === 0) return new Map<string, Prisma.AuthTermsAcceptanceGetPayload<object>>();

  const rows = await prisma.authTermsAcceptance.findMany({
    where: { accessRequestId: { in: accessRequestIds } },
    orderBy: { acceptedAt: 'desc' },
  });

  const map = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (row.accessRequestId && !map.has(row.accessRequestId)) {
      map.set(row.accessRequestId, row);
    }
  }
  return map;
}
