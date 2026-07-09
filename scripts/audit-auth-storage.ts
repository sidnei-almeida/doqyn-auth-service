#!/usr/bin/env tsx
import { execSync } from 'node:child_process';
import { basename } from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  collectDatabaseHealthSnapshot,
  formatDatabaseEndpoint,
  maskDatabaseUrl,
  parseDatabaseUrl,
} from '../src/db/databaseHealth.js';
import {
  assertSafeDevScripts,
  buildEmptyDatabaseWarning,
  collectDatabaseUrlSourceAudit,
  collectDockerStorageAudit,
  listSuggestedVolumeInspectionCommands,
} from '../src/dev/dockerStorageAudit.js';
import { applyDotenvFile, loadDotenvFile } from '../src/dev/loadDotenv.js';
import { readFileSync } from 'node:fs';

function exec(command: string): string {
  return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function main(): Promise<void> {
  const dotenv = loadDotenvFile('.env');
  Object.assign(process.env, dotenv);
  applyDotenvFile('.env');
  applyDotenvFile('.env.local');
  applyDotenvFile('.env.development');

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.error('DATABASE_URL não configurada.');
    process.exit(1);
  }

  const parsed = parseDatabaseUrl(databaseUrl);
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
    const scriptSafety = assertSafeDevScripts(pkg.scripts);

    const report = {
      generatedAt: new Date().toISOString(),
      service: 'doqyn-auth-service',
      databaseUrlRedacted: maskDatabaseUrl(databaseUrl),
      endpoint: formatDatabaseEndpoint(databaseUrl),
      host: parsed.host,
      port: parsed.port,
      database: parsed.database,
      envFilesPresent: urlAudit.envFilesPresent,
      testDatabaseUrlConfigured: urlAudit.testDatabaseUrlConfigured,
      usesSharedDevDatabaseRisk: urlAudit.usesSharedDevDatabaseRisk,
      sharedDevDatabaseWarning: urlAudit.sharedDevDatabaseWarning,
      composeProjectName: storage.composeProjectName,
      composeProjectSource: storage.composeProjectSource,
      composeProjectNameEnv: process.env.COMPOSE_PROJECT_NAME ?? null,
      postgresService: storage.postgresService,
      postgresContainerName: storage.postgresContainer.name,
      postgresContainerStatus: storage.postgresContainer.status,
      postgresVolumeName: storage.activeVolume?.name ?? storage.postgresContainer.volumeName,
      postgresVolumeMountpoint:
        storage.activeVolume?.mountpoint ?? storage.postgresContainer.volumeMountpoint,
      postgresVolumeCreatedAt: storage.activeVolume?.createdAt,
      candidateVolumes: storage.candidateVolumes.map((volume) => ({
        name: volume.name,
        createdAt: volume.createdAt,
        composeProject: volume.composeProject,
        composeVolume: volume.composeVolume,
      })),
      multipleCandidateVolumes: storage.multipleCandidateVolumes,
      volumeSwapAlert: storage.volumeSwapAlert,
      counts: snapshot.counts,
      migrationsApplied: snapshot.migrationsApplied,
      emptyDatabaseWarning: emptyWarning,
      scriptSafety,
      destructiveScriptsExplicitOnly: scriptSafety.destructiveScriptsExplicitOnly,
      suggestedInspectionCommands: listSuggestedVolumeInspectionCommands(
        storage.activeVolume?.name ?? storage.postgresContainer.volumeName,
      ),
      recoveryHints: emptyWarning?.hints ?? [],
    };

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
