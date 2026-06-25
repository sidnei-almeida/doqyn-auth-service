import type { AuthTenant, TenantStatus, TenantType } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { decryptField, encryptField, hashLookup } from '../../security/crypto.js';
import {
  detectTaxIdType,
  maskTaxId,
  normalizeTaxId,
  slugify,
} from '../../utils/normalize.js';

export interface PublicTenant {
  id: string;
  tenantId: string;
  tenantType: TenantType;
  displayName: string | null;
  slug: string | null;
  taxIdType: string | null;
  taxIdMasked: string | null;
  status: TenantStatus;
}

export function toPublicTenant(tenant: AuthTenant): PublicTenant {
  return {
    id: tenant.id,
    tenantId: tenant.tenantId,
    tenantType: tenant.tenantType,
    displayName: tenant.displayNameEncrypted
      ? decryptField(tenant.displayNameEncrypted)
      : null,
    slug: tenant.slug,
    taxIdType: tenant.taxIdType,
    taxIdMasked: tenant.taxIdMasked,
    status: tenant.status,
  };
}

export interface CreateTenantInput {
  tenantId: string;
  tenantType: TenantType;
  displayName?: string;
  taxId?: string;
  status?: TenantStatus;
  slug?: string;
}

export async function findTenantByTextId(tenantId: string): Promise<AuthTenant | null> {
  return prisma.authTenant.findUnique({ where: { tenantId } });
}

export async function findTenantByTaxIdHash(taxIdHash: string): Promise<AuthTenant | null> {
  return prisma.authTenant.findFirst({ where: { taxIdHash } });
}

export async function createTenant(input: CreateTenantInput): Promise<AuthTenant> {
  const taxIdNormalized = input.taxId ? normalizeTaxId(input.taxId) : null;
  const taxIdHash = taxIdNormalized ? hashLookup(taxIdNormalized) : null;
  const displayName = input.displayName?.trim() || null;

  return prisma.authTenant.create({
    data: {
      tenantId: input.tenantId,
      tenantType: input.tenantType,
      displayNameEncrypted: displayName ? encryptField(displayName) : null,
      displayNameLookupHash: displayName ? hashLookup(displayName.toLowerCase()) : null,
      slug: input.slug ?? (displayName ? slugify(displayName) : null),
      taxIdType: taxIdNormalized ? detectTaxIdType(taxIdNormalized) : null,
      taxIdMasked: taxIdNormalized ? maskTaxId(taxIdNormalized) : null,
      taxIdHash,
      status: input.status ?? 'pending',
    },
  });
}

export async function createOrGetTenantByTaxId(
  taxId: string,
  personType: 'individual' | 'business',
  displayName?: string,
): Promise<AuthTenant> {
  const normalized = normalizeTaxId(taxId);
  const taxIdHash = hashLookup(normalized);

  const existing = await findTenantByTaxIdHash(taxIdHash);
  if (existing) {
    return existing;
  }

  const tenantType: TenantType = personType === 'business' ? 'business' : 'individual';
  const tenantId = `tenant_${taxIdHash.slice(0, 16)}`;
  const slug = displayName ? slugify(displayName) : tenantId;

  return createTenant({
    tenantId,
    tenantType,
    displayName,
    taxId: normalized,
    status: 'pending',
    slug,
  });
}

export async function listAccessGroupsByTenantTextId(tenantTextId: string) {
  const tenant = await findTenantByTextId(tenantTextId);
  if (!tenant) return [];

  const groups = await prisma.authAccessGroup.findMany({
    where: { tenantId: tenant.id },
    orderBy: { groupId: 'asc' },
  });

  return groups.map((g) => ({
    id: g.id,
    groupId: g.groupId,
    slug: g.slug,
    name: decryptField(g.nameEncrypted),
    description: g.descriptionEncrypted ? decryptField(g.descriptionEncrypted) : null,
    status: g.status,
  }));
}
