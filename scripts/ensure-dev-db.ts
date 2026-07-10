#!/usr/bin/env tsx
import { execSync } from 'node:child_process';
import { applyDotenvFile } from '../src/dev/loadDotenv.js';
import { ensureDevDatabase } from '../src/dev/ensureDevDb.js';

function exec(command: string): string {
  return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function execInherit(command: string): void {
  console.log(`> ${command}`);
  execSync(command, { stdio: 'inherit' });
}

async function main(): Promise<void> {
  applyDotenvFile('.env');

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.error('DATABASE_URL não configurada.');
    process.exit(1);
  }

  const result = await ensureDevDatabase(databaseUrl, {
    exec,
    execInherit,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log: (message) => console.log(message),
    warn: (message) => console.warn(message),
  });

  if (!result.ok) {
    console.error(result.message);
    if (result.hints?.length) {
      for (const hint of result.hints) {
        console.error(`  ${hint}`);
      }
    }
    process.exit(1);
  }

  if (result.migrationHint) {
    console.warn(result.migrationHint);
  }

  execInherit('npx prisma migrate deploy');
  execInherit('npx prisma generate');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
