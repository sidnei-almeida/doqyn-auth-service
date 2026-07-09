import { existsSync } from 'node:fs';
import { DEV_DB_DOCKER_SERVICE } from '../db/databaseHealth.js';

export type DockerVolumeInfo = {
  name: string;
  createdAt?: string;
  mountpoint?: string;
  composeProject?: string;
  composeVolume?: string;
};

export type PostgresContainerInfo = {
  name?: string;
  id?: string;
  service?: string;
  status?: string;
  createdAt?: string;
  startedAt?: string;
  volumeName?: string;
  volumeMountpoint?: string;
};

export type DockerStorageAudit = {
  composeProjectName: string;
  composeProjectSource: 'env' | 'directory' | 'unknown';
  postgresService: string;
  postgresContainer: PostgresContainerInfo;
  activeVolume: DockerVolumeInfo | null;
  candidateVolumes: DockerVolumeInfo[];
  multipleCandidateVolumes: boolean;
  volumeSwapAlert?: string;
  dockerAvailable: boolean;
};

const CANDIDATE_VOLUME_PATTERNS = [
  /postgres_auth_data/i,
  /doqyn.*auth/i,
  /auth.*postgres/i,
];

export function detectComposeProjectName(options: {
  composeProjectNameEnv?: string;
  workingDirectoryName?: string;
}): { name: string; source: 'env' | 'directory' | 'unknown' } {
  const fromEnv = options.composeProjectNameEnv?.trim();
  if (fromEnv) {
    return { name: fromEnv, source: 'env' };
  }

  const fromDir = options.workingDirectoryName?.trim();
  if (fromDir) {
    return { name: fromDir, source: 'directory' };
  }

  return { name: 'unknown', source: 'unknown' };
}

export function isCandidateAuthPostgresVolume(volumeName: string): boolean {
  return CANDIDATE_VOLUME_PATTERNS.some((pattern) => pattern.test(volumeName));
}

export function buildVolumeSwapAlert(input: {
  activeVolumeName?: string;
  candidateVolumes: DockerVolumeInfo[];
}): string | undefined {
  const others = input.candidateVolumes.filter(
    (volume) => volume.name && volume.name !== input.activeVolumeName,
  );

  if (others.length === 0) {
    return undefined;
  }

  const otherNames = others.map((volume) => volume.name).join(', ');
  return `Foram encontrados múltiplos volumes Postgres relacionados ao auth. O compose atual usa ${input.activeVolumeName ?? '(desconhecido)'}. Dados antigos podem estar em ${otherNames}.`;
}

export function listSuggestedVolumeInspectionCommands(volumeName?: string): string[] {
  const commands = ['docker volume ls', 'docker compose ps postgres-auth'];
  if (volumeName) {
    commands.push(`docker volume inspect ${volumeName}`);
  }
  commands.push('docker inspect $(docker compose ps -q postgres-auth)');
  return commands;
}

export type DockerExec = (command: string) => string;

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function collectDockerStorageAudit(deps: {
  exec: DockerExec;
  composeProjectNameEnv?: string;
  workingDirectoryName?: string;
  postgresService?: string;
}): DockerStorageAudit {
  const postgresService = deps.postgresService ?? DEV_DB_DOCKER_SERVICE;
  const project = detectComposeProjectName({
    composeProjectNameEnv: deps.composeProjectNameEnv,
    workingDirectoryName: deps.workingDirectoryName,
  });

  let dockerAvailable = true;
  let candidateVolumes: DockerVolumeInfo[] = [];
  let activeVolume: DockerVolumeInfo | null = null;
  let postgresContainer: PostgresContainerInfo = { service: postgresService };

  try {
    const volumeLines = deps.exec('docker volume ls --format "{{.Name}}"');
    candidateVolumes = volumeLines
      .split('\n')
      .map((line) => line.trim())
      .filter((name) => name && isCandidateAuthPostgresVolume(name))
      .map((name) => {
        const inspected = safeJsonParse<
          Array<{
            Name: string;
            CreatedAt?: string;
            Mountpoint?: string;
            Labels?: Record<string, string>;
          }>
        >(deps.exec(`docker volume inspect ${name}`));

        const entry = inspected?.[0];
        return {
          name,
          createdAt: entry?.CreatedAt,
          mountpoint: entry?.Mountpoint,
          composeProject: entry?.Labels?.['com.docker.compose.project'],
          composeVolume: entry?.Labels?.['com.docker.compose.volume'],
        } satisfies DockerVolumeInfo;
      });
  } catch {
    dockerAvailable = false;
  }

  try {
    const containerId = deps.exec(`docker compose ps -q ${postgresService}`).trim();
    if (containerId) {
      const inspected = safeJsonParse<
        Array<{
          Name: string;
          Id: string;
          Created: string;
          State?: { Status?: string; StartedAt?: string };
          Mounts?: Array<{
            Type?: string;
            Name?: string;
            Source?: string;
            Destination?: string;
          }>;
        }>
      >(deps.exec(`docker inspect ${containerId}`));

      const container = inspected?.[0];
      const volumeMount = container?.Mounts?.find(
        (mount) => mount.Type === 'volume' && mount.Destination === '/var/lib/postgresql/data',
      );

      postgresContainer = {
        name: container?.Name?.replace(/^\//, ''),
        id: container?.Id,
        service: postgresService,
        status: container?.State?.Status,
        createdAt: container?.Created,
        startedAt: container?.State?.StartedAt,
        volumeName: volumeMount?.Name,
        volumeMountpoint: volumeMount?.Source,
      };

      if (volumeMount?.Name) {
        activeVolume =
          candidateVolumes.find((volume) => volume.name === volumeMount.Name) ??
          ({
            name: volumeMount.Name,
            mountpoint: volumeMount.Source,
          } satisfies DockerVolumeInfo);
      }
    }
  } catch {
    dockerAvailable = false;
  }

  const multipleCandidateVolumes = candidateVolumes.length > 1;
  const volumeSwapAlert = buildVolumeSwapAlert({
    activeVolumeName: activeVolume?.name,
    candidateVolumes,
  });

  return {
    composeProjectName: project.name,
    composeProjectSource: project.source,
    postgresService,
    postgresContainer,
    activeVolume,
    candidateVolumes,
    multipleCandidateVolumes,
    volumeSwapAlert,
    dockerAvailable,
  };
}

export type DatabaseUrlSourceAudit = {
  databaseUrlConfigured: boolean;
  databaseUrlRedacted?: string;
  host?: string;
  port?: string;
  database?: string;
  envFilesPresent: string[];
  envFilesAbsent: string[];
  testDatabaseUrlConfigured: boolean;
  usesSharedDevDatabaseRisk: boolean;
  sharedDevDatabaseWarning?: string;
};

export function collectDatabaseUrlSourceAudit(input: {
  databaseUrl?: string;
  testDatabaseUrl?: string;
  databaseUrlRedacted?: string;
  host?: string;
  port?: string;
  database?: string;
  repoRoot?: string;
}): DatabaseUrlSourceAudit {
  const repoRoot = input.repoRoot ?? process.cwd();
  const envCandidates = ['.env', '.env.local', '.env.development', '.env.development.local'];
  const envFilesPresent = envCandidates.filter((file) => existsSync(`${repoRoot}/${file}`));
  const envFilesAbsent = envCandidates.filter((file) => !existsSync(`${repoRoot}/${file}`));

  const databaseUrl = input.databaseUrl?.trim();
  const testDatabaseUrl = input.testDatabaseUrl?.trim();
  const usesSharedDevDatabaseRisk = Boolean(
    databaseUrl && (!testDatabaseUrl || testDatabaseUrl === databaseUrl),
  );

  return {
    databaseUrlConfigured: Boolean(databaseUrl),
    databaseUrlRedacted: input.databaseUrlRedacted,
    host: input.host,
    port: input.port,
    database: input.database,
    envFilesPresent,
    envFilesAbsent,
    testDatabaseUrlConfigured: Boolean(testDatabaseUrl),
    usesSharedDevDatabaseRisk,
    sharedDevDatabaseWarning: usesSharedDevDatabaseRisk
      ? 'TEST_DATABASE_URL não está separado do DATABASE_URL de dev. npm test apaga users/tenants/memberships no beforeEach — isso pode esvaziar o banco de desenvolvimento.'
      : undefined,
  };
}

export type EmptyDatabaseWarning = {
  code: 'AUTH_DATABASE_EMPTY';
  message: string;
  hints: string[];
};

export function buildEmptyDatabaseWarning(counts?: {
  users?: number;
  tenants?: number;
  memberships?: number;
  sessions?: number;
}): EmptyDatabaseWarning | undefined {
  if (!counts) return undefined;

  const isEmpty =
    (counts.users ?? 0) === 0 &&
    (counts.tenants ?? 0) === 0 &&
    (counts.memberships ?? 0) === 0 &&
    (counts.sessions ?? 0) === 0;

  if (!isEmpty) return undefined;

  return {
    code: 'AUTH_DATABASE_EMPTY',
    message:
      'Auth database is empty. This may indicate a new Docker volume, a reset, or seed not yet run.',
    hints: [
      'Verifique volumes candidatos com: npm run audit:auth-storage',
      'Confirme se npm test rodou contra o mesmo DATABASE_URL de dev',
      'Para dados demo: npm run dev:seed:demo',
      'Relatório de contas: cat .generated/doqyn-demo-accounts.md',
      'Não use docker compose down -v nem dev:reset:postgres sem confirmação explícita',
    ],
  };
}

export const DESTRUCTIVE_SCRIPT_MARKERS = [
  'dev:reset:postgres',
  'docker compose down -v',
  'prisma migrate reset',
  'deleteMany',
] as const;

export function auditScriptsForDestructiveMarkers(scripts: Record<string, string>): Array<{
  script: string;
  marker: string;
}> {
  const findings: Array<{ script: string; marker: string }> = [];
  for (const [scriptName, command] of Object.entries(scripts)) {
    for (const marker of DESTRUCTIVE_SCRIPT_MARKERS) {
      if (command.includes(marker)) {
        findings.push({ script: scriptName, marker });
      }
    }
  }
  return findings;
}

export function assertSafeDevScripts(scripts: Record<string, string>): {
  devUsesEnsureOnly: boolean;
  ensureDevDbSafe: boolean;
  auditHealthSafe: boolean;
  devDoesNotSeedOrReset: boolean;
  destructiveScriptsExplicitOnly: string[];
} {
  const dev = scripts.dev ?? '';
  const ensure = scripts['ensure-dev-db'] ?? 'tsx scripts/ensure-dev-db.ts';
  const audit = scripts['audit:auth-health'] ?? '';
  const auditStorage = scripts['audit:auth-storage'] ?? 'tsx scripts/audit-auth-storage.ts';

  const _destructiveMarkers = auditScriptsForDestructiveMarkers({
    dev,
    ensure,
    audit,
    auditStorage,
    'dev:local': scripts['dev:local'] ?? '',
  });

  return {
    devUsesEnsureOnly: dev.includes('ensure-dev-db') && dev.includes('src/server.ts'),
    ensureDevDbSafe: !ensure.includes('reset') && !ensure.includes('seed') && !ensure.includes('down -v'),
    auditHealthSafe: !audit.includes('reset') && !audit.includes('seed') && !audit.includes('down -v'),
    devDoesNotSeedOrReset:
      !dev.includes('db:seed') &&
      !dev.includes('dev:reset:postgres') &&
      !dev.includes('down -v') &&
      !dev.includes('migrate reset'),
    destructiveScriptsExplicitOnly: Object.entries(scripts)
      .filter(([name, cmd]) =>
        ['dev:reset:postgres', 'docker:down'].includes(name) ||
        cmd.includes('migrate reset') ||
        cmd.includes('down -v'),
      )
      .map(([name]) => name),
  };
}
