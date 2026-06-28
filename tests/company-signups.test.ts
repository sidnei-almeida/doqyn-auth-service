import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';
import { TEST_ENV } from './setup.js';
import { hashLookup } from '../src/security/crypto.js';
import { normalizeTaxId } from '../src/utils/normalize.js';
import { extractCookie } from './helpers.js';

const mockFetch = vi.fn();

describe('company signups', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    vi.stubGlobal('fetch', mockFetch);
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        tenantId: 'company_acme_test_ab12cd',
        collectionPrefix: 'company_acme_test_ab12cd',
        createdCollections: ['documents_company_acme_test_ab12cd'],
        createdIndexes: ['documents_company_acme_test_ab12cd:tenantId_1_status_1_updatedAt_-1'],
      }),
    });
  });

  const payload = {
    companyName: 'ACME Teste',
    taxId: '11222333000181',
    firstName: 'Sidnei',
    lastName: 'Teste',
    email: 'admin-acme-dev@example.com',
    whatsapp: '+5554999887766',
    password: 'senha-dev-123',
    confirmPassword: 'senha-dev-123',
    termsAccepted: true as const,
  };

  it('POST /auth/company-signups cria tenant, admin, grupos e sessão', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/company-signups',
      payload,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.tenant.tenantId).toMatch(/^company_/);
    expect(body.activeMembership.roles).toContain('company_admin');
    expect(body.activeMembership.roles).toContain('user');
    expect(extractCookie(response.headers['set-cookie'] as string, 'doqyn_session')).toBeTruthy();

    const taxIdHash = hashLookup(normalizeTaxId(payload.taxId));
    const tenant = await prisma.authTenant.findFirst({ where: { taxIdHash } });
    expect(tenant?.status).toBe('active');

    const groups = await prisma.authAccessGroup.findMany({ where: { tenantId: tenant!.id } });
    expect(groups.length).toBe(5);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('CNPJ duplicado retorna COMPANY_ALREADY_EXISTS', async () => {
    await app.inject({ method: 'POST', url: '/auth/company-signups', payload });

    const dup = await app.inject({
      method: 'POST',
      url: '/auth/company-signups',
      payload: { ...payload, email: 'outro@example.com' },
    });

    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe('COMPANY_ALREADY_EXISTS');
  });

  it('senha fraca é rejeitada', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/company-signups',
      payload: {
        ...payload,
        email: 'fraca@example.com',
        taxId: '22333444000155',
        password: '12345678',
        confirmPassword: '12345678',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('WEAK_PASSWORD');
  });

  it('payload inválido retorna VALIDATION_ERROR', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/company-signups',
      payload: { companyName: 'X' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('VALIDATION_ERROR');
  });

  it('falha de provisionamento mantém tenant provisioning_failed', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ ok: false, message: 'mongo down' }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/company-signups',
      payload: {
        ...payload,
        email: 'fail-provision@example.com',
        taxId: '33444555000166',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('PROVISIONING_FAILED');

    const tenant = await prisma.authTenant.findFirst({
      where: { taxIdHash: { not: null }, status: 'provisioning_failed' },
    });
    expect(tenant).toBeTruthy();

    const audits = await prisma.authAuditLog.findMany({
      where: { action: 'company_signup.provision_failed' },
    });
    expect(audits.length).toBeGreaterThan(0);
  });

  it('login continua funcionando após signup', async () => {
    await app.inject({ method: 'POST', url: '/auth/company-signups', payload });

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: payload.email, password: payload.password },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().ok).toBe(true);
  });
});
