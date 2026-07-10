import { loadEnv } from '../config/env.js';
import {
  internalBuildTenantMemberSnapshot,
  type InternalTenantMemberSnapshot,
} from '../modules/internal/internal.service.js';

export type SyncTenantMemberResult =
  | { ok: true; memberId: string }
  | { ok: false; error: string; statusCode?: number };

export async function syncTenantMemberInMainApp(
  snapshot: InternalTenantMemberSnapshot,
): Promise<SyncTenantMemberResult> {
  const env = loadEnv();
  const baseUrl = env.DOQYN_APP_BASE_URL.replace(/\/$/, '');
  const url = `${baseUrl}/api/internal/tenant-members/sync`;

  try {
    const response = await globalThis.fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.DOQYN_APP_INTERNAL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(snapshot),
    });

    const data = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      message?: string;
      memberId?: string;
    };

    if (!response.ok || data.ok === false) {
      return {
        ok: false,
        error: data.message ?? 'Falha ao sincronizar membro no app principal.',
        statusCode: response.status,
      };
    }

    return {
      ok: true,
      memberId: data.memberId ?? snapshot.membershipId,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Erro de comunicação com o app principal.',
    };
  }
}

export async function awaitTenantMemberSync(
  membershipId: string,
): Promise<SyncTenantMemberResult | null> {
  const snapshot = await internalBuildTenantMemberSnapshot(membershipId);
  if (!snapshot) return null;

  const syncResult = await syncTenantMemberInMainApp(snapshot);
  if (!syncResult.ok) {
    console.warn('[member-sync] failed', {
      membershipId,
      error: syncResult.error,
    });
  }
  return syncResult;
}

export function scheduleTenantMemberSync(membershipId: string): void {
  void awaitTenantMemberSync(membershipId);
}
