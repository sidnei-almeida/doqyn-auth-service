import type { Prisma } from '@prisma/client';
import { encryptField } from '../../security/crypto.js';

/**
 * Definições legadas de grupos de negócio — NÃO usadas no signup nem no seed.
 * Mantidas apenas para testes que criam grupos explicitamente via helper.
 */
export const DEFAULT_BUSINESS_GROUP_DEFS = [
  { groupId: 'group_financeiro', name: 'Financeiro', slug: 'financeiro' },
  { groupId: 'group_juridico', name: 'Jurídico', slug: 'juridico' },
  { groupId: 'group_rh', name: 'RH', slug: 'rh' },
  { groupId: 'group_compras', name: 'Compras', slug: 'compras' },
  { groupId: 'group_diretoria', name: 'Diretoria', slug: 'diretoria' },
] as const;

type DbClient = Prisma.TransactionClient | typeof import('../../db/prisma.js').prisma;

export async function ensureDefaultBusinessAccessGroups(
  db: DbClient,
  tenantInternalId: string,
): Promise<Array<{ id: string; groupId: string }>> {
  const records: Array<{ id: string; groupId: string }> = [];

  for (const def of DEFAULT_BUSINESS_GROUP_DEFS) {
    const record = await db.authAccessGroup.upsert({
      where: { tenantId_groupId: { tenantId: tenantInternalId, groupId: def.groupId } },
      create: {
        tenantId: tenantInternalId,
        groupId: def.groupId,
        nameEncrypted: encryptField(def.name),
        slug: def.slug,
        status: 'active',
      },
      update: {
        nameEncrypted: encryptField(def.name),
        status: 'active',
      },
    });
    records.push({ id: record.id, groupId: record.groupId });
  }

  return records;
}
