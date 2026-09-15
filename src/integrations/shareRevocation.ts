import { loadEnv } from '../config/env.js';

/** O desligamento espera por esta chamada; sem prazo, um app travado segurava a tela do admin. */
const SHARE_REVOCATION_TIMEOUT_MS = 10_000;

export type MembershipEndReason = 'membership_removed' | 'membership_blocked';

export type RevokeMemberSharesInput = {
  /** Id textual do tenant (`tenant.tenantId`), o mesmo que o app grava nos grants. */
  tenantId: string;
  userId: string;
  membershipId: string;
  reason: MembershipEndReason;
};

export type RevokeMemberSharesResult =
  | { ok: true; revokedInternal: number; revokedExternal: number }
  | { ok: false; error: string; statusCode?: number };

/**
 * Avisa o app principal que um vínculo acabou, para ele revogar o que o membro compartilhou.
 *
 * Os compartilhamentos moram no app e o vínculo mora aqui. Sem este aviso, o funcionário desligado
 * perdia a sessão, mas o link externo que ele criou continuava servindo o documento a terceiros sem
 * login. O endpoint do app é idempotente: repetir não revoga nada duas vezes.
 */
export async function revokeMemberSharesInMainApp(
  input: RevokeMemberSharesInput,
): Promise<RevokeMemberSharesResult> {
  const env = loadEnv();
  const baseUrl = env.DOQYN_APP_BASE_URL.replace(/\/$/, '');
  const url = `${baseUrl}/api/internal/memberships/revoke-shares`;

  try {
    const response = await globalThis.fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.DOQYN_APP_INTERNAL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(SHARE_REVOCATION_TIMEOUT_MS),
    });

    const data = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      message?: string;
      revokedInternal?: number;
      revokedExternal?: number;
    };

    if (!response.ok || data.ok === false) {
      return {
        ok: false,
        error: data.message ?? 'Falha ao revogar compartilhamentos no app principal.',
        statusCode: response.status,
      };
    }

    return {
      ok: true,
      revokedInternal: data.revokedInternal ?? 0,
      revokedExternal: data.revokedExternal ?? 0,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Erro de comunicação com o app principal.',
    };
  }
}
