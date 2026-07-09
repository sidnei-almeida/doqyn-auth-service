import type { TenantRole } from '@prisma/client';
import { loadEnv } from '../config/env.js';
import { prisma, disconnectPrisma } from './prisma.js';
import { encryptField, hashLookup } from '../security/crypto.js';
import { hashPassword } from '../security/password.js';
import { normalizeEmail, normalizePhone } from '../utils/normalize.js';

const DEV_TENANT_ID = 'company_dev';

type DevUserSeed = {
  email: string;
  firstName: string;
  lastName: string;
  whatsapp: string;
  roles: TenantRole[];
};

const SIDNEI_DEV_USER: DevUserSeed = {
  email: 'sidnei@doqyn.dev',
  firstName: 'Sidnei',
  lastName: 'Dev',
  whatsapp: '+5554999999999',
  roles: ['doqyn_admin', 'company_admin', 'user'],
};

const TEST_JURIDICO_USER: DevUserSeed = {
  email: 'teste.juridico@doqyn.dev',
  firstName: 'Usuário Teste',
  lastName: 'Jurídico',
  whatsapp: '+5554911112222',
  roles: ['user'],
};

/**
 * Seed de desenvolvimento — NUNCA executar em produção.
 *
 * Cria/atualiza de forma idempotente:
 * - tenant company_dev (business, active) — sem grupos de acesso padrão
 * - sidnei@doqyn.dev — admin total dev (doqyn_admin + company_admin + user)
 * - teste.juridico@doqyn.dev — usuário comum para testes de gestão (user)
 *
 * Grupos de acesso devem ser criados manualmente por tenant quando necessário.
 */
async function ensureDevTenant() {
  return prisma.authTenant.upsert({
    where: { tenantId: DEV_TENANT_ID },
    create: {
      tenantId: DEV_TENANT_ID,
      tenantType: 'business',
      displayNameEncrypted: encryptField('DOQYN Dev'),
      displayNameLookupHash: hashLookup('doqyn dev'),
      slug: DEV_TENANT_ID,
      status: 'active',
    },
    update: {
      status: 'active',
      tenantType: 'business',
      displayNameEncrypted: encryptField('DOQYN Dev'),
    },
  });
}

async function ensureDevUser(input: DevUserSeed, tenantUuid: string, passwordHash: string) {
  const normalizedEmail = normalizeEmail(input.email);
  const emailLookupHash = hashLookup(normalizedEmail);
  const normalizedPhone = normalizePhone(input.whatsapp);

  const user = await prisma.authUser.upsert({
    where: { emailLookupHash },
    create: {
      emailEncrypted: encryptField(normalizedEmail),
      emailLookupHash,
      firstNameEncrypted: encryptField(input.firstName),
      lastNameEncrypted: encryptField(input.lastName),
      whatsappEncrypted: encryptField(normalizedPhone),
      whatsappLookupHash: hashLookup(normalizedPhone),
      status: 'active',
      emailVerified: true,
    },
    update: {
      firstNameEncrypted: encryptField(input.firstName),
      lastNameEncrypted: encryptField(input.lastName),
      whatsappEncrypted: encryptField(normalizedPhone),
      whatsappLookupHash: hashLookup(normalizedPhone),
      status: 'active',
      emailVerified: true,
    },
  });

  await prisma.authCredential.upsert({
    where: { userId: user.id },
    create: { userId: user.id, passwordHash },
    update:
      process.env.SEED_FORCE_PASSWORD_RESET === 'true'
        ? { passwordHash }
        : {},
  });

  const membership = await prisma.authMembership.upsert({
    where: { userId_tenantId: { userId: user.id, tenantId: tenantUuid } },
    create: {
      userId: user.id,
      tenantId: tenantUuid,
      status: 'active',
      approvedAt: new Date(),
    },
    update: {
      status: 'active',
      removedAt: null,
      removedByMembershipId: null,
    },
  });

  const uniqueRoles = [...new Set(input.roles)];
  await prisma.authMembershipRole.deleteMany({ where: { membershipId: membership.id } });
  if (uniqueRoles.length > 0) {
    await prisma.authMembershipRole.createMany({
      data: uniqueRoles.map((role) => ({ membershipId: membership.id, role })),
    });
  }

  await prisma.authMembershipAccessGroup.deleteMany({ where: { membershipId: membership.id } });

  await prisma.authNotificationPreference.upsert({
    where: { membershipId: membership.id },
    create: { membershipId: membership.id },
    update: {},
  });

  return {
    email: input.email,
    displayName: `${input.firstName} ${input.lastName}`.trim(),
    roles: uniqueRoles,
    accessGroupIds: [] as string[],
  };
}

async function seed() {
  const env = loadEnv();

  if (env.NODE_ENV === 'production') {
    console.error('Seed não permitido em produção.');
    process.exit(1);
  }

  const devPassword = process.env.SEED_DEV_PASSWORD || 'dev-password-change-me';
  const passwordHash = await hashPassword(devPassword);

  const tenant = await ensureDevTenant();
  const sidnei = await ensureDevUser(SIDNEI_DEV_USER, tenant.id, passwordHash);
  const testJuridico = await ensureDevUser(TEST_JURIDICO_USER, tenant.id, passwordHash);

  const groupCount = await prisma.authAccessGroup.count({ where: { tenantId: tenant.id } });

  console.log('Seed concluído:');
  console.log(`  Tenant: ${tenant.tenantId} (${tenant.tenantType}, ${tenant.status})`);
  console.log(`  Access groups no tenant: ${groupCount} (nenhum grupo padrão é criado pelo seed)`);
  console.log(`  Senha dev (todos os usuários abaixo): ${devPassword}`);
  if (process.env.SEED_FORCE_PASSWORD_RESET === 'true') {
    console.log('  passwordHash: atualizado (SEED_FORCE_PASSWORD_RESET=true)');
  } else {
    console.log('  passwordHash: preservado para usuários existentes (use SEED_FORCE_PASSWORD_RESET=true para resetar)');
  }
  console.log('');
  console.log(`  ${sidnei.email}`);
  console.log(`    displayName: ${sidnei.displayName}`);
  console.log(`    roles: ${sidnei.roles.join(', ')}`);
  console.log(`    accessGroupIds: ${sidnei.accessGroupIds.length ? sidnei.accessGroupIds.join(', ') : '(nenhum)'}`);
  console.log('');
  console.log(`  ${testJuridico.email}`);
  console.log(`    displayName: ${testJuridico.displayName}`);
  console.log(`    roles: ${testJuridico.roles.join(', ')}`);
  console.log(`    accessGroupIds: ${testJuridico.accessGroupIds.length ? testJuridico.accessGroupIds.join(', ') : '(nenhum)'}`);
}

seed()
  .catch((err) => {
    console.error('Erro no seed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await disconnectPrisma();
  });
