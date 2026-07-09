import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { URL } from 'node:url';

const SAFE_DATABASE_NAMES = new Set(['doqyn_auth', 'doqyn_auth_dev', 'doqyn_auth_test']);

function parseEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {};
  const vars: Record<string, string> = {};
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    vars[trimmed.slice(0, eq).trim()] = value;
  }
  return vars;
}

function resolveDatabaseUrl(): string {
  if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
  const envFile = parseEnvFile(join(process.cwd(), '.env'));
  if (envFile.DATABASE_URL?.trim()) return envFile.DATABASE_URL.trim();
  throw new Error('Demo seed bloqueado: DATABASE_URL não configurada.');
}

function parseDatabaseTarget(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  return {
    host: parsed.hostname,
    database: parsed.pathname.replace(/^\//, ''),
  };
}

export function assertDemoSeedSafe(): { databaseUrl: string; databaseName: string } {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Demo seed bloqueado: NODE_ENV=production.');
  }

  const databaseUrl = resolveDatabaseUrl();

  if (/prod|production/i.test(databaseUrl)) {
    throw new Error('Demo seed bloqueado: DATABASE_URL parece produção.');
  }

  const { host, database } = parseDatabaseTarget(databaseUrl);
  const localHost = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local');

  if (!localHost) {
    throw new Error(`Demo seed bloqueado: host Postgres "${host}" não é local.`);
  }

  if (/prod|production/i.test(database)) {
    throw new Error(`Demo seed bloqueado: database "${database}" parece produção.`);
  }

  const allowed =
    SAFE_DATABASE_NAMES.has(database) || /(?:^|_)dev(?:$|_)/i.test(database);

  if (!allowed) {
    throw new Error(
      `Demo seed bloqueado: database "${database}" não está na allowlist dev. ` +
        `Allowlist: ${[...SAFE_DATABASE_NAMES].join(', ')}`,
    );
  }

  return { databaseUrl, databaseName: database };
}
