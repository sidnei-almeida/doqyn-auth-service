import { prisma } from '../../db/prisma.js';
import {
  revokeMemberSharesInMainApp,
  type MembershipEndReason,
} from '../../integrations/shareRevocation.js';
import { auditCtx, logAuthAudit } from '../audit/authAudit.service.js';
import type { AdminActor } from './admin.types.js';

export type ShareRevocationCtx = { ipHash?: string; userAgentHash?: string };

/** Vínculos que ainda podem ter compartilhamento vivo. O removido já teve o seu cortado. */
const VINCULOS_VIVOS = ['active', 'pending', 'blocked'] as const;

/** Quantos cortes correm juntos: o app tem prazo de 10 s por chamada, e o admin espera o fim. */
const PARALELISMO = 5;

/**
 * Corta o que o membro compartilhou, depois que o vínculo dele acabou.
 *
 * Falha aqui não desfaz a remoção nem o bloqueio — o vínculo já caiu e a sessão também. Vai para a
 * trilha como `membership.shares_revocation_failed`, que é onde se descobre o que ficou vivo.
 */
export async function revokeSharesOfEndedMembership(
  actor: AdminActor,
  target: { userId: string; tenant: { tenantId: string } },
  membershipId: string,
  reason: MembershipEndReason,
  ctx?: ShareRevocationCtx,
): Promise<void> {
  const result = await revokeMemberSharesInMainApp({
    tenantId: target.tenant.tenantId,
    userId: target.userId,
    membershipId,
    reason,
  });

  if (!result.ok) {
    console.warn('[share-revocation] failed', { membershipId, error: result.error });
  }

  await logAuthAudit(
    result.ok ? 'membership.shares_revoked' : 'membership.shares_revocation_failed',
    auditCtx(actor, {
      targetUserId: target.userId,
      targetMembershipId: membershipId,
      tenantTextId: target.tenant.tenantId,
      ipHash: ctx?.ipHash,
      userAgentHash: ctx?.userAgentHash,
      metadata: result.ok
        ? {
            reason,
            revokedInternal: result.revokedInternal,
            revokedExternal: result.revokedExternal,
          }
        : { reason, error: result.error, statusCode: result.statusCode },
    }),
  );
}

async function revokeMany(
  actor: AdminActor,
  vinculos: Array<{ id: string; userId: string; tenant: { tenantId: string } }>,
  reason: MembershipEndReason,
  ctx?: ShareRevocationCtx,
): Promise<number> {
  for (let i = 0; i < vinculos.length; i += PARALELISMO) {
    await Promise.allSettled(
      vinculos
        .slice(i, i + PARALELISMO)
        .map((vinculo) =>
          revokeSharesOfEndedMembership(
            actor,
            { userId: vinculo.userId, tenant: vinculo.tenant },
            vinculo.id,
            reason,
            ctx,
          ),
        ),
    );
  }
  return vinculos.length;
}

/**
 * Bloquear o tenant inteiro derrubava as sessões e deixava de pé todo link externo que os membros
 * tinham criado — documento servido a terceiros sem login, de uma organização suspensa. Corta
 * vínculo por vínculo, com o mesmo endpoint idempotente do desligamento individual.
 */
export async function revokeSharesOfBlockedTenant(
  actor: AdminActor,
  tenantUuid: string,
  ctx?: ShareRevocationCtx,
): Promise<number> {
  const vinculos = await prisma.authMembership.findMany({
    where: { tenantId: tenantUuid, status: { in: [...VINCULOS_VIVOS] } },
    select: { id: true, userId: true, tenant: { select: { tenantId: true } } },
  });
  return revokeMany(actor, vinculos, 'tenant_blocked', ctx);
}

/**
 * Anonimizar apagava os dados pessoais e derrubava as sessões, mas o que a pessoa compartilhou
 * continuava servindo — inclusive por link externo, que não pede login nenhum.
 */
export async function revokeSharesOfAnonymizedUser(
  actor: AdminActor,
  userId: string,
  ctx?: ShareRevocationCtx,
): Promise<number> {
  const vinculos = await prisma.authMembership.findMany({
    where: { userId, status: { in: [...VINCULOS_VIVOS] } },
    select: { id: true, userId: true, tenant: { select: { tenantId: true } } },
  });
  return revokeMany(actor, vinculos, 'user_anonymized', ctx);
}
