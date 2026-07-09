import { Prisma } from '@prisma/client';
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';
import {
  AUTH_DATABASE_UNAVAILABLE_CODE,
  AUTH_DATABASE_UNAVAILABLE_MESSAGE,
  maskDatabaseUrl,
  parseDatabaseUrl,
} from '../src/db/databaseHealth.js';
import { createOrGetUser } from '../src/modules/users/users.service.js';
import { TEST_ENV } from './setup.js';

function createDbUnavailableError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    "Can't reach database server at `127.0.0.1:5433`",
    {
      code: 'P1001',
      clientVersion: '6.5.0',
    },
  );
}

describe('database health helpers', () => {
  it('redige DATABASE_URL sem expor senha', () => {
    const masked = maskDatabaseUrl('postgresql://doqyn_auth:super-secret@127.0.0.1:5433/doqyn_auth');
    expect(masked).toContain('doq***');
    expect(masked).toContain('***');
    expect(masked).not.toContain('super-secret');
  });

  it('parseDatabaseUrl expõe host/port/database sem secrets', () => {
    const parsed = parseDatabaseUrl('postgresql://doqyn_auth:secret@127.0.0.1:5433/doqyn_auth');
    expect(parsed.host).toBe('127.0.0.1');
    expect(parsed.port).toBe('5433');
    expect(parsed.database).toBe('doqyn_auth');
    expect(parsed.userRedacted).toBe('doq***');
  });
});

describe('senha persiste entre operações', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('login mantém passwordHash após autenticação bem-sucedida', async () => {
    const email = `persist-${Date.now()}@empresa.com`;
    const user = await createOrGetUser({
      email,
      temporaryPassword: 'senha-persistente-123',
    });

    const before = await prisma.authCredential.findUnique({
      where: { userId: user.id },
    });
    expect(before?.passwordHash).toBeTruthy();

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email,
        password: 'senha-persistente-123',
      },
    });

    expect(login.statusCode).toBe(200);

    const after = await prisma.authCredential.findUnique({
      where: { userId: user.id },
    });

    expect(after?.passwordHash).toBe(before?.passwordHash);
  });
});

describe('rotas com banco indisponível', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('GET /health retorna 503 AUTH_DATABASE_UNAVAILABLE quando DB está off', async () => {
    const spy = vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(createDbUnavailableError());

    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(503);
    const body = response.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe(AUTH_DATABASE_UNAVAILABLE_CODE);
    expect(body.database).toBe('unavailable');
    expect(body.databaseHost).toBe('127.0.0.1');
    expect(body.databasePort).toBe('5433');
    expect(String(body.message)).toContain('banco de autenticação');

    spy.mockRestore();
  });

  it('POST /auth/login retorna AUTH_DATABASE_UNAVAILABLE, não INVALID_CREDENTIALS', async () => {
    const usersModule = await import('../src/modules/users/users.service.js');
    const findSpy = vi
      .spyOn(usersModule, 'findUserByEmailLookup')
      .mockRejectedValueOnce(createDbUnavailableError());

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'login@empresa.com', password: 'qualquer' },
    });

    expect(response.statusCode).toBe(503);
    const body = response.json();
    expect(body.code).toBe(AUTH_DATABASE_UNAVAILABLE_CODE);
    expect(body.message).toBe(AUTH_DATABASE_UNAVAILABLE_MESSAGE);
    expect(body.message).not.toMatch(/senha inválid/i);
    expect(JSON.stringify(body)).not.toContain('PrismaClientInitializationError');

    findSpy.mockRestore();
  });

  it('POST /internal/sessions/verify retorna AUTH_DATABASE_UNAVAILABLE controlado', async () => {
    const sessionsModule = await import('../src/modules/sessions/sessions.service.js');
    const spy = vi
      .spyOn(sessionsModule, 'validateSessionByToken')
      .mockRejectedValueOnce(createDbUnavailableError());

    const response = await app.inject({
      method: 'POST',
      url: '/internal/sessions/verify',
      headers: {
        authorization: `Bearer ${TEST_ENV.DOQYN_INTERNAL_API_KEY}`,
      },
      payload: { sessionToken: 'token-teste' },
    });

    expect(response.statusCode).toBe(503);
    const body = response.json();
    expect(body.code).toBe(AUTH_DATABASE_UNAVAILABLE_CODE);
    expect(JSON.stringify(body)).not.toContain('PrismaClientInitializationError');

    spy.mockRestore();
  });
});

describe('scripts de desenvolvimento', () => {
  it('package.json registra dev:db, ensure-dev-db e audit:auth-health', async () => {
    const pkg = await import('../package.json', { assert: { type: 'json' } });
    expect(pkg.default.scripts['dev:db']).toContain('postgres-auth');
    expect(pkg.default.scripts.dev).toContain('ensure-dev-db');
    expect(pkg.default.scripts['dev:server']).toContain('src/server.ts');
    expect(pkg.default.scripts['audit:auth-health']).toContain('audit-auth-health');
    expect(pkg.default.scripts['dev:local']).toContain('dev-local');
  });

  it('mensagem de startup aponta para npm run dev / dev:db', async () => {
    const { buildStartupDatabaseFailureMessage } = await import('../src/db/databaseHealth.js');
    const message = buildStartupDatabaseFailureMessage(
      'postgresql://doqyn_auth:secret@127.0.0.1:5433/doqyn_auth',
    );
    expect(message).toContain('127.0.0.1:5433');
    expect(message).toContain('npm run dev');
    expect(message).not.toContain('secret');
  });
});
