import { loadEnv } from '../config/env.js';

export interface ProvisionTenantPayload {
  tenantId: string;
  tenantType: 'business' | 'individual';
  displayName: string;
  /** ISO 3166-1 alpha-2 (ex.: BR, PY, US, ES). */
  country: string;
  /** Tipo de documento fiscal detectado (ex.: cpf, cnpj, ruc, ssn, ein). */
  taxIdType: string;
  collectionPrefix: string;
  createdByUserId: string;
  createdByMembershipId: string;
}

export type ProvisionTenantResult =
  | {
      ok: true;
      tenantId: string;
      collectionPrefix: string;
      createdCollections: string[];
      createdIndexes: string[];
    }
  | {
      ok: false;
      error: string;
      statusCode?: number;
    };

export interface RevokeMembershipSharesPayload {
  tenantId: string;
  userId: string;
  membershipId: string;
  reason: 'membership_removed' | 'membership_blocked';
}

export type RevokeMembershipSharesResult =
  | { ok: true; revokedInternal: number; revokedExternal: number }
  | { ok: false; error: string; statusCode?: number };

/**
 * Manda o app principal revogar os compartilhamentos concedidos por um membro.
 *
 * O vínculo mora aqui e os compartilhamentos moram lá, então revogar sessão não bastava: o link
 * externo criado pelo desligado continuava servindo o arquivo a um terceiro sem login, e o
 * compartilhamento interno continuava na lista do colega.
 *
 * A falha é registrada pelo chamador mas não derruba o desligamento: cortar a sessão é a parte
 * urgente, e o app principal fora do ar não pode impedir um bloqueio de segurança.
 */
export async function revokeMembershipSharesInMainApp(
  payload: RevokeMembershipSharesPayload,
): Promise<RevokeMembershipSharesResult> {
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
      body: JSON.stringify(payload),
    });

    const data = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      message?: string;
      error?: string;
      revokedInternal?: number;
      revokedExternal?: number;
    };

    if (!response.ok || data.ok === false) {
      return {
        ok: false,
        error: data.message ?? data.error ?? 'Falha ao revogar compartilhamentos do membro.',
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

export async function provisionTenantInMainApp(
  payload: ProvisionTenantPayload,
): Promise<ProvisionTenantResult> {
  const env = loadEnv();
  const baseUrl = env.DOQYN_APP_BASE_URL.replace(/\/$/, '');
  const url = `${baseUrl}/api/internal/tenants/provision`;

  try {
    const response = await globalThis.fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.DOQYN_APP_INTERNAL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      message?: string;
      code?: string;
      error?: string;
      tenantId?: string;
      collectionPrefix?: string;
      createdCollections?: string[];
      createdIndexes?: string[];
    };

    if (!response.ok || data.ok === false) {
      return {
        ok: false,
        error: data.message ?? data.error ?? 'Falha no provisionamento do ambiente documental.',
        statusCode: response.status,
      };
    }

    return {
      ok: true,
      tenantId: data.tenantId ?? payload.tenantId,
      collectionPrefix: data.collectionPrefix ?? payload.collectionPrefix,
      createdCollections: data.createdCollections ?? [],
      createdIndexes: data.createdIndexes ?? [],
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Erro de comunicação com o app principal.',
    };
  }
}
