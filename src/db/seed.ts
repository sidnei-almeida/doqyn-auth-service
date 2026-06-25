import { loadEnv } from '../config/env.js';
import { prisma, disconnectPrisma } from './prisma.js';
import { encryptField, hashLookup } from '../security/crypto.js';
import { hashPassword } from '../security/password.js';
import { normalizeEmail, normalizePhone } from '../utils/normalize.js';

/**
 * Seed de desenvolvimento — NUNCA executar em produção.
 *
 * Cria:
 * - tenant company_dev (business, active)
 * - usuário sidnei@doqyn.dev
 * - membership active com roles company_admin + user
 * - grupos: financeiro, juridico, rh, compras, diretoria
 * - sidnei vinculado a TODOS os grupos (decisão documentada para dev)
 */
async function seed() {
  const env = loadEnv();

  if (env.NODE_ENV === 'production') {
    console.error('Seed não permitido em produção.');
    process.exit(1);
  }

  const devPassword = process.env.SEED_DEV_PASSWORD || 'dev-password-change-me';
  const email = 'sidnei@doqyn.dev';
  const normalizedEmail = normalizeEmail(email);
  const emailLookupHash = hashLookup(normalizedEmail);

  const passwordHash = await hashPassword(devPassword);

  const tenant = await prisma.authTenant.upsert({
    where: { tenantId: 'company_dev' },
    create: {
      tenantId: 'company_dev',
      tenantType: 'business',
      displayNameEncrypted: encryptField('DOQYN Dev'),
      displayNameLookupHash: hashLookup('doqyn dev'),
      slug: 'company_dev',
      status: 'active',
    },
    update: {
      status: 'active',
      displayNameEncrypted: encryptField('DOQYN Dev'),
    },
  });

  const user = await prisma.authUser.upsert({
    where: { emailLookupHash },
    create: {
      emailEncrypted: encryptField(normalizedEmail),
      emailLookupHash,
      firstNameEncrypted: encryptField('Sidnei'),
      lastNameEncrypted: encryptField('Dev'),
      whatsappEncrypted: encryptField(normalizePhone('+5554999999999')),
      whatsappLookupHash: hashLookup(normalizePhone('+5554999999999')),
      status: 'active',
      emailVerified: true,
    },
    update: {
      firstNameEncrypted: encryptField('Sidnei'),
      lastNameEncrypted: encryptField('Dev'),
    },
  });

  await prisma.authCredential.upsert({
    where: { userId: user.id },
    create: { userId: user.id, passwordHash },
    update: { passwordHash },
  });

  const membership = await prisma.authMembership.upsert({
    where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
    create: {
      userId: user.id,
      tenantId: tenant.id,
      status: 'active',
      approvedAt: new Date(),
    },
    update: { status: 'active' },
  });

  await prisma.authMembershipRole.deleteMany({ where: { membershipId: membership.id } });
  await prisma.authMembershipRole.createMany({
    data: [
      { membershipId: membership.id, role: 'company_admin' },
      { membershipId: membership.id, role: 'user' },
    ],
  });

  const groupDefs = [
    { groupId: 'group_financeiro', name: 'Financeiro', slug: 'financeiro' },
    { groupId: 'group_juridico', name: 'Jurídico', slug: 'juridico' },
    { groupId: 'group_rh', name: 'RH', slug: 'rh' },
    { groupId: 'group_compras', name: 'Compras', slug: 'compras' },
    { groupId: 'group_diretoria', name: 'Diretoria', slug: 'diretoria' },
  ];

  const groupRecords = [];
  for (const g of groupDefs) {
    const record = await prisma.authAccessGroup.upsert({
      where: { tenantId_groupId: { tenantId: tenant.id, groupId: g.groupId } },
      create: {
        tenantId: tenant.id,
        groupId: g.groupId,
        nameEncrypted: encryptField(g.name),
        slug: g.slug,
        status: 'active',
      },
      update: {
        nameEncrypted: encryptField(g.name),
        status: 'active',
      },
    });
    groupRecords.push(record);
  }

  await prisma.authMembershipAccessGroup.deleteMany({ where: { membershipId: membership.id } });
  await prisma.authMembershipAccessGroup.createMany({
    data: groupRecords.map((g) => ({
      membershipId: membership.id,
      accessGroupId: g.id,
    })),
  });

  await prisma.authNotificationPreference.upsert({
    where: { membershipId: membership.id },
    create: { membershipId: membership.id },
    update: {},
  });

  console.log('Seed concluído:');
  console.log(`  Tenant: ${tenant.tenantId}`);
  console.log(`  Usuário: ${email}`);
  console.log(`  Senha (apenas dev): ${devPassword}`);
  console.log(`  Roles: company_admin, user`);
  console.log(`  Grupos: ${groupDefs.map((g) => g.groupId).join(', ')}`);
}

seed()
  .catch((err) => {
    console.error('Erro no seed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await disconnectPrisma();
  });
