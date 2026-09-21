import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';
import { resetEnvCache } from '../src/config/env.js';
import { hashLookup } from '../src/security/crypto.js';
import { normalizeEmail, normalizeTaxId } from '../src/utils/normalize.js';
import { DOQYN_TERMS_VERSION } from '../src/modules/terms/terms.constants.js';
import { drainEmailOutbox } from '../src/modules/email/emailOutboxDrain.js';
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

  it('a recusa do provedor deixa de aparecer na resposta e passa a morar no outbox', async () => {
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
    // Com o outbox, `emailSent` responde "foi enfileirado", não "a Resend aceitou" — o desfecho
    // do provedor ainda não é conhecido quando a resposta é montada. `false` aqui passou a
    // significar apenas "não há provedor configurado".
    expect(body.emailSent).toBe(true);

    const taxIdHash = hashLookup(normalizeTaxId(payload.taxId));
    const tenant = await prisma.authTenant.findFirst({ where: { taxIdHash } });
    expect(tenant?.status).toBe('active');

    const user = await prisma.authUser.findFirst({
      where: { emailLookupHash: hashLookup(normalizeEmail(payload.email)) },
    });

    // A linha nasce enfileirada, e o cadastro não esperou a rede para responder.
    const enfileirada = await prisma.authEmailOutbox.findFirst({
      where: { userId: user!.id, purpose: 'email_verification' },
    });
    expect(enfileirada?.status).toBe('queued');
    expect(enfileirada?.attempts).toBe(0);

    // Só agora o provedor é chamado — e recusa com 422, que não melhora repetindo.
    await drainEmailOutbox();

    const depois = await prisma.authEmailOutbox.findUniqueOrThrow({
      where: { id: enfileirada!.id },
    });
    expect(depois.status).toBe('failed');
    expect(depois.failureReason).toBeTruthy();
    // O corpo do erro da Resend repete o destinatário; ele não pode ficar legível em lugar nenhum.
    expect(depois.failureReason).not.toContain('entrega-falha@example.com');
    // E o corpo renderizado, que carregava o código de seis dígitos, some junto com a desistência.
    expect(depois.html).toBe('');
    expect(depois.text).toBe('');

    const audit = await prisma.authAuditLog.findFirst({
      where: { userId: user!.id, action: 'email_verification.sent' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
    expect((audit?.metadata as Record<string, unknown>).emailSent).toBe(true);
  });
});
