import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';
import { getSessionCookieName } from '../src/security/cookies.js';
import * as shareRevocation from '../src/integrations/shareRevocation.js';
import {
  revokeSharesOfAnonymizedUser,
  revokeSharesOfBlockedTenant,
} from '../src/modules/admin/memberShareRevocation.js';
import {
  assignRoles,
  createTestMembership,
  createTestTenant,
  createTestUser,
  loginUser,
  setupAdminUser,
} from './helpers.js';
import { TEST_ENV } from './setup.js';

const cookieName = getSessionCookieName();

describe('desligamento revoga os compartilhamentos do membro no app', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  async function setupTarget(prefix: string) {
    const { membership: adminMembership, tenant } = await setupAdminUser(
      `${prefix}.admin@empresa.com`,
      'senha-segura-123',
      `tenant_${prefix}`,
    );
    const user = await createTestUser(`${prefix}.member@empresa.com`, 'senha-segura-123');
    const target = await createTestMembership(user.id, tenant.id, 'active');
    await assignRoles(target.id, ['user']);

    const { token } = await loginUser(
      app,
      `${prefix}.admin@empresa.com`,
      'senha-segura-123',
      cookieName,
    );
    await app.inject({
      method: 'POST',
      url: '/auth/select-tenant',
      headers: { cookie: `${cookieName}=${token}` },
      payload: { membershipId: adminMembership.id },
    });

    return { token, user, target, tenant };
  }

  it('remover membro avisa o app com tenant, usuário e motivo', async () => {
    const spy = vi
      .spyOn(shareRevocation, 'revokeMemberSharesInMainApp')
      .mockResolvedValue({ ok: true, revokedInternal: 2, revokedExternal: 1 });
    const { token, user, target, tenant } = await setupTarget('revoke_remove');

    const response = await app.inject({
      method: 'POST',
      url: `/auth/admin/members/${target.id}/remove`,
      headers: { cookie: `${cookieName}=${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(spy).toHaveBeenCalledWith({
      tenantId: tenant.tenantId,
      userId: user.id,
      membershipId: target.id,
      reason: 'membership_removed',
    });
    const audit = await prisma.authAuditLog.findFirst({
      where: { action: 'membership.shares_revoked', targetMembershipId: target.id },
    });
    expect(audit).not.toBeNull();
  });

  it('bloquear membro avisa o app', async () => {
    const spy = vi
      .spyOn(shareRevocation, 'revokeMemberSharesInMainApp')
      .mockResolvedValue({ ok: true, revokedInternal: 0, revokedExternal: 0 });
    const { token, user, target, tenant } = await setupTarget('revoke_block');

    const response = await app.inject({
      method: 'POST',
      url: `/auth/admin/members/${target.id}/block`,
      headers: { cookie: `${cookieName}=${token}` },
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(spy).toHaveBeenCalledWith({
      tenantId: tenant.tenantId,
      userId: user.id,
      membershipId: target.id,
      reason: 'membership_blocked',
    });
  });

  it('app fora do ar não desfaz o bloqueio, e a falha fica na trilha', async () => {
    vi.spyOn(shareRevocation, 'revokeMemberSharesInMainApp').mockResolvedValue({
      ok: false,
      error: 'fetch failed',
    });
    const { token, target } = await setupTarget('revoke_fail');

    const response = await app.inject({
      method: 'POST',
      url: `/auth/admin/members/${target.id}/block`,
      headers: { cookie: `${cookieName}=${token}` },
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    const stored = await prisma.authMembership.findUnique({ where: { id: target.id } });
    expect(stored?.status).toBe('blocked');
    const audit = await prisma.authAuditLog.findFirst({
      where: { action: 'membership.shares_revocation_failed', targetMembershipId: target.id },
    });
    expect(audit).not.toBeNull();
  });
});

describe('bloqueio de tenant e anonimização cortam o que os membros compartilharam', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function actorFor(membershipId: string, tenantTextId: string, userId: string) {
    return {
      userId,
      membership: { membershipId, tenantId: tenantTextId },
    } as unknown as Parameters<typeof revokeSharesOfBlockedTenant>[0];
  }

  it('tenant bloqueado corta os vínculos vivos, não o já removido', async () => {
    const spy = vi
      .spyOn(shareRevocation, 'revokeMemberSharesInMainApp')
      .mockResolvedValue({ ok: true, revokedInternal: 1, revokedExternal: 1 });

    const tenant = await createTestTenant('tenant_block_shares');
    const ativo = await createTestUser('block.ativo@empresa.com', 'senha-segura-123');
    const removido = await createTestUser('block.removido@empresa.com', 'senha-segura-123');
    const vinculoAtivo = await createTestMembership(ativo.id, tenant.id, 'active');
    const vinculoRemovido = await createTestMembership(removido.id, tenant.id, 'active');
    await prisma.authMembership.update({
      where: { id: vinculoRemovido.id },
      data: { status: 'removed' },
    });

    const total = await revokeSharesOfBlockedTenant(
      actorFor(vinculoAtivo.id, tenant.tenantId, ativo.id),
      tenant.id,
    );

    expect(total).toBe(1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({
      tenantId: tenant.tenantId,
      userId: ativo.id,
      membershipId: vinculoAtivo.id,
      reason: 'tenant_blocked',
    });
  });

  it('usuário anonimizado tem o compartilhamento cortado em todos os tenants', async () => {
    const spy = vi
      .spyOn(shareRevocation, 'revokeMemberSharesInMainApp')
      .mockResolvedValue({ ok: true, revokedInternal: 0, revokedExternal: 3 });

    const tenantA = await createTestTenant('tenant_anon_a');
    const tenantB = await createTestTenant('tenant_anon_b');
    const user = await createTestUser('anon.alvo@empresa.com', 'senha-segura-123');
    await createTestMembership(user.id, tenantA.id, 'active');
    await createTestMembership(user.id, tenantB.id, 'blocked');

    const total = await revokeSharesOfAnonymizedUser(
      actorFor('00000000-0000-0000-0000-000000000000', tenantA.tenantId, user.id),
      user.id,
    );

    expect(total).toBe(2);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls.every(([arg]) => arg.reason === 'user_anonymized')).toBe(true);
  });
});
