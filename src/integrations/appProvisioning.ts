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
