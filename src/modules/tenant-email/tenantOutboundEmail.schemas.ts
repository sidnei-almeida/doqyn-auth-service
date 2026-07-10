import { z } from 'zod';

export const upsertTenantOutboundEmailSchema = z.object({
  smtpHost: z.string().trim().min(1).max(255),
  smtpPort: z.coerce.number().int().min(1).max(65535).default(587),
  smtpSecure: z.boolean().default(false),
  smtpUser: z.string().trim().email(),
  smtpPassword: z.string().min(1).max(512),
  enabled: z.boolean().default(true),
});

export const testTenantOutboundEmailSchema = upsertTenantOutboundEmailSchema.partial({
  smtpPassword: true,
});

export type UpsertTenantOutboundEmailInput = z.infer<typeof upsertTenantOutboundEmailSchema>;
export type TestTenantOutboundEmailInput = z.infer<typeof testTenantOutboundEmailSchema>;
