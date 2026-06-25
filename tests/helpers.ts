import { prisma } from '../src/db/prisma.js';
import { encryptField, hashLookup } from '../src/security/crypto.js';
import { hashPassword } from '../src/security/password.js';
import { normalizeEmail } from '../src/utils/normalize.js';
import { createTenant } from '../src/modules/tenants/tenants.service.js';
import { createAccessGroup } from '../src/modules/access-groups/accessGroups.service.js';
import {
  setMembershipAccessGroups,
  setMembershipRoles,
} from '../src/modules/memberships/memberships.service.js';
import type { TenantRole } from '@prisma/client';

export async function createTestUser(
  email: string,
  password: string,
  opts?: { firstName?: string; lastName?: string },
) {
  const normalized = normalizeEmail(email);
  const passwordHash = await hashPassword(password);

  const user = await prisma.authUser.create({
    data: {
      emailEncrypted: encryptField(normalized),
      emailLookupHash: hashLookup(normalized),
      firstNameEncrypted: opts?.firstName ? encryptField(opts.firstName) : null,
      lastNameEncrypted: opts?.lastName ? encryptField(opts.lastName) : null,
      status: 'active',
    },
  });

  await prisma.authCredential.create({ data: { userId: user.id, passwordHash } });
  return user;
}

export async function createTestTenant(
  tenantId: string,
  opts?: { tenantType?: 'individual' | 'business'; displayName?: string; status?: 'pending' | 'active' | 'blocked' },
) {
  return createTenant({
    tenantId,
    tenantType: opts?.tenantType ?? 'business',
    displayName: opts?.displayName ?? tenantId,
    status: opts?.status ?? 'active',
  });
}

export async function createTestMembership(
  userId: string,
  tenantUuid: string,
  status: 'pending' | 'active' | 'blocked' | 'rejected' = 'pending',
) {
  return prisma.authMembership.create({
    data: { userId, tenantId: tenantUuid, status },
  });
}

export async function assignRoles(membershipId: string, roles: TenantRole[]) {
  await setMembershipRoles(membershipId, roles);
}

export async function setupAdminUser(
  email: string,
  password: string,
  tenantId: string,
  roles: TenantRole[] = ['company_admin'],
) {
  const user = await createTestUser(email, password);
  const tenant = await createTestTenant(tenantId);
  const membership = await createTestMembership(user.id, tenant.id, 'active');
  await assignRoles(membership.id, roles);
  await prisma.authNotificationPreference.create({ data: { membershipId: membership.id } });
  return { user, tenant, membership };
}

export async function setupAccessGroups(tenantTextId: string) {
  const financeiro = await createAccessGroup(tenantTextId, {
    slug: 'financeiro',
    name: 'Financeiro',
  });
  const juridico = await createAccessGroup(tenantTextId, {
    slug: 'juridico',
    name: 'Jurídico',
  });
  return { financeiro, juridico };
}

export async function linkMembershipToGroups(
  membershipId: string,
  tenantUuid: string,
  groupIds: string[],
) {
  await setMembershipAccessGroups(membershipId, tenantUuid, groupIds);
}

/** Vincula membership a grupos diretamente no banco (inclui inactive/deleted). */
export async function linkMembershipToGroupsRaw(
  membershipId: string,
  tenantUuid: string,
  groupIds: string[],
) {
  for (const groupId of groupIds) {
    const group = await prisma.authAccessGroup.findFirst({
      where: { tenantId: tenantUuid, groupId },
    });
    if (!group) {
      throw new Error(`Grupo não encontrado: ${groupId}`);
    }
    await prisma.authMembershipAccessGroup.upsert({
      where: {
        membershipId_accessGroupId: { membershipId, accessGroupId: group.id },
      },
      create: { membershipId, accessGroupId: group.id },
      update: {},
    });
  }
}

export async function createTestAccessGroupWithStatus(
  tenantTextId: string,
  slug: string,
  name: string,
  status: 'active' | 'inactive' | 'deleted',
) {
  const group = await createAccessGroup(tenantTextId, { slug, name });
  if (status !== 'active') {
    await prisma.authAccessGroup.update({
      where: { id: group.id },
      data: {
        status,
        ...(status === 'deleted' ? { deletedAt: new Date() } : {}),
      },
    });
  }
  return group;
}

export function extractCookie(
  setCookie: string | string[] | undefined,
  cookieName: string,
): string {
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const match = raw?.match(new RegExp(`${cookieName}=([^;]+)`));
  return match?.[1] ?? '';
}

export async function loginUser(
  app: { inject: (opts: object) => Promise<{ headers: Record<string, unknown>; statusCode: number; json: () => unknown }> },
  email: string,
  password: string,
  cookieName: string,
) {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password },
  });
  const token = extractCookie(response.headers['set-cookie'] as string, cookieName);
  return { response, token };
}
