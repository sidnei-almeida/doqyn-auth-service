#!/usr/bin/env tsx
import { execSync } from 'node:child_process';
import { basename } from 'node:path';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import {
  collectDatabaseHealthSnapshot,
  formatDatabaseEndpoint,
  maskDatabaseUrl,
  parseDatabaseUrl,
} from '../src/db/databaseHealth.js';
import {
  buildEmptyDatabaseWarning,
  collectDatabaseUrlSourceAudit,
  collectDockerStorageAudit,
} from '../src/dev/dockerStorageAudit.js';
import {
  checkTcpPort,
  isDockerAvailable,
  isPostgresContainerRunning,
} from '../src/dev/dockerDev.js';
import { applyDotenvFile } from '../src/dev/loadDotenv.js';

function exec(command: string): string {
  return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function main(): Promise<void> {
  applyDotenvFile('.env');
  applyDotenvFile('.env.local');
  applyDotenvFile('.env.development');

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.error('DATABASE_URL não configurada.');
    process.exit(1);
  }

  const parsed = parseDatabaseUrl(databaseUrl);
  const dockerAvailable = isDockerAvailable(exec);
  const storage = collectDockerStorageAudit({
    exec,
    composeProjectNameEnv: process.env.COMPOSE_PROJECT_NAME,
    workingDirectoryName: basename(process.cwd()),
  });

  const prisma = new PrismaClient();
  try {
    const snapshot = await collectDatabaseHealthSnapshot(prisma, databaseUrl, {
      includeCounts: true,
      nodeEnv: process.env.NODE_ENV,
    });

    const portAccessible = await checkTcpPort(snapshot.host, Number(snapshot.port));
    const containerRunning = dockerAvailable
      ? isPostgresContainerRunning(exec, snapshot.dockerService)
      : false;

    const urlAudit = collectDatabaseUrlSourceAudit({
      databaseUrl,
      testDatabaseUrl: process.env.TEST_DATABASE_URL,
      databaseUrlRedacted: maskDatabaseUrl(databaseUrl),
      host: parsed.host,
      port: parsed.port,
      database: parsed.database,
    });

    const emptyWarning = buildEmptyDatabaseWarning(snapshot.counts);
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };

    const report = {
      generatedAt: new Date().toISOString(),
      service: 'doqyn-auth-service',
      databaseUrlRedacted: maskDatabaseUrl(databaseUrl),
      endpoint: formatDatabaseEndpoint(databaseUrl),
      host: snapshot.host,
      port: snapshot.port,
      database: snapshot.database,
      userRedacted: snapshot.userRedacted,
      envFilesPresent: urlAudit.envFilesPresent,
      testDatabaseUrlConfigured: urlAudit.testDatabaseUrlConfigured,
      usesSharedDevDatabaseRisk: urlAudit.usesSharedDevDatabaseRisk,
      sharedDevDatabaseWarning: urlAudit.sharedDevDatabaseWarning,
      dockerAvailable,
      dockerService: snapshot.dockerService,
      containerRunning,
      portAccessible,
      composeProjectName: storage.composeProjectName,
      composeProjectSource: storage.composeProjectSource,
      composeProjectNameEnv: process.env.COMPOSE_PROJECT_NAME ?? null,
      postgresContainerName: storage.postgresContainer.name,
      postgresVolumeName: storage.activeVolume?.name ?? storage.postgresContainer.volumeName,
      postgresVolumeMountpoint:
        storage.activeVolume?.mountpoint ?? storage.postgresContainer.volumeMountpoint,
      postgresVolumeCreatedAt: storage.activeVolume?.createdAt,
      candidateVolumes: storage.candidateVolumes.map((volume) => ({
        name: volume.name,
        createdAt: volume.createdAt,
      })),
      multipleCandidateVolumes: storage.multipleCandidateVolumes,
      volumeSwapAlert: storage.volumeSwapAlert,
      prismaSelect1: snapshot.canConnect ? 'ok' : 'fail',
      migrationsApplied: snapshot.migrationsApplied,
      migrationHint: snapshot.migrationHint,
      counts: snapshot.counts,
      emptyDatabaseWarning: emptyWarning,
      devHint: snapshot.devHint,
      error: snapshot.error,
      scriptsDoNotAutoReset:
        !pkg.scripts.dev?.includes('db:seed') &&
        !pkg.scripts.dev?.includes('dev:reset:postgres') &&
        !pkg.scripts.dev?.includes('down -v'),
    };

    console.log(JSON.stringify(report, null, 2));

    if (!snapshot.canConnect) {
      process.exit(1);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
