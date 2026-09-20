import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';
import { resetEnvCache } from '../src/config/env.js';
import { hashLookup } from '../src/security/crypto.js';
import { normalizeEmail, normalizeTaxId } from '../src/utils/normalize.js';
import { DOQYN_TERMS_VERSION } from '../src/modules/terms/terms.constants.js';
import { TEST_ENV } from './setup.js';

/**
 * A recusa da Resend só é exercitada com a plataforma "de pé" (`isPlatformEmailConfigured()`
 * verdadeiro) — o mesmo caminho real que a produção usa. O `fetch` global fica mockado para as
 * duas chamadas externas do cadastro: provisionamento/sync no app principal (sucesso, como em
 * `individual-signups.test.ts`) e o POST para a Resend, que aqui responde com recusa.
 */
const mockFetch = vi.fn(async (url: string | URL | Request) => {
  if (String(url).includes('api.resend.com')) {
    return new Response(
      '{"message":"Invalid `to` field: entrega-falha@example.com"}',
      { status: 422 },
    );
  }
  return new Response(
    JSON.stringify({
      ok: true,
      tenantId: 'individual_teste_falha_email_ab12cd',
      collectionPrefix: 'compartilhado',
      createdCollections: ['documents_compartilhado'],
      createdIndexes: ['documents_compartilhado:ownerTenantId_1_ownerUserId_1_createdAt_-1'],
    }),
    { status: 200 },
  );
});

describe('cadastro cujo primeiro e-mail de verificação falha', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    Object.assign(process.env, {
      ...TEST_ENV,
      EMAIL_ENABLED: 'true',
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 'test-resend-key',
    });
    resetEnvCache();
    vi.stubGlobal('fetch', mockFetch);
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllGlobals();
    delete process.env.EMAIL_ENABLED;
    delete process.env.EMAIL_PROVIDER;
    delete process.env.RESEND_API_KEY;
    resetEnvCache();
  });

  beforeEach(() => {
    mockFetch.mockClear();
  });

  const payload = {
    firstName: 'Entrega',
    lastName: 'Falha',
    email: 'entrega-falha@example.com',
    whatsapp: '+5554999887766',
    country: 'BR',
    taxIdType: 'cpf',
    taxId: '52998224725',
    password: 'senha-dev-123',
    confirmPassword: 'senha-dev-123',
    acceptedTerms: true as const,
    acceptedTermsVersion: DOQYN_TERMS_VERSION,
  };

  it('responde 200 com emailVerificationRequired, verificationTicket e emailSent: false', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/individual-signups',
      payload,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.emailVerificationRequired).toBe(true);
    expect(body.verificationTicket).toBeTruthy();
    expect(body.emailSent).toBe(false);

    const taxIdHash = hashLookup(normalizeTaxId(payload.taxId));
    const tenant = await prisma.authTenant.findFirst({ where: { taxIdHash } });
    expect(tenant?.status).toBe('active');

    const user = await prisma.authUser.findFirst({
      where: { emailLookupHash: hashLookup(normalizeEmail(payload.email)) },
    });
    const audit = await prisma.authAuditLog.findFirst({
      where: { userId: user!.id, action: 'email_verification.sent' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
    const metadata = audit?.metadata as Record<string, unknown>;
    expect(metadata.emailSent).toBe(false);
    expect(typeof metadata.failureReason).toBe('string');
    expect(metadata.failureReason as string).not.toContain('entrega-falha@example.com');
  });
});
