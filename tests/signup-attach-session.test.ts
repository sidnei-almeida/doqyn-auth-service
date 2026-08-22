import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';
import { TEST_ENV } from './setup.js';
import { encryptField, hashLookup } from '../src/security/crypto.js';
import { normalizeEmail } from '../src/utils/normalize.js';
import { createSession } from '../src/modules/sessions/sessions.service.js';
import { getSessionCookieName } from '../src/security/cookies.js';
import { DOQYN_TERMS_VERSION } from '../src/modules/terms/terms.constants.js';

const mockFetch = vi.fn();
const cookieName = getSessionCookieName();

/** Usuário como o callback do OAuth o cria: sem senha, sem membership, não verificado ainda. */
async function createOAuthLikeUser(email: string) {
  const normalized = normalizeEmail(email);
  return prisma.authUser.create({
    data: {
      emailEncrypted: encryptField(normalized),
      emailLookupHash: hashLookup(normalized),
      firstNameEncrypted: encryptField('Sidnei'),
      lastNameEncrypted: encryptField('Almeida'),
      status: 'pending_verification',
      emailVerified: true,
    },
  });
}

describe('cadastro a partir de sessão autenticada (onboarding pós-OAuth)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    vi.stubGlobal('fetch', mockFetch);
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        tenantId: 'individual_sidnei_almeida_ab12cd',
        collectionPrefix: 'compartilhado',
        createdCollections: ['documents_compartilhado'],
        createdIndexes: [],
      }),
    });
  });

  /** Payload do modo autenticado: sem senha e sem e-mail — a identidade vem da sessão. */
  const attachPayload = {
    firstName: 'Sidnei',
    lastName: 'Almeida',
    whatsapp: '+5554999887766',
    country: 'BR',
    taxIdType: 'cpf',
    taxId: '52998224725',
    acceptedTerms: true as const,
    acceptedTermsVersion: DOQYN_TERMS_VERSION,
  };

  it('anexa tenant e membership ao usuário da sessão, sem exigir senha', async () => {
    const user = await createOAuthLikeUser('attach-pf@example.com');
    const session = await createSession(user.id);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/individual-signups',
      headers: { cookie: `${cookieName}=${session.token}` },
      payload: attachPayload,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.user.id).toBe(user.id);

    // Nenhum usuário novo foi criado para o mesmo e-mail.
    const usersWithEmail = await prisma.authUser.count({
      where: { emailLookupHash: hashLookup(normalizeEmail('attach-pf@example.com')) },
    });
    expect(usersWithEmail).toBe(1);

    const refreshed = await prisma.authUser.findUnique({ where: { id: user.id } });
    expect(refreshed?.status).toBe('active');

    // Conta sem senha continua sem credencial — o acesso é pelo provedor.
    const credentials = await prisma.authCredential.count({ where: { userId: user.id } });
    expect(credentials).toBe(0);

    const membership = await prisma.authMembership.findFirst({ where: { userId: user.id } });
    expect(membership).not.toBeNull();
  });

  it('recusa quando a conta da sessão já tem membership', async () => {
    const user = await createOAuthLikeUser('attach-dup@example.com');
    const session = await createSession(user.id);

    const first = await app.inject({
      method: 'POST',
      url: '/auth/individual-signups',
      headers: { cookie: `${cookieName}=${session.token}` },
      payload: { ...attachPayload, taxId: '39053344705' },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: '/auth/individual-signups',
      headers: { cookie: `${cookieName}=${session.token}` },
      payload: { ...attachPayload, taxId: '16899535009' },
    });

    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('MEMBERSHIP_ALREADY_EXISTS');
  });

  it('sem sessão, continua exigindo senha e e-mail', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/individual-signups',
      payload: attachPayload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('VALIDATION_ERROR');
  });

  it('erro de validação nomeia o campo ausente em vez de dizer só "Dados inválidos."', async () => {
    const { country, taxIdType, ...semPais } = attachPayload;
    void country;
    void taxIdType;

    const response = await app.inject({
      method: 'POST',
      url: '/auth/individual-signups',
      payload: { ...semPais, email: 'sem-pais@example.com', password: 'senha-dev-123', confirmPassword: 'senha-dev-123' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain('country');
  });
});
