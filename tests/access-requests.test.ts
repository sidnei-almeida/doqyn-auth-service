import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';
import { encryptField, hashLookup } from '../src/security/crypto.js';
import { detectTaxIdType, maskTaxId, normalizeTaxId } from '../src/utils/normalize.js';
import { TEST_ENV } from './setup.js';

describe('access requests', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    app = await buildApp();
    await app.ready();
  });

  beforeEach(async () => {
    const taxId = normalizeTaxId('12345678000199');
    await prisma.authTenant.create({
      data: {
        tenantId: 'company_access_test',
        tenantType: 'business',
        displayNameEncrypted: encryptField('Empresa Existente'),
        displayNameLookupHash: hashLookup('empresa existente'),
        slug: 'empresa_existente',
        taxIdType: detectTaxIdType(taxId),
        taxIdMasked: maskTaxId(taxId),
        taxIdHash: hashLookup(taxId),
        status: 'active',
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const payload = {
    personType: 'business' as const,
    taxId: '12345678000199',
    firstName: 'João',
    lastName: 'Silva',
    email: 'joao.novo@empresa.com',
    whatsapp: '+5554999887766',
    password: 'senha-segura-123',
    jobTitle: 'Analista',
    departmentText: 'Financeiro',
    reason: 'Preciso acessar documentos.',
    operationalNotificationsConsent: true,
  };

  it('/auth/access-requests cria user, membership pending e request pending em tenant existente', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/access-requests',
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().message).toContain('administrador da empresa');

    const tenants = await prisma.authTenant.count();
    expect(tenants).toBe(1);

    const memberships = await prisma.authMembership.findMany({ where: { status: 'pending' } });
    const requests = await prisma.authAccessRequest.findMany({ where: { status: 'pending' } });

    expect(memberships.length).toBe(1);
    expect(requests.length).toBe(1);
  });

  it('não cria tenant novo quando CNPJ não existe', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/access-requests',
      payload: { ...payload, email: 'novo@empresa.com', taxId: '98765432000111' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('TENANT_NOT_FOUND');
    expect(await prisma.authTenant.count()).toBe(1);
  });

  it('usuário não escolhe role/grupo real', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/access-requests',
      payload: { ...payload, email: 'sem.role@empresa.com' },
    });

    const membership = await prisma.authMembership.findFirst({
      where: { status: 'pending' },
      include: { roles: true, accessGroupLinks: true },
    });

    expect(membership?.roles.length).toBe(0);
    expect(membership?.accessGroupLinks.length).toBe(0);
  });

  it('notification preferences padrão criadas', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/access-requests',
      payload: { ...payload, email: 'prefs@empresa.com' },
    });

    const prefs = await prisma.authNotificationPreference.findMany();
    expect(prefs.length).toBeGreaterThan(0);
    expect(prefs[0]?.email).toBe(true);
    expect(prefs[0]?.whatsapp).toBe(true);
  });

  it('rejeita personType individual', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/access-requests',
      payload: {
        ...payload,
        personType: 'individual',
        taxId: '52998224725',
        email: 'pf@example.com',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('INDIVIDUAL_ACCESS_NOT_SUPPORTED');
  });

  it('rejeita tenant individual ativo', async () => {
    const cpf = normalizeTaxId('39053344705');
    await prisma.authTenant.create({
      data: {
        tenantId: 'individual_access_test',
        tenantType: 'individual',
        displayNameEncrypted: encryptField('Pessoa Física Teste'),
        displayNameLookupHash: hashLookup('pessoa fisica teste'),
        slug: 'pessoa_fisica_teste',
        taxIdType: detectTaxIdType(cpf),
        taxIdMasked: maskTaxId(cpf),
        taxIdHash: hashLookup(cpf),
        status: 'active',
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/access-requests',
      payload: {
        ...payload,
        taxId: '39053344705',
        email: 'pf-tenant@example.com',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('TENANT_NOT_BUSINESS');
  });
});
