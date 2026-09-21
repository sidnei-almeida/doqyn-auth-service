import { loadEnv } from '../config/env.js';

const INVALIDATE_TIMEOUT_MS = 5_000;

/**
 * Avisa o app principal para esquecer a sessão em cache destes usuários.
 *
 * O alpha guarda a sessão verificada em Redis por alguns segundos. Revogar aqui sem avisar deixava o
 * cookie valendo lá até o TTL vencer — logout, reset de senha e bloqueio não eram imediatos.
 *
 * Não espera nem lança: a revogação no Postgres já valeu, e o TTL curto do cache é o limite do
 * atraso se o aviso não chegar.
 */
export function scheduleAppSessionCacheInvalidation(userIds: Iterable<string>): void {
  const unique = [...new Set(userIds)].filter(Boolean);
  if (unique.length === 0) return;

  void (async () => {
    try {
      const env = loadEnv();
      const baseUrl = env.DOQYN_APP_BASE_URL.replace(/\/$/, '');
      const response = await globalThis.fetch(`${baseUrl}/api/internal/sessions/invalidate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.DOQYN_APP_INTERNAL_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userIds: unique }),
        signal: AbortSignal.timeout(INVALIDATE_TIMEOUT_MS),
      });
      if (!response.ok) {
        console.warn('[session-cache] invalidation refused', { status: response.status });
      }
    } catch (error) {
      console.warn('[session-cache] invalidation failed', {
        error: error instanceof Error ? error.message : 'unknown',
      });
    }
  })();
}
