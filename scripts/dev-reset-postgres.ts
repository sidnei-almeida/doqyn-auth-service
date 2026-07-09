#!/usr/bin/env tsx
/**
 * Reset DEV do Postgres (auth-service) via Prisma migrate reset + seed.
 * NÃO toca MongoDB, R2 nem .env.
 *
 * Dry-run (padrão):
 *   npm run dev:reset:postgres
 *
 * Executar reset:
 *   npm run dev:reset:postgres -- --confirm-reset-doqyn-dev
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const CONFIRM_FLAG = '--confirm-reset-doqyn-dev';

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

function maskDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    if (parsed.username) parsed.username = `${parsed.username.slice(0, 3)}***`;
    return parsed.toString();
  } catch {
    return url.replace(/:([^:@/]+)@/, ':***@');
  }
}

function parseDatabaseTarget(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  return {
    host: parsed.hostname,
    port: parsed.port || '5432',
    database: parsed.pathname.replace(/^\//, ''),
    user: parsed.username ? `${parsed.username.slice(0, 3)}***` : '',
  };
}

function assertNotProductionEnv(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Reset bloqueado: NODE_ENV=production.');
  }
}

function assertSafePostgresTarget(databaseUrl: string): void {
  if (/prod|production/i.test(databaseUrl)) {
    throw new Error('Reset bloqueado: DATABASE_URL parece produção.');
  }

  const { host, database } = parseDatabaseTarget(databaseUrl);
  const localHost = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local');

  if (!localHost) {
    throw new Error(`Reset bloqueado: host Postgres "${host}" não é local.`);
  }

  if (/prod|production/i.test(database)) {
    throw new Error(`Reset bloqueado: database "${database}" parece produção.`);
  }

  const allowed =
    SAFE_DATABASE_NAMES.has(database) || /(?:^|_)dev(?:$|_)/i.test(database);

  if (!allowed) {
    throw new Error(
      `Reset bloqueado: database "${database}" fora da allowlist dev (${[...SAFE_DATABASE_NAMES].join(', ')}).`,
    );
  }
}

async function countTables(prisma: PrismaClient): Promise<Array<[string, number]>> {
  const entries: Array<[string, () => Promise<number>]> = [
    ['auth_users', () => prisma.authUser.count()],
    ['auth_credentials', () => prisma.authCredential.count()],
    ['auth_sessions', () => prisma.authSession.count()],
    ['auth_tenants', () => prisma.authTenant.count()],
    ['auth_memberships', () => prisma.authMembership.count()],
    ['auth_membership_roles', () => prisma.authMembershipRole.count()],
    ['auth_access_groups', () => prisma.authAccessGroup.count()],
    ['auth_membership_access_groups', () => prisma.authMembershipAccessGroup.count()],
    ['auth_access_requests', () => prisma.authAccessRequest.count()],
    ['auth_audit_logs', () => prisma.authAuditLog.count()],
    ['auth_login_attempts', () => prisma.authLoginAttempt.count()],
    ['auth_password_resets', () => prisma.authPasswordReset.count()],
    ['auth_email_verifications', () => prisma.authEmailVerification.count()],
    ['auth_notification_preferences', () => prisma.authNotificationPreference.count()],
    ['auth_account_deletion_requests', () => prisma.authAccountDeletionRequest.count()],
  ];

  const rows: Array<[string, number]> = [];
  for (const [name, fn] of entries) {
    rows.push([name, await fn()]);
  }
  return rows;
}

async function main(): Promise<void> {
  const envFile = process.env.ENV_FILE?.trim() || '.env';
  Object.assign(process.env, parseEnvFile(envFile));

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL não configurada.');
  }

  const confirmed = process.argv.includes(CONFIRM_FLAG);
  const target = parseDatabaseTarget(databaseUrl);

  assertNotProductionEnv();
  assertSafePostgresTarget(databaseUrl);

  console.log('================================================================================');
  console.log('DOQYN — PLANO DE RESET Postgres (auth-service)');
  console.log('================================================================================');
  console.log(`Modo: ${confirmed ? 'EXECUÇÃO DESTRUTIVA' : 'DRY-RUN (somente leitura)'}`);
  console.log(`Host: ${target.host}:${target.port}`);
  console.log(`Database: ${target.database}`);
  console.log(`User: ${target.user}`);
  console.log(`DATABASE_URL (mascarada): ${maskDatabaseUrl(databaseUrl)}`);
  console.log(`NODE_ENV: ${process.env.NODE_ENV ?? '(unset)'}`);
  console.log('MongoDB/R2: NÃO serão alterados');
  console.log('');

  const prisma = new PrismaClient();
  const counts = await countTables(prisma);
  const total = counts.reduce((sum, [, count]) => sum + count, 0);

  console.log('Tabelas Prisma (contagem atual):');
  for (const [name, count] of counts) {
    console.log(`  - ${name}: ${count}`);
  }
  console.log(`Total estimado de linhas: ${total}`);
  console.log('');
  console.log('Ação planejada:');
  console.log('  1) npx prisma migrate reset --force --skip-seed');
  console.log('  2) npm run db:seed (seed dev existente)');
  console.log('');

  await prisma.$disconnect();

  if (!confirmed) {
    console.log('DRY-RUN concluído. Nada foi apagado.');
    console.log(`Para executar: npm run dev:reset:postgres -- ${CONFIRM_FLAG}`);
    return;
  }

  console.log('⚠️  EXECUTANDO RESET DESTRUTIVO...');

  execSync('npx prisma migrate reset --force --skip-seed', {
    stdio: 'inherit',
    env: process.env,
  });

  console.log('OK: migrations reaplicadas (schema limpo).');

  execSync('npm run db:seed', {
    stdio: 'inherit',
    env: process.env,
  });

  console.log('OK: seed dev executado.');
  console.log('');
  console.log('Credenciais dev (seed):');
  console.log('  sidnei@doqyn.dev');
  console.log('    roles: doqyn_admin, company_admin, user');
  console.log('    grupos: (nenhum — criar manualmente se necessário)');
  console.log('  teste.juridico@doqyn.dev');
  console.log('    roles: user');
  console.log('    grupos: (nenhum)');
  console.log('  Senha: valor de SEED_DEV_PASSWORD no .env, ou fallback documentado no seed');
  console.log('  Tenant: company_dev');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`FAIL: ${message}`);
  process.exit(1);
});
