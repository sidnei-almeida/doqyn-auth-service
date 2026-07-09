#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

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

async function main(): Promise<void> {
  Object.assign(process.env, parseEnvFile('.env'));

  const prisma = new PrismaClient();
  const counts: Array<[string, number]> = [];

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

  for (const [name, fn] of entries) {
    counts.push([name, await fn()]);
  }

  for (const [name, count] of counts) {
    console.log(`${name}: ${count}`);
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
