import { beforeAll, afterAll, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { resetEnvCache } from '../src/config/env.js';
import { prisma, disconnectPrisma } from '../src/db/prisma.js';
import { resetRateLimitStore } from '../src/security/rateLimit.js';

const testEncryptionKey = randomBytes(32).toString('base64');

export const TEST_ENV = {
  NODE_ENV: 'test',
  PORT: '4100',
  DATABASE_URL:
    process.env.TEST_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgresql://doqyn_auth:doqyn_auth_password@localhost:5433/doqyn_auth',
  DATABASE_URL_DIRECT:
    process.env.TEST_DATABASE_URL_DIRECT ||
    process.env.DATABASE_URL_DIRECT ||
    process.env.TEST_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgresql://doqyn_auth:doqyn_auth_password@localhost:5433/doqyn_auth',
  REDIS_ENABLED: 'false',
  RATE_LIMIT_REDIS_ENABLED: 'false',
  SESSION_COOKIE_NAME: 'doqyn_session',
  SESSION_TTL_DAYS: '7',
  COOKIE_DOMAIN: '',
  COOKIE_SECURE: 'false',
  COOKIE_SAME_SITE: 'lax',
  ALLOWED_ORIGINS: 'http://localhost:5173',
  DOQYN_INTERNAL_API_KEY: 'test-internal-api-key',
  DOQYN_APP_BASE_URL: 'http://127.0.0.1:3001',
  DOQYN_APP_INTERNAL_API_KEY: 'test-app-internal-api-key',
  DATA_ENCRYPTION_KEY: testEncryptionKey,
  LOOKUP_HASH_SECRET: 'test-lookup-secret-com-32-chars-ou-mais',
  SESSION_TOKEN_HASH_SECRET: 'test-session-secret-com-32-chars-ou-mais',
  PASSWORD_RESET_TOKEN_HASH_SECRET: 'test-reset-secret-com-32-chars-ou-mais',
  PASSWORD_PEPPER: 'test-pepper',
  PASSWORD_RESET_TTL_MINUTES: '30',
  EMAIL_VERIFICATION_TTL_HOURS: '24',
  OAUTH_GOOGLE_ENABLED: 'true',
  OAUTH_GOOGLE_CLIENT_ID: 'test-google-client',
  OAUTH_GOOGLE_CLIENT_SECRET: 'test-google-secret',
  OAUTH_GOOGLE_REDIRECT_URI: 'http://127.0.0.1:4100/oauth/google/callback',
  OAUTH_MICROSOFT_ENABLED: 'true',
  OAUTH_MICROSOFT_CLIENT_ID: 'test-microsoft-client',
  OAUTH_MICROSOFT_CLIENT_SECRET: 'test-microsoft-secret',
  OAUTH_MICROSOFT_TENANT: 'common',
  OAUTH_MICROSOFT_REDIRECT_URI: 'http://127.0.0.1:4100/oauth/microsoft/callback',
  OAUTH_POST_LOGIN_REDIRECT_URL: 'http://localhost:5173/auth/oauth/callback',
  OAUTH_ERROR_REDIRECT_URL: 'http://localhost:5173/login',
};

/**
 * Recusa rodar contra um banco que não seja de teste.
 *
 * O `beforeEach` abaixo apaga todas as tabelas, e descobrir o destino pela env não funciona: o
 * Prisma Client carrega o `.env` por conta própria e resolve `DATABASE_URL` no momento em que é
 * instanciado — na importação deste módulo, portanto antes do `Object.assign(process.env, TEST_ENV)`
 * abaixo. O resultado era `TEST_ENV` anunciar `doqyn_auth_test` enquanto a conexão real apontava
 * para o banco de desenvolvimento, e `npx vitest run` zerava o ambiente inteiro sem aviso.
 *
 * Por isso a pergunta é feita à conexão, não à configuração: `current_database()` é a única fonte
 * que não mente sobre onde os `deleteMany` vão cair.
 */
async function assertTestDatabase(): Promise<void> {
  const [row] = await prisma.$queryRawUnsafe<Array<{ current_database: string }>>(
    'SELECT current_database()',
  );
  const databaseName = row?.current_database ?? '(desconhecido)';

  if (/test/i.test(databaseName)) return;

  throw new Error(
    [
      `Recusando rodar os testes contra o banco "${databaseName}": a suíte apaga todas as tabelas.`,
      'O Prisma usa DATABASE_URL do .env, não TEST_DATABASE_URL — apontar só a segunda não protege.',
      'Crie um banco descartável com "test" no nome e rode com DATABASE_URL apontada para ele:',
      '  DATABASE_URL=postgresql://.../doqyn_auth_test npx prisma migrate deploy',
      '  DATABASE_URL=postgresql://.../doqyn_auth_test npx vitest run',
    ].join('\n'),
  );
}

beforeAll(async () => {
  await assertTestDatabase();
  Object.assign(process.env, TEST_ENV);
  resetEnvCache();
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "auth_memberships" ADD COLUMN IF NOT EXISTS "rejected_reason_encrypted" TEXT',
  );
  await prisma.$executeRawUnsafe(
    'ALTER TYPE "TermsAcceptanceFlow" ADD VALUE IF NOT EXISTS \'invite_accept\'',
  );
});

beforeEach(async () => {
  resetRateLimitStore();
  await prisma.authAuditLog.deleteMany();
  await prisma.authLoginAttempt.deleteMany();
  await prisma.authEmailVerification.deleteMany();
  await prisma.authEmailChange.deleteMany();
  await prisma.authPasswordReset.deleteMany();
  await prisma.authSession.deleteMany();
  await prisma.authNotificationPreference.deleteMany();
  await prisma.authMembershipAccessGroup.deleteMany();
  await prisma.authMembershipRole.deleteMany();
  await prisma.authAccessRequest.deleteMany();
  await prisma.authTermsAcceptance.deleteMany();
  await prisma.authInviteRole.deleteMany();
  await prisma.authInvite.deleteMany();
  await prisma.authTenantOutboundEmail.deleteMany();
  await prisma.authMembership.deleteMany();
  await prisma.authAccessGroup.deleteMany();
  await prisma.authTenant.deleteMany();
  await prisma.authCredential.deleteMany();
  await prisma.authOAuthAccount.deleteMany();
  await prisma.authAccountDeletionRequest.deleteMany();
  await prisma.authUser.deleteMany();
});

afterAll(async () => {
  await disconnectPrisma();
});
