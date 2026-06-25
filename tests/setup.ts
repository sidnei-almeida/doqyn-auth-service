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
  SESSION_COOKIE_NAME: 'doqyn_session',
  SESSION_TTL_DAYS: '7',
  COOKIE_DOMAIN: '',
  COOKIE_SECURE: 'false',
  COOKIE_SAME_SITE: 'lax',
  ALLOWED_ORIGINS: 'http://localhost:5173',
  DOQYN_INTERNAL_API_KEY: 'test-internal-api-key',
  DATA_ENCRYPTION_KEY: testEncryptionKey,
  LOOKUP_HASH_SECRET: 'test-lookup-secret',
  SESSION_TOKEN_HASH_SECRET: 'test-session-secret',
  PASSWORD_RESET_TOKEN_HASH_SECRET: 'test-reset-secret',
  PASSWORD_PEPPER: 'test-pepper',
  PASSWORD_RESET_TTL_MINUTES: '30',
  EMAIL_VERIFICATION_TTL_HOURS: '24',
};

beforeAll(() => {
  Object.assign(process.env, TEST_ENV);
  resetEnvCache();
});

beforeEach(async () => {
  resetRateLimitStore();
  await prisma.authAuditLog.deleteMany();
  await prisma.authLoginAttempt.deleteMany();
  await prisma.authEmailVerification.deleteMany();
  await prisma.authPasswordReset.deleteMany();
  await prisma.authSession.deleteMany();
  await prisma.authNotificationPreference.deleteMany();
  await prisma.authMembershipAccessGroup.deleteMany();
  await prisma.authMembershipRole.deleteMany();
  await prisma.authAccessRequest.deleteMany();
  await prisma.authMembership.deleteMany();
  await prisma.authAccessGroup.deleteMany();
  await prisma.authTenant.deleteMany();
  await prisma.authCredential.deleteMany();
  await prisma.authAccountDeletionRequest.deleteMany();
  await prisma.authUser.deleteMany();
});

afterAll(async () => {
  await disconnectPrisma();
});
