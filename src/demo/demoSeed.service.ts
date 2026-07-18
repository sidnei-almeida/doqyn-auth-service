import type { TenantRole } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { buildGroupId } from '../modules/access-groups/accessGroups.service.js';
import { CONSENT_TEXT_VERSION } from '../modules/access-requests/accessRequests.constants.js';
import { recordTermsAcceptance } from '../modules/terms/termsAcceptance.service.js';
import { DOQYN_TERMS_VERSION } from '../modules/terms/terms.constants.js';
import { encryptField, hashLookup } from '../security/crypto.js';
import { hashPassword } from '../security/password.js';
import {
  detectTaxIdType,
  maskTaxId,
  normalizeEmail,
  normalizePhone,
  normalizeTaxId,
  slugify,
} from '../utils/normalize.js';
import {
  DEMO_COMPANIES,
  DEMO_COMPANY_DEV_ACTIVE_USERS,
  DEMO_GLOBAL_ADMIN,
  DEMO_GLOBAL_ADMIN_TENANT_ID,
  DEMO_SEED_DEFAULT_PASSWORD,
  DEMO_SEED_SOURCE,
  type DemoCompanyDef,
  type DemoGlobalAdminDef,
  type DemoPendingUserDef,
} from './demoSeed.constants.js';
import { assertDemoSeedSafe } from './demoSeed.guard.js';
import {
  defaultManifestPath,
  type DemoSeedManifest,
  type DemoSeedManifestAccessGroup,
  type DemoSeedManifestCompany,
  type DemoSeedManifestPendingUser,
  type DemoSeedManifestGlobalAdmin,
  writeDemoSeedManifest,
} from './demoSeed.manifest.js';
import { writeDemoSeedReport } from './demoSeed.report.js';

const DEMO_IP_HASH = hashLookup(`${DEMO_SEED_SOURCE}:ip`);
const DEMO_USER_AGENT_HASH = hashLookup(`${DEMO_SEED_SOURCE}:user-agent`);

function credentialUpdatePayload(passwordHash: string) {
  return process.env.SEED_FORCE_PASSWORD_RESET === 'true' ? { passwordHash } : {};
}

export type RunDemoSeedOptions = {
  password?: string;
  manifestPath?: string;
  repoRoot?: string;
  resetPending?: boolean;
};

export type RunDemoSeedResult = {
  manifestPath: string;
  reportPaths: { markdown: string; json: string };
  manifest: DemoSeedManifest;
  password: string;
};

async function ensureAccessGroups(
  tenantUuid: string,
  groups: DemoCompanyDef['accessGroups'],
): Promise<DemoSeedManifestAccessGroup[]> {
  const manifestGroups: DemoSeedManifestAccessGroup[] = [];

  for (const group of groups) {
    const slug = slugify(group.slug);
    const groupId = buildGroupId(slug);

    const saved = await prisma.authAccessGroup.upsert({
      where: {
        tenantId_slug: {
          tenantId: tenantUuid,
          slug,
        },
      },
      create: {
        tenantId: tenantUuid,
        groupId,
        slug,
        nameEncrypted: encryptField(group.name),
        descriptionEncrypted: group.description ? encryptField(group.description) : null,
        status: 'active',
      },
      update: {
        groupId,
        nameEncrypted: encryptField(group.name),
        descriptionEncrypted: group.description ? encryptField(group.description) : null,
        status: 'active',
        deletedAt: null,
      },
    });

    manifestGroups.push({
      groupId: saved.groupId,
      slug: saved.slug,
      name: group.name,
    });
  }

  return manifestGroups;
}

async function ensureBusinessTenant(company: DemoCompanyDef) {
  const taxId = normalizeTaxId(company.cnpj);
  const taxIdHash = hashLookup(taxId);

  return prisma.authTenant.upsert({
    where: { tenantId: company.tenantId },
    create: {
      tenantId: company.tenantId,
      tenantType: 'business',
      country: 'BR',
      displayNameEncrypted: encryptField(company.displayName),
      displayNameLookupHash: hashLookup(company.displayName.toLowerCase()),
      slug: company.slug,
      taxIdType: detectTaxIdType(taxId),
      taxIdMasked: maskTaxId(taxId),
      taxIdHash,
      status: 'active',
    },
    update: {
      tenantType: 'business',
      country: 'BR',
      displayNameEncrypted: encryptField(company.displayName),
      displayNameLookupHash: hashLookup(company.displayName.toLowerCase()),
      slug: company.slug,
      taxIdType: detectTaxIdType(taxId),
      taxIdMasked: maskTaxId(taxId),
      taxIdHash,
      status: 'active',
    },
  });
}

async function resetDemoMembershipToPending(membershipId: string) {
  await prisma.authMembershipRole.deleteMany({ where: { membershipId } });
  await prisma.authMembershipAccessGroup.deleteMany({ where: { membershipId } });
  await prisma.authMembership.update({
    where: { id: membershipId },
    data: {
      status: 'pending',
      approvedAt: null,
      approvedByMembershipId: null,
      rejectedAt: null,
      rejectedByMembershipId: null,
      rejectedReasonEncrypted: null,
      blockedAt: null,
      blockedByMembershipId: null,
      removedAt: null,
      removedByMembershipId: null,
    },
  });
}

async function ensurePendingAccessRequest(input: {
  tenantUuid: string;
  tenantTextId: string;
  tenantDisplayName: string;
  user: DemoPendingUserDef;
  passwordHash: string;
  resetPending: boolean;
}): Promise<DemoSeedManifestPendingUser> {
  const normalizedEmail = normalizeEmail(input.user.email);
  const emailLookupHash = hashLookup(normalizedEmail);
  const normalizedPhone = normalizePhone(input.user.whatsapp);
  const taxId = normalizeTaxId(input.user.taxId);
  const taxIdHash = hashLookup(taxId);
  const displayName = `${input.user.firstName} ${input.user.lastName}`.trim();

  const user = await prisma.authUser.upsert({
    where: { emailLookupHash },
    create: {
      emailEncrypted: encryptField(normalizedEmail),
      emailLookupHash,
      firstNameEncrypted: encryptField(input.user.firstName),
      lastNameEncrypted: encryptField(input.user.lastName),
      whatsappEncrypted: encryptField(normalizedPhone),
      whatsappLookupHash: hashLookup(normalizedPhone),
      status: 'active',
      emailVerified: true,
    },
    update: {
      firstNameEncrypted: encryptField(input.user.firstName),
      lastNameEncrypted: encryptField(input.user.lastName),
      whatsappEncrypted: encryptField(normalizedPhone),
      whatsappLookupHash: hashLookup(normalizedPhone),
      status: 'active',
      emailVerified: true,
    },
  });

  await prisma.authCredential.upsert({
    where: { userId: user.id },
    create: { userId: user.id, passwordHash: input.passwordHash },
    update: credentialUpdatePayload(input.passwordHash),
  });

  let membership = await prisma.authMembership.findUnique({
    where: { userId_tenantId: { userId: user.id, tenantId: input.tenantUuid } },
  });

  if (!membership) {
    membership = await prisma.authMembership.create({
      data: {
        userId: user.id,
        tenantId: input.tenantUuid,
        status: 'pending',
        requestedJobTitleEncrypted: encryptField(input.user.jobTitle),
        requestedDepartmentEncrypted: encryptField(input.user.departmentText),
        requestedReasonEncrypted: encryptField(input.user.reason),
      },
    });
  } else if (input.resetPending || membership.status === 'pending') {
    await prisma.authMembership.update({
      where: { id: membership.id },
      data: {
        status: 'pending',
        requestedJobTitleEncrypted: encryptField(input.user.jobTitle),
        requestedDepartmentEncrypted: encryptField(input.user.departmentText),
        requestedReasonEncrypted: encryptField(input.user.reason),
        approvedAt: null,
        approvedByMembershipId: null,
        rejectedAt: null,
        rejectedByMembershipId: null,
        rejectedReasonEncrypted: null,
        blockedAt: null,
        blockedByMembershipId: null,
        removedAt: null,
        removedByMembershipId: null,
      },
    });
    await prisma.authMembershipRole.deleteMany({ where: { membershipId: membership.id } });
    await prisma.authMembershipAccessGroup.deleteMany({ where: { membershipId: membership.id } });
    membership = await prisma.authMembership.findUniqueOrThrow({ where: { id: membership.id } });
  }

  if (input.resetPending && membership.status !== 'pending') {
    await resetDemoMembershipToPending(membership.id);
    membership = await prisma.authMembership.findUniqueOrThrow({ where: { id: membership.id } });
  }

  let accessRequest = await prisma.authAccessRequest.findFirst({
    where: {
      userId: user.id,
      tenantId: input.tenantUuid,
      status: 'pending',
    },
    orderBy: { requestedAt: 'desc' },
  });

  if (!accessRequest) {
    accessRequest = await prisma.authAccessRequest.create({
      data: {
        userId: user.id,
        tenantId: input.tenantUuid,
        membershipId: membership.id,
        status: 'pending',
        personType: input.user.personType,
        taxIdType: detectTaxIdType(taxId),
        taxIdMasked: maskTaxId(taxId),
        taxIdHash,
        tenantDisplayNameEncrypted: encryptField(input.tenantDisplayName),
        jobTitleEncrypted: encryptField(input.user.jobTitle),
        departmentEncrypted: encryptField(input.user.departmentText),
        reasonEncrypted: encryptField(input.user.reason),
        operationalNotificationsConsent: input.user.operationalNotificationsConsent,
        consentTextVersion: CONSENT_TEXT_VERSION,
      },
    });
  } else {
    accessRequest = await prisma.authAccessRequest.update({
      where: { id: accessRequest.id },
      data: {
        membershipId: membership.id,
        status: 'pending',
        personType: input.user.personType,
        taxIdType: detectTaxIdType(taxId),
        taxIdMasked: maskTaxId(taxId),
        taxIdHash,
        tenantDisplayNameEncrypted: encryptField(input.tenantDisplayName),
        jobTitleEncrypted: encryptField(input.user.jobTitle),
        departmentEncrypted: encryptField(input.user.departmentText),
        reasonEncrypted: encryptField(input.user.reason),
        operationalNotificationsConsent: input.user.operationalNotificationsConsent,
        consentTextVersion: CONSENT_TEXT_VERSION,
        requestedAt: new Date(),
      },
    });
  }

  const existingTerms = await prisma.authTermsAcceptance.findFirst({
    where: { accessRequestId: accessRequest.id },
    orderBy: { acceptedAt: 'desc' },
  });

  if (!existingTerms) {
    await recordTermsAcceptance({
      flow: 'access_request',
      termsVersion: DOQYN_TERMS_VERSION,
      userId: user.id,
      membershipId: membership.id,
      tenantId: input.tenantUuid,
      accessRequestId: accessRequest.id,
      ipAddressHash: DEMO_IP_HASH,
      userAgentHash: DEMO_USER_AGENT_HASH,
    });
  }

  await prisma.authNotificationPreference.upsert({
    where: { membershipId: membership.id },
    create: { membershipId: membership.id },
    update: {},
  });

  return {
    seedKey: input.user.seedKey,
    email: input.user.email,
    displayName,
    whatsapp: input.user.whatsapp,
    personType: input.user.personType,
    taxIdMasked: maskTaxId(taxId),
    jobTitle: input.user.jobTitle,
    departmentText: input.user.departmentText,
    reason: input.user.reason,
    operationalNotificationsConsent: input.user.operationalNotificationsConsent,
    membershipId: membership.id,
    accessRequestId: accessRequest.id,
    status: 'pending',
  };
}

async function ensureGlobalAdminTenant() {
  return prisma.authTenant.upsert({
    where: { tenantId: DEMO_GLOBAL_ADMIN_TENANT_ID },
    create: {
      tenantId: DEMO_GLOBAL_ADMIN_TENANT_ID,
      tenantType: 'business',
      country: 'BR',
      displayNameEncrypted: encryptField('DOQYN Dev'),
      displayNameLookupHash: hashLookup('doqyn dev'),
      slug: DEMO_GLOBAL_ADMIN_TENANT_ID,
      status: 'active',
    },
    update: {
      tenantType: 'business',
      country: 'BR',
      displayNameEncrypted: encryptField('DOQYN Dev'),
      displayNameLookupHash: hashLookup('doqyn dev'),
      status: 'active',
    },
  });
}

async function ensureActiveTenantMember(
  member: DemoGlobalAdminDef,
  tenantUuid: string,
  passwordHash: string,
): Promise<DemoSeedManifestGlobalAdmin> {
  const normalizedEmail = normalizeEmail(member.email);
  const emailLookupHash = hashLookup(normalizedEmail);
  const normalizedPhone = normalizePhone(member.whatsapp);
  const displayName = `${member.firstName} ${member.lastName}`.trim();

  const user = await prisma.authUser.upsert({
    where: { emailLookupHash },
    create: {
      emailEncrypted: encryptField(normalizedEmail),
      emailLookupHash,
      firstNameEncrypted: encryptField(member.firstName),
      lastNameEncrypted: encryptField(member.lastName),
      whatsappEncrypted: encryptField(normalizedPhone),
      whatsappLookupHash: hashLookup(normalizedPhone),
      status: 'active',
      emailVerified: true,
    },
    update: {
      firstNameEncrypted: encryptField(member.firstName),
      lastNameEncrypted: encryptField(member.lastName),
      whatsappEncrypted: encryptField(normalizedPhone),
      whatsappLookupHash: hashLookup(normalizedPhone),
      status: 'active',
      emailVerified: true,
    },
  });

  await prisma.authCredential.upsert({
    where: { userId: user.id },
    create: { userId: user.id, passwordHash },
    update: credentialUpdatePayload(passwordHash),
  });

  const membership = await prisma.authMembership.upsert({
    where: { userId_tenantId: { userId: user.id, tenantId: tenantUuid } },
    create: {
      userId: user.id,
      tenantId: tenantUuid,
      status: 'active',
      approvedAt: new Date(),
      ...(member.jobTitle
        ? { requestedJobTitleEncrypted: encryptField(member.jobTitle) }
        : {}),
      ...(member.departmentText
        ? { requestedDepartmentEncrypted: encryptField(member.departmentText) }
        : {}),
    },
    update: {
      status: 'active',
      approvedAt: new Date(),
      removedAt: null,
      removedByMembershipId: null,
      rejectedAt: null,
      rejectedByMembershipId: null,
      blockedAt: null,
      blockedByMembershipId: null,
      ...(member.jobTitle
        ? { requestedJobTitleEncrypted: encryptField(member.jobTitle) }
        : {}),
      ...(member.departmentText
        ? { requestedDepartmentEncrypted: encryptField(member.departmentText) }
        : {}),
    },
  });

  const uniqueRoles = [...new Set(member.roles)] as TenantRole[];
  await prisma.authMembershipRole.deleteMany({ where: { membershipId: membership.id } });
  if (uniqueRoles.length > 0) {
    await prisma.authMembershipRole.createMany({
      data: uniqueRoles.map((role) => ({ membershipId: membership.id, role })),
    });
  }

  await prisma.authNotificationPreference.upsert({
    where: { membershipId: membership.id },
    create: { membershipId: membership.id },
    update: {},
  });

  return {
    seedKey: member.seedKey,
    userId: user.id,
    email: member.email,
    displayName,
    tenantId: DEMO_GLOBAL_ADMIN_TENANT_ID,
    membershipId: membership.id,
    roles: uniqueRoles,
    status: 'active',
    jobTitle: member.jobTitle,
    departmentText: member.departmentText,
  };
}

async function ensureGlobalAdmin(
  admin: DemoGlobalAdminDef,
  tenantUuid: string,
  passwordHash: string,
) {
  return ensureActiveTenantMember(admin, tenantUuid, passwordHash);
}

export async function runDemoSeed(options: RunDemoSeedOptions = {}): Promise<RunDemoSeedResult> {
  assertDemoSeedSafe();

  const repoRoot = options.repoRoot ?? process.cwd();
  const password = options.password ?? process.env.DEMO_SEED_PASSWORD ?? DEMO_SEED_DEFAULT_PASSWORD;
  const resetPending = options.resetPending ?? process.env.DEMO_SEED_RESET_PENDING !== 'false';
  const passwordHash = await hashPassword(password);
  const manifestPath = options.manifestPath ?? defaultManifestPath(repoRoot);

  const adminTenant = await ensureGlobalAdminTenant();
  const globalAdmin = await ensureGlobalAdmin(DEMO_GLOBAL_ADMIN, adminTenant.id, passwordHash);

  const companyDevActiveUsers: DemoSeedManifestGlobalAdmin[] = [];
  for (const member of DEMO_COMPANY_DEV_ACTIVE_USERS) {
    companyDevActiveUsers.push(
      await ensureActiveTenantMember(member, adminTenant.id, passwordHash),
    );
  }

  const companies: DemoSeedManifestCompany[] = [];

  for (const company of DEMO_COMPANIES) {
    const tenant = await ensureBusinessTenant(company);
    const accessGroups = await ensureAccessGroups(tenant.id, company.accessGroups);

    const pendingUsers: DemoSeedManifestPendingUser[] = [];
    for (const user of company.pendingUsers) {
      pendingUsers.push(
        await ensurePendingAccessRequest({
          tenantUuid: tenant.id,
          tenantTextId: tenant.tenantId,
          tenantDisplayName: company.displayName,
          user,
          passwordHash,
          resetPending,
        }),
      );
    }

    companies.push({
      seedKey: company.seedKey,
      tenantId: company.tenantId,
      tenantType: 'business',
      displayName: company.displayName,
      legalName: company.legalName,
      cnpj: company.cnpj,
      slug: company.slug,
      status: 'active',
      accessGroups,
      pendingUsers,
    });
  }

  const manifest: DemoSeedManifest = {
    version: 1,
    source: DEMO_SEED_SOURCE,
    generatedAt: new Date().toISOString(),
    authServiceRoot: repoRoot,
    companies,
    globalAdmin,
    companyDevActiveUsers,
  };

  writeDemoSeedManifest(manifest, manifestPath);
  const reportPaths = writeDemoSeedReport({
    manifest,
    password,
    manifestPath,
    repoRoot,
  });

  return {
    manifestPath,
    reportPaths,
    manifest,
    password,
  };
}
