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
  LOOKUP_HASH_SECRET: 'test-lookup-secret',
  SESSION_TOKEN_HASH_SECRET: 'test-session-secret',
  PASSWORD_RESET_TOKEN_HASH_SECRET: 'test-reset-secret',
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

beforeAll(async () => {
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
