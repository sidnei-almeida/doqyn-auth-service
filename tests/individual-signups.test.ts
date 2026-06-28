import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';
import { TEST_ENV } from './setup.js';
import { hashLookup } from '../src/security/crypto.js';
import { normalizeTaxId } from '../src/utils/normalize.js';
import { extractCookie } from './helpers.js';

const mockFetch = vi.fn();

describe('individual signups', () => {
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
        tenantId: 'individual_maria_silva_ab12cd',
        collectionPrefix: 'compartilhado',
        createdCollections: ['documents_compartilhado'],
        createdIndexes: ['documents_compartilhado:ownerTenantId_1_ownerUserId_1_createdAt_-1'],
      }),
    });
  });

  const payload = {
    firstName: 'Maria',
    lastName: 'Silva',
    email: 'maria-cpf-dev@example.com',
    whatsapp: '+5554999887766',
    taxId: '52998224725',
    password: 'senha-dev-123',
    confirmPassword: 'senha-dev-123',
    termsAccepted: true as const,
  };

  it('POST /auth/individual-signups cria tenant individual, membership e sessão', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/individual-signups',
      payload,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.tenant.tenantId).toMatch(/^individual_/);
    expect(body.tenant.tenantType).toBe('individual');
    expect(body.activeMembership.roles).toContain('individual_admin');
    expect(body.activeMembership.roles).toContain('user');
    expect(extractCookie(response.headers['set-cookie'] as string, 'doqyn_session')).toBeTruthy();

    const taxIdHash = hashLookup(normalizeTaxId(payload.taxId));
    const tenant = await prisma.authTenant.findFirst({ where: { taxIdHash } });
    expect(tenant?.status).toBe('active');
    expect(tenant?.tenantType).toBe('individual');
    expect(tenant?.tenantId).not.toContain('52998224725');

    const groups = await prisma.authAccessGroup.findMany({ where: { tenantId: tenant!.id } });
    expect(groups.length).toBe(0);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const provisionBody = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(provisionBody.tenantType).toBe('individual');
    expect(provisionBody.collectionPrefix).toBe('compartilhado');
  });

  it('CPF duplicado retorna CPF_ALREADY_EXISTS', async () => {
    await app.inject({ method: 'POST', url: '/auth/individual-signups', payload });

    const dup = await app.inject({
      method: 'POST',
      url: '/auth/individual-signups',
      payload: { ...payload, email: 'outro-cpf@example.com' },
    });

    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe('CPF_ALREADY_EXISTS');
  });

  it('falha de provisionamento mantém tenant provisioning_failed', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => ({ ok: false, message: 'Falha' }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/individual-signups',
      payload: { ...payload, email: 'fail-cpf@example.com', taxId: '39053344705' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('PROVISIONING_FAILED');

    const taxIdHash = hashLookup(normalizeTaxId('39053344705'));
    const tenant = await prisma.authTenant.findFirst({ where: { taxIdHash } });
    expect(tenant?.status).toBe('provisioning_failed');
  });
});
