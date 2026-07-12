import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createTestMembership, createTestTenant, createTestUser } from './helpers.js';
import { TEST_ENV } from './setup.js';

describe('login membership access errors', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('login sem activeMembership visível permite sessão (bloqueio ocorre na sessão)', async () => {
    await createTestUser('sem-empresa@empresa.com', 'senha-segura-123');

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'sem-empresa@empresa.com',
        password: 'senha-segura-123',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().ok).toBe(true);
  });

  it('login com tenant provisioning_failed retorna TENANT_PROVISIONING_FAILED', async () => {
    const user = await createTestUser('provision-fail@empresa.com', 'senha-segura-123');
    const tenant = await createTestTenant('tenant_provision_fail_login', {
      status: 'provisioning_failed',
    });
    await createTestMembership(user.id, tenant.id, 'pending');

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'provision-fail@empresa.com',
        password: 'senha-segura-123',
      },
    });

    expect(response.statusCode).toBe(403);
    const body = response.json();
    expect(body.code).toBe('TENANT_PROVISIONING_FAILED');
  });

  it('login com membership pending retorna MEMBERSHIP_PENDING', async () => {
    const user = await createTestUser('pendente@empresa.com', 'senha-segura-123');
    const tenant = await createTestTenant('tenant_pending_login');
    await createTestMembership(user.id, tenant.id, 'pending');

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'pendente@empresa.com',
        password: 'senha-segura-123',
      },
    });

    expect(response.statusCode).toBe(403);
    const body = response.json();
    expect(body.code).toBe('MEMBERSHIP_PENDING');
    expect(body.details?.status).toBe('pending');
  });

  it('login com membership blocked retorna MEMBERSHIP_BLOCKED', async () => {
    const user = await createTestUser('bloqueado@empresa.com', 'senha-segura-123');
    const tenant = await createTestTenant('tenant_blocked_login');
    await createTestMembership(user.id, tenant.id, 'blocked');

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'bloqueado@empresa.com',
        password: 'senha-segura-123',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('MEMBERSHIP_BLOCKED');
  });

  it('login com membership rejected retorna MEMBERSHIP_REJECTED', async () => {
    const user = await createTestUser('rejeitado@empresa.com', 'senha-segura-123');
    const tenant = await createTestTenant('tenant_rejected_login');
    await createTestMembership(user.id, tenant.id, 'rejected');

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'rejeitado@empresa.com',
        password: 'senha-segura-123',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('MEMBERSHIP_REJECTED');
  });
});
