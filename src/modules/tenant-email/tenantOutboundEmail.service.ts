import { prisma } from '../../db/prisma.js';
import { decryptField, encryptField } from '../../security/crypto.js';
import { normalizeEmail } from '../../utils/normalize.js';
import { ValidationError } from '../../utils/errors.js';
import type { AdminActor } from '../admin/admin.types.js';
import { resolveTenantScope } from '../admin/adminAuthorization.js';
import type { SmtpTransportConfig } from '../email/email.types.js';
import type {
  TestTenantOutboundEmailInput,
  UpsertTenantOutboundEmailInput,
} from './tenantOutboundEmail.schemas.js';

export type TenantOutboundEmailView = {
  configured: boolean;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUser?: string;
  fromDomain?: string;
  enabled?: boolean;
  lastVerifiedAt?: string | null;
  hasPassword: boolean;
};

function extractEmailDomain(email: string): string {
  const normalized = normalizeEmail(email);
  const domain = normalized.split('@')[1];
  if (!domain) {
    throw new ValidationError('E-mail SMTP inválido.', 'INVALID_SMTP_USER');
  }
  return domain.toLowerCase();
}

export function assertInviterEmailMatchesTenantDomain(
  inviterEmail: string,
  fromDomain: string,
): void {
  const inviterDomain = extractEmailDomain(inviterEmail);
  if (inviterDomain !== fromDomain.toLowerCase()) {
    throw new ValidationError(
      'O convite só pode ser enviado com o e-mail profissional da empresa configurada no SMTP.',
      'INVITER_EMAIL_DOMAIN_MISMATCH',
    );
  }
}

export async function getTenantOutboundEmailView(actor: AdminActor): Promise<TenantOutboundEmailView> {
  const tenantTextId = resolveTenantScope(actor);
  const tenant = await prisma.authTenant.findUnique({
    where: { tenantId: tenantTextId },
    include: { outboundEmail: true },
  });

  if (!tenant?.outboundEmail) {
    return { configured: false, hasPassword: false };
  }

  const config = tenant.outboundEmail;
  return {
    configured: true,
    smtpHost: config.smtpHost,
    smtpPort: config.smtpPort,
    smtpSecure: config.smtpSecure,
    smtpUser: decryptField(config.smtpUserEncrypted),
    fromDomain: config.fromDomain,
    enabled: config.enabled,
    lastVerifiedAt: config.lastVerifiedAt?.toISOString() ?? null,
    hasPassword: Boolean(config.smtpPasswordEncrypted),
  };
}

export async function upsertTenantOutboundEmail(
  actor: AdminActor,
  input: UpsertTenantOutboundEmailInput,
): Promise<TenantOutboundEmailView> {
  const tenantTextId = resolveTenantScope(actor);
  const tenant = await prisma.authTenant.findUnique({ where: { tenantId: tenantTextId } });
  if (!tenant) {
    throw new ValidationError('Empresa não encontrada.', 'TENANT_NOT_FOUND');
  }

  const smtpUser = normalizeEmail(input.smtpUser);
  const fromDomain = extractEmailDomain(smtpUser);

  await prisma.authTenantOutboundEmail.upsert({
    where: { tenantId: tenant.id },
    create: {
      tenantId: tenant.id,
      smtpHost: input.smtpHost.trim(),
      smtpPort: input.smtpPort,
      smtpSecure: input.smtpSecure,
      smtpUserEncrypted: encryptField(smtpUser),
      smtpPasswordEncrypted: encryptField(input.smtpPassword),
      fromDomain,
      enabled: input.enabled,
    },
    update: {
      smtpHost: input.smtpHost.trim(),
      smtpPort: input.smtpPort,
      smtpSecure: input.smtpSecure,
      smtpUserEncrypted: encryptField(smtpUser),
      smtpPasswordEncrypted: encryptField(input.smtpPassword),
      fromDomain,
      enabled: input.enabled,
    },
  });

  return getTenantOutboundEmailView(actor);
}

export async function resolveTenantSmtpTransport(
  tenantUuid: string,
): Promise<SmtpTransportConfig | null> {
  const config = await prisma.authTenantOutboundEmail.findUnique({
    where: { tenantId: tenantUuid },
  });

  if (!config || !config.enabled) {
    return null;
  }

  return {
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    user: decryptField(config.smtpUserEncrypted),
    password: decryptField(config.smtpPasswordEncrypted),
  };
}

export async function getTenantFromDomain(tenantUuid: string): Promise<string | null> {
  const config = await prisma.authTenantOutboundEmail.findUnique({
    where: { tenantId: tenantUuid },
    select: { fromDomain: true, enabled: true },
  });
  if (!config || !config.enabled) return null;
  return config.fromDomain;
}

export async function markTenantOutboundEmailVerified(tenantUuid: string): Promise<void> {
  await prisma.authTenantOutboundEmail.updateMany({
    where: { tenantId: tenantUuid },
    data: { lastVerifiedAt: new Date() },
  });
}

export async function resolveTenantOutboundEmailForTest(
  actor: AdminActor,
  input?: TestTenantOutboundEmailInput,
): Promise<{ transport: SmtpTransportConfig; fromDomain: string; tenantUuid: string }> {
  const tenantTextId = resolveTenantScope(actor);
  const tenant = await prisma.authTenant.findUnique({
    where: { tenantId: tenantTextId },
    include: { outboundEmail: true },
  });
  if (!tenant) {
    throw new ValidationError('Empresa não encontrada.', 'TENANT_NOT_FOUND');
  }

  if (input?.smtpHost && input.smtpUser) {
    if (!input.smtpPassword && !tenant.outboundEmail) {
      throw new ValidationError('Informe a senha SMTP para testar.', 'SMTP_PASSWORD_REQUIRED');
    }

    const smtpUser = normalizeEmail(input.smtpUser);
    const password =
      input.smtpPassword ??
      (tenant.outboundEmail ? decryptField(tenant.outboundEmail.smtpPasswordEncrypted) : '');

    return {
      tenantUuid: tenant.id,
      fromDomain: extractEmailDomain(smtpUser),
      transport: {
        host: input.smtpHost.trim(),
        port: input.smtpPort ?? 587,
        secure: input.smtpSecure ?? false,
        user: smtpUser,
        password,
      },
    };
  }

  const transport = await resolveTenantSmtpTransport(tenant.id);
  if (!transport) {
    throw new ValidationError(
      'Configure o SMTP da empresa antes de enviar convites.',
      'TENANT_SMTP_NOT_CONFIGURED',
    );
  }

  const fromDomain = tenant.outboundEmail?.fromDomain;
  if (!fromDomain) {
    throw new ValidationError('SMTP da empresa incompleto.', 'TENANT_SMTP_NOT_CONFIGURED');
  }

  return { transport, fromDomain, tenantUuid: tenant.id };
}
