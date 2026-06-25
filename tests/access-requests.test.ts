import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';
import { TEST_ENV } from './setup.js';

describe('access requests', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const payload = {
    personType: 'business' as const,
    taxId: '12345678000199',
    tenantDisplayName: 'Empresa Nova',
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

  it('/auth/access-requests cria user, tenant, membership pending e request pending', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/access-requests',
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().ok).toBe(true);

    const users = await prisma.authUser.count();
    const tenants = await prisma.authTenant.count();
    const memberships = await prisma.authMembership.findMany({ where: { status: 'pending' } });
    const requests = await prisma.authAccessRequest.findMany({ where: { status: 'pending' } });

    expect(users).toBeGreaterThan(0);
    expect(tenants).toBeGreaterThan(0);
    expect(memberships.length).toBe(1);
    expect(requests.length).toBe(1);
  });

  it('usuário não escolhe role/grupo real', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/access-requests',
      payload: { ...payload, email: 'sem.role@empresa.com', taxId: '98765432000111' },
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
      payload: { ...payload, email: 'prefs@empresa.com', taxId: '11122233344' },
    });

    const prefs = await prisma.authNotificationPreference.findMany();
    expect(prefs.length).toBeGreaterThan(0);
    expect(prefs[0]?.email).toBe(true);
    expect(prefs[0]?.whatsapp).toBe(true);
  });
});
