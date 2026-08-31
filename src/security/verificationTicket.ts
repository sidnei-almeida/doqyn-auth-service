import { timingSafeEqual } from 'node:crypto';

import { loadEnv } from '../config/env.js';
import { signVerificationTicket } from './crypto.js';

/**
 * O passe que autoriza confirmar um e-mail sem sessão.
 *
 * Login bloqueado por e-mail não confirmado não pode devolver cookie — é justamente o acesso que
 * está sendo negado. Mas a pessoa precisa de algum jeito de pedir o código e conferi-lo, e as
 * rotas que fazem isso ficariam abertas ao mundo se aceitassem só o endereço: qualquer um poderia
 * despejar e-mail na caixa de entrada de qualquer cadastro. O ticket resolve isso amarrando as
 * duas rotas a quem acabou de acertar a senha (ou de criar a conta).
 *
 * É assinado, não guardado. Não há tabela, não há migration, e o custo disso é não poder revogar
 * um ticket antes da hora — aceitável porque ele não abre nada além das próprias rotas de
 * verificação, e porque elas param de funcionar assim que o e-mail é confirmado.
 */
const SEPARATOR = '.';

export function issueEmailVerificationTicket(userId: string): string {
  const expiresAt = Date.now() + loadEnv().EMAIL_VERIFICATION_TICKET_TTL_MINUTES * 60 * 1000;
  const payload = `${userId}${SEPARATOR}${expiresAt}`;
  return `${payload}${SEPARATOR}${signVerificationTicket(payload)}`;
}

/** Devolve o `userId` do ticket, ou `null` se ele foi forjado, adulterado ou expirou. */
export function readEmailVerificationTicket(ticket: string): string | null {
  const parts = ticket.split(SEPARATOR);
  if (parts.length !== 3) return null;

  const [userId, expiresAtRaw, signature] = parts;
  const payload = `${userId}${SEPARATOR}${expiresAtRaw}`;

  // A assinatura é conferida antes do prazo: comparar a data primeiro deixaria um ticket forjado
  // com data inválida sair por um caminho diferente do de um forjado com data válida, e a
  // diferença é observável.
  if (!signaturesMatch(signature, signVerificationTicket(payload))) return null;

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;

  return userId;
}

function signaturesMatch(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}
