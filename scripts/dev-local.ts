#!/usr/bin/env tsx
import { execSync, spawn } from 'node:child_process';
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

  const ensured = await ensureDevDatabase(databaseUrl, {
    exec,
    execInherit,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log: (message) => console.log(message),
    warn: (message) => console.warn(message),
  });

  if (!ensured.ok) {
    console.error(ensured.message);
    process.exit(1);
  }

  execInherit('npx prisma migrate deploy');

  console.log('Iniciando auth-service (npm run dev:server)...');
  const child = spawn('npm', ['run', 'dev:server'], { stdio: 'inherit', shell: true });
  child.on('exit', (code) => process.exit(code ?? 0));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
