import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';
import { encryptField, hashLookup } from '../src/security/crypto.js';
import { detectTaxIdType, maskTaxId, normalizeTaxId } from '../src/utils/normalize.js';
import { getSessionCookieName } from '../src/security/cookies.js';
import { loginUser, createTestUser, createTestMembership, assignRoles } from './helpers.js';
import { DOQYN_TERMS_VERSION } from '../src/modules/terms/terms.constants.js';
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
    acceptedTerms: true as const,
    acceptedTermsVersion: DOQYN_TERMS_VERSION,
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

  it('GET admin access-requests retorna detalhes completos sem senha', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/access-requests',
      payload,
    });

    const tenant = await prisma.authTenant.findFirst({
      where: { tenantId: 'company_access_test' },
    });
    expect(tenant).toBeTruthy();

    const cookieName = getSessionCookieName();
    const adminUser = await createTestUser('admin.access.list@empresa.com', 'senha-segura-123');
    const adminMembership = await createTestMembership(adminUser.id, tenant!.id, 'active');
    await assignRoles(adminMembership.id, ['company_admin']);
    await prisma.authNotificationPreference.create({
      data: { membershipId: adminMembership.id },
    });

    const { token: adminToken } = await loginUser(
      app,
      'admin.access.list@empresa.com',
      'senha-segura-123',
      cookieName,
    );

    await app.inject({
      method: 'POST',
      url: '/auth/select-tenant',
      headers: { cookie: `${cookieName}=${adminToken}` },
      payload: { membershipId: adminMembership.id },
    });

    const listResponse = await app.inject({
      method: 'GET',
      url: '/auth/admin/access-requests?status=pending',
      headers: { cookie: `${cookieName}=${adminToken}` },
    });

    expect(listResponse.statusCode).toBe(200);
    const body = listResponse.json();
    expect(body.requests.length).toBeGreaterThan(0);
    const request = body.requests[0];
    expect(request.requester.email).toBe(payload.email);
    expect(request.requestedAccess.jobTitle).toBe(payload.jobTitle);
    expect(request.requestedAccess.departmentText).toBe(payload.departmentText);
    expect(request.requestedAccess.reason).toBe(payload.reason);
    expect(request.consent?.operationalNotificationsConsent).toBe(true);
    expect(request.terms?.accepted).toBe(true);
    expect(request.terms?.version).toBe(DOQYN_TERMS_VERSION);
    expect(JSON.stringify(request)).not.toMatch(/password/i);
    expect(JSON.stringify(request)).not.toMatch(/passwordHash/i);
  });

  it('persiste consentTextVersion na solicitação', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/access-requests',
      payload: { ...payload, email: 'consent@empresa.com' },
    });

    const stored = await prisma.authAccessRequest.findFirst({
      where: { status: 'pending' },
      orderBy: { requestedAt: 'desc' },
    });

    expect(stored?.consentTextVersion).toBe('operational-notifications-v1');
  });

  it('persiste aceite de termos na solicitação', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/access-requests',
      payload: { ...payload, email: 'terms@empresa.com' },
    });

    const acceptance = await prisma.authTermsAcceptance.findFirst({
      where: { flow: 'access_request' },
      orderBy: { acceptedAt: 'desc' },
    });

    expect(acceptance?.termsVersion).toBe(DOQYN_TERMS_VERSION);
    expect(acceptance?.accessRequestId).toBeTruthy();
  });

  it('rejeita solicitação sem acceptedTerms', async () => {
    const { acceptedTerms: _acceptedTerms, acceptedTermsVersion: _version, ...withoutTerms } =
      payload;

    const response = await app.inject({
      method: 'POST',
      url: '/auth/access-requests',
      payload: { ...withoutTerms, email: 'sem-termos@empresa.com' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('TERMS_ACCEPTANCE_REQUIRED');
  });

  it('rejeita versão inválida dos termos', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/access-requests',
      payload: {
        ...payload,
        email: 'versao-invalida@empresa.com',
        acceptedTermsVersion: 'v0.9-old',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('TERMS_VERSION_INVALID');
  });
});
