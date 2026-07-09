import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { URL } from 'node:url';
import { AppError } from '../utils/errors.js';

export const AUTH_DATABASE_UNAVAILABLE_CODE = 'AUTH_DATABASE_UNAVAILABLE';
export const AUTH_DATABASE_UNAVAILABLE_MESSAGE =
  'O banco de autenticação não está disponível. Inicie o Postgres do auth-service.';
export const DEV_DB_DOCKER_SERVICE = 'postgres-auth';
export const DEV_DB_START_COMMAND = 'npm run dev:db';

const CONNECTION_ERROR_CODES = new Set(['P1001', 'P1002', 'P1003', 'P1008', 'P1017', 'P2024']);

export type ParsedDatabaseUrl = {
  host: string;
  port: string;
  database: string;
  userRedacted: string;
};

export type DatabaseHealthSnapshot = {
  databaseUrlRedacted: string;
  host: string;
  port: string;
  database: string;
  userRedacted: string;
  dockerService: string;
  canConnect: boolean;
  migrationsApplied: boolean | null;
  migrationHint?: string;
  counts?: {
    users: number;
    tenants: number;
    memberships: number;
    sessions: number;
  };
  error?: string;
  devHint?: string;
};

export function maskDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    if (parsed.username) {
      parsed.username =
        parsed.username.length <= 3 ? '***' : `${parsed.username.slice(0, 3)}***`;
    }
    return parsed.toString();
  } catch {
    return url.replace(/:([^:@/]+)@/, ':***@');
  }
}

export function parseDatabaseUrl(databaseUrl: string): ParsedDatabaseUrl {
  const parsed = new URL(databaseUrl);
  const username = parsed.username || '';
  return {
    host: parsed.hostname,
    port: parsed.port || '5432',
    database: parsed.pathname.replace(/^\//, ''),
    userRedacted: username ? `${username.slice(0, 3)}***` : '',
  };
}

export function formatDatabaseEndpoint(databaseUrl: string): string {
  const { host, port } = parseDatabaseUrl(databaseUrl);
  return `${host}:${port}`;
}

export function isPrismaConnectionError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return true;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return CONNECTION_ERROR_CODES.has(error.code);
  }

  if (error instanceof Prisma.PrismaClientRustPanicError) {
    return true;
  }

  if (error && typeof error === 'object') {
    const name = 'name' in error ? String((error as Error).name) : '';
    if (
      name === 'PrismaClientInitializationError' ||
      name === 'PrismaClientRustPanicError' ||
      name === 'PrismaClientKnownRequestError'
    ) {
      if (name === 'PrismaClientKnownRequestError' && 'code' in error) {
        return CONNECTION_ERROR_CODES.has(String((error as { code: string }).code));
      }
      return true;
    }
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("can't reach database server") ||
      message.includes('connection refused') ||
      message.includes('econnrefused') ||
      message.includes('etimedout') ||
      message.includes('database server is not available')
    );
  }

  return false;
}

export class DatabaseUnavailableError extends AppError {
  constructor(message = AUTH_DATABASE_UNAVAILABLE_MESSAGE) {
    super(message, 503, AUTH_DATABASE_UNAVAILABLE_CODE);
    this.name = 'DatabaseUnavailableError';
  }
}

export function toDatabaseUnavailableError(error?: unknown): DatabaseUnavailableError {
  if (error instanceof DatabaseUnavailableError) {
    return error;
  }

  if (error instanceof Error && isPrismaConnectionError(error)) {
    return new DatabaseUnavailableError();
  }

  return new DatabaseUnavailableError();
}

export async function checkDatabaseConnection(
  client: Pick<PrismaClient, '$queryRaw'>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await client.$queryRaw`SELECT 1`;
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function detectMigrationsApplied(
  client: Pick<PrismaClient, '$queryRaw'>,
): Promise<{ applied: boolean; hint?: string }> {
  try {
    const tables = await client.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('auth_users', '_prisma_migrations')
    `;

    const tableNames = new Set(tables.map((row) => row.table_name));
    if (!tableNames.has('_prisma_migrations')) {
      return {
        applied: false,
        hint: 'Tabela _prisma_migrations ausente. Rode: npx prisma migrate deploy',
      };
    }

    if (!tableNames.has('auth_users')) {
      return {
        applied: false,
        hint: 'Schema auth ausente. Rode: npx prisma migrate deploy',
      };
    }

    return { applied: true };
  } catch {
    return {
      applied: false,
      hint: 'Não foi possível verificar migrations.',
    };
  }
}

export async function collectDatabaseHealthSnapshot(
  client: PrismaClient,
  databaseUrl: string,
  options?: { includeCounts?: boolean; nodeEnv?: string },
): Promise<DatabaseHealthSnapshot> {
  const parsed = parseDatabaseUrl(databaseUrl);
  const connection = await checkDatabaseConnection(client);

  const snapshot: DatabaseHealthSnapshot = {
    databaseUrlRedacted: maskDatabaseUrl(databaseUrl),
    host: parsed.host,
    port: parsed.port,
    database: parsed.database,
    userRedacted: parsed.userRedacted,
    dockerService: DEV_DB_DOCKER_SERVICE,
    canConnect: connection.ok,
    migrationsApplied: null,
  };

  if (!connection.ok) {
    snapshot.error = 'Database unreachable';
    if (options?.nodeEnv === 'development') {
      snapshot.devHint = `Run: ${DEV_DB_START_COMMAND}`;
    }
    return snapshot;
  }

  const migrations = await detectMigrationsApplied(client);
  snapshot.migrationsApplied = migrations.applied;
  snapshot.migrationHint = migrations.hint;

  if (options?.includeCounts && migrations.applied) {
    const [users, tenants, memberships, sessions] = await Promise.all([
      client.authUser.count(),
      client.authTenant.count(),
      client.authMembership.count(),
      client.authSession.count(),
    ]);

    snapshot.counts = { users, tenants, memberships, sessions };
  }

  return snapshot;
}

export function buildStartupDatabaseFailureMessage(databaseUrl: string): string {
  const endpoint = formatDatabaseEndpoint(databaseUrl);
  return `Auth DB unavailable at ${endpoint}. Run npm run dev (sobe Postgres automaticamente) ou npm run dev:db.`;
}
