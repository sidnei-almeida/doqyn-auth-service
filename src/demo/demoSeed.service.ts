import type { TenantRole } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { buildGroupId } from '../modules/access-groups/accessGroups.service.js';
import { encryptField, hashLookup } from '../security/crypto.js';
import { claimUsername } from '../modules/users/users.service.js';
import { hashPassword } from '../security/password.js';
import type { SupportedLocale } from '../utils/locales.js';
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
  DEMO_COMPANY_ADMIN,
  DEMO_COMPANY_TENANT_ID,
  DEMO_SEED_DEFAULT_PASSWORD,
  DEMO_SEED_SOURCE,
  type DemoCompanyDef,
  type DemoTenantMemberDef,
} from './demoSeed.constants.js';
import { assertDemoSeedSafe } from './demoSeed.guard.js';
import {
  localizeDemoAccessGroups,
  localizeDemoMember,
  resolveDemoSeedLocale,
} from './demoSeed.locale.js';
import {
  defaultManifestPath,
  type DemoSeedManifest,
  type DemoSeedManifestAccessGroup,
  type DemoSeedManifestCompany,
  type DemoSeedManifestGlobalAdmin,
  writeDemoSeedManifest,
} from './demoSeed.manifest.js';
import { writeDemoSeedReport } from './demoSeed.report.js';

function credentialUpdatePayload(passwordHash: string) {
  return process.env.SEED_FORCE_PASSWORD_RESET === 'true' ? { passwordHash } : {};
}

export type RunDemoSeedOptions = {
  password?: string;
  manifestPath?: string;
  repoRoot?: string;
  resetPending?: boolean;
  /** Sobrepõe `DEMO_SEED_LOCALE`. */
  locale?: string;
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

async function ensureBusinessTenant(company: DemoCompanyDef, locale: SupportedLocale) {
  const taxId = normalizeTaxId(company.cnpj);
  const taxIdHash = hashLookup(taxId);

  return prisma.authTenant.upsert({
    where: { tenantId: company.tenantId },
    create: {
      tenantId: company.tenantId,
      tenantType: 'business',
      country: 'BR',
      defaultLocale: locale,
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
      defaultLocale: locale,
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

/**
 * O handle do usuário semeado, e só quando ele ainda não tem um.
 *
 * O seed roda de novo sobre o mesmo banco. Reclamar o handle a cada passada faria `claimUsername`
 * encontrar o handle ocupado — pelo próprio dono — e devolver `rafa.mendes2` na segunda rodada,
 * `rafa.mendes3` na terceira. Quem já tem handle não é renomeado; o índice único do Postgres
 * continua sendo a última palavra sobre duplicidade.
 */
async function ensureSeedUsername(
  userId: string,
  current: string | null,
  chosen: string | undefined,
  email: string,
): Promise<void> {
  if (current) return;

  const username = await claimUsername(prisma, chosen, email);
  await prisma.authUser.update({ where: { id: userId }, data: { username } });
}

async function ensureDemoCompanyTenant(locale: SupportedLocale) {
  return prisma.authTenant.upsert({
    where: { tenantId: DEMO_COMPANY_TENANT_ID },
    create: {
      tenantId: DEMO_COMPANY_TENANT_ID,
      tenantType: 'business',
      country: 'BR',
      defaultLocale: locale,
      displayNameEncrypted: encryptField('DOQYN Dev'),
      displayNameLookupHash: hashLookup('doqyn dev'),
      slug: DEMO_COMPANY_TENANT_ID,
      status: 'active',
    },
    update: {
      tenantType: 'business',
      country: 'BR',
      defaultLocale: locale,
      displayNameEncrypted: encryptField('DOQYN Dev'),
      displayNameLookupHash: hashLookup('doqyn dev'),
      status: 'active',
    },
  });
}

async function ensureActiveTenantMember(
  memberDef: DemoTenantMemberDef,
  tenantUuid: string,
  passwordHash: string,
  locale: SupportedLocale,
): Promise<DemoSeedManifestGlobalAdmin> {
  const member = localizeDemoMember(memberDef, locale);
  const normalizedEmail = normalizeEmail(member.email);
  const emailLookupHash = hashLookup(normalizedEmail);
  const normalizedPhone = normalizePhone(member.whatsapp);
  const displayName = `${member.firstName} ${member.lastName}`.trim();

  // O idioma é regravado a cada passada: rodar o seed em outro idioma troca a demonstração inteira.
  const user = await prisma.authUser.upsert({
    where: { emailLookupHash },
    create: {
      emailEncrypted: encryptField(normalizedEmail),
      emailLookupHash,
      firstNameEncrypted: encryptField(member.firstName),
      lastNameEncrypted: encryptField(member.lastName),
      whatsappEncrypted: encryptField(normalizedPhone),
      whatsappLookupHash: hashLookup(normalizedPhone),
      locale,
      status: 'active',
      emailVerified: true,
    },
    update: {
      firstNameEncrypted: encryptField(member.firstName),
      lastNameEncrypted: encryptField(member.lastName),
      whatsappEncrypted: encryptField(normalizedPhone),
      whatsappLookupHash: hashLookup(normalizedPhone),
      locale,
      status: 'active',
      emailVerified: true,
    },
  });

  await ensureSeedUsername(user.id, user.username, member.username, normalizedEmail);

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
      ...(member.jobTitle ? { requestedJobTitleEncrypted: encryptField(member.jobTitle) } : {}),
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
      ...(member.jobTitle ? { requestedJobTitleEncrypted: encryptField(member.jobTitle) } : {}),
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
    tenantId: DEMO_COMPANY_TENANT_ID,
    membershipId: membership.id,
    roles: uniqueRoles,
    status: 'active',
    jobTitle: member.jobTitle,
    departmentText: member.departmentText,
  };
}

async function ensureCompanyAdmin(
  admin: DemoTenantMemberDef,
  tenantUuid: string,
  passwordHash: string,
  locale: SupportedLocale,
) {
  return ensureActiveTenantMember(admin, tenantUuid, passwordHash, locale);
}

export async function runDemoSeed(options: RunDemoSeedOptions = {}): Promise<RunDemoSeedResult> {
  assertDemoSeedSafe();

  const locale = resolveDemoSeedLocale(options.locale ?? process.env.DEMO_SEED_LOCALE);
  const repoRoot = options.repoRoot ?? process.cwd();
  const password = options.password ?? process.env.DEMO_SEED_PASSWORD ?? DEMO_SEED_DEFAULT_PASSWORD;
  const passwordHash = await hashPassword(password);
  const manifestPath = options.manifestPath ?? defaultManifestPath(repoRoot);

  const adminTenant = await ensureDemoCompanyTenant(locale);
  // A chave `globalAdmin` do manifest permanece: é contrato cross-repo lido pelo seed do Alpha
  // (`scripts/demo-seed/`). O que mudou é a conta por trás dela — hoje um admin de empresa comum.
  const globalAdmin = await ensureCompanyAdmin(
    DEMO_COMPANY_ADMIN,
    adminTenant.id,
    passwordHash,
    locale,
  );

  const companyDevActiveUsers: DemoSeedManifestGlobalAdmin[] = [];
  for (const member of DEMO_COMPANY_DEV_ACTIVE_USERS) {
    companyDevActiveUsers.push(
      await ensureActiveTenantMember(member, adminTenant.id, passwordHash, locale),
    );
  }

  const companies: DemoSeedManifestCompany[] = [];

  for (const company of DEMO_COMPANIES) {
    const tenant = await ensureBusinessTenant(company, locale);
    const accessGroups = await ensureAccessGroups(
      tenant.id,
      localizeDemoAccessGroups(company.accessGroups, locale),
    );

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
    });
  }

  const manifest: DemoSeedManifest = {
    version: 1,
    source: DEMO_SEED_SOURCE,
    generatedAt: new Date().toISOString(),
    locale,
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
