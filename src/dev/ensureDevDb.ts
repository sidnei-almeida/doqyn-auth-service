import { PrismaClient } from '@prisma/client';
import {
  DEV_DB_DOCKER_SERVICE,
  checkDatabaseConnection,
  formatDatabaseEndpoint,
  maskDatabaseUrl,
  parseDatabaseUrl,
} from '../db/databaseHealth.js';
import {
  DOCKER_START_HINT,
  checkTcpPort,
  isDockerAvailable,
  isLocalDatabaseHost,
  isPostgresContainerRunning,
  startPostgresContainer,
} from './dockerDev.js';

export type EnsureDevDbResult =
  | {
      ok: true;
      endpoint: string;
      databaseUrlRedacted: string;
      dockerAvailable: boolean;
      containerRunning: boolean;
      portAccessible: boolean;
      migrationHint?: string;
    }
  | {
      ok: false;
      code: string;
      message: string;
      hints?: string[];
      databaseUrlRedacted?: string;
    };

export type EnsureDevDbDeps = {
  exec: (command: string) => string;
  execInherit: (command: string) => void;
  sleep: (ms: number) => Promise<void>;
  log: (message: string) => void;
  warn: (message: string) => void;
  checkPrisma?: (databaseUrl: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  checkPort?: (host: string, port: number) => Promise<boolean>;
  dockerService?: string;
  maxAttempts?: number;
  skipDockerBootstrap?: boolean;
};

async function defaultCheckPrisma(
  databaseUrl: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    return await checkDatabaseConnection(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

async function detectMigrationHint(databaseUrl: string): Promise<string | undefined> {
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('auth_users', '_prisma_migrations')
    `;
    const tableNames = new Set(tables.map((row) => row.table_name));
    if (!tableNames.has('_prisma_migrations') || !tableNames.has('auth_users')) {
      return 'Migrations pendentes. Rode: npx prisma migrate deploy';
    }
    return undefined;
  } catch {
    return undefined;
  } finally {
    await prisma.$disconnect();
  }
}

export async function ensureDevDatabase(
  databaseUrl: string,
  deps: EnsureDevDbDeps,
): Promise<EnsureDevDbResult> {
  const trimmedUrl = databaseUrl.trim();
  if (!trimmedUrl) {
    return {
      ok: false,
      code: 'DATABASE_URL_MISSING',
      message: 'DATABASE_URL não configurada.',
    };
  }

  const parsed = parseDatabaseUrl(trimmedUrl);
  const databaseUrlRedacted = maskDatabaseUrl(trimmedUrl);
  const endpoint = formatDatabaseEndpoint(trimmedUrl);
  const dockerService = deps.dockerService ?? DEV_DB_DOCKER_SERVICE;
  const maxAttempts = deps.maxAttempts ?? 30;
  const checkPrisma = deps.checkPrisma ?? defaultCheckPrisma;
  const checkPort = deps.checkPort ?? checkTcpPort;

  deps.log(`DATABASE_URL (redacted): ${databaseUrlRedacted}`);
  deps.log(`Aguardando Postgres em ${endpoint}...`);

  let dockerAvailable = false;
  let containerRunning = false;

  if (isLocalDatabaseHost(parsed.host) && !deps.skipDockerBootstrap) {
    dockerAvailable = isDockerAvailable(deps.exec);
    if (!dockerAvailable) {
      return {
        ok: false,
        code: 'DOCKER_UNAVAILABLE',
        message: `Docker não está rodando. Inicie com: ${DOCKER_START_HINT}`,
        databaseUrlRedacted,
      };
    }

    containerRunning = isPostgresContainerRunning(deps.exec, dockerService);
    if (!containerRunning) {
      deps.log(`Subindo serviço Docker ${dockerService}...`);
      startPostgresContainer(deps.execInherit, dockerService);
    }
  }

  let portAccessible = false;
  const portNumber = Number(parsed.port);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    portAccessible = await checkPort(parsed.host, portNumber);
    if (portAccessible) {
      const prismaCheck = await checkPrisma(trimmedUrl);
      if (prismaCheck.ok) {
        const migrationHint = await detectMigrationHint(trimmedUrl);
        if (migrationHint) {
          deps.warn(migrationHint);
        }

        deps.log(`Postgres pronto em ${endpoint}`);
        return {
          ok: true,
          endpoint,
          databaseUrlRedacted,
          dockerAvailable,
          containerRunning: containerRunning || isPostgresContainerRunning(deps.exec, dockerService),
          portAccessible: true,
          migrationHint,
        };
      }
    }

    if (attempt < maxAttempts) {
      deps.log(`Aguardando Postgres (${attempt}/${maxAttempts}) em ${endpoint}...`);
      await deps.sleep(1000);
    }
  }

  return {
    ok: false,
    code: 'POSTGRES_UNAVAILABLE',
    message: `Postgres do auth não respondeu em ${endpoint}`,
    hints: ['docker compose ps', `docker compose logs ${dockerService}`],
    databaseUrlRedacted,
  };
}
