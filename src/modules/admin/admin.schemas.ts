import { z } from 'zod';
import type { TenantRole } from '@prisma/client';

export const notificationPreferencesSchema = z.object({
  email: z.boolean().optional(),
  whatsapp: z.boolean().optional(),
  documentCreated: z.boolean().optional(),
  documentUpdated: z.boolean().optional(),
  documentRequiresSignature: z.boolean().optional(),
  accessApproved: z.boolean().optional(),
  accessRejected: z.boolean().optional(),
});

export const approveMembershipSchema = z.object({
  roles: z.array(z.enum(['doqyn_admin', 'company_admin', 'individual_admin', 'user'])).min(1),
  accessGroupIds: z.array(z.string()).default([]),
  notificationPreferences: notificationPreferencesSchema.optional(),
});

export const updateMemberRolesSchema = z.object({
  roles: z.array(z.enum(['doqyn_admin', 'company_admin', 'individual_admin', 'user'])).min(1),
});

export const updateMemberAccessGroupsSchema = z.object({
  accessGroupIds: z.array(z.string()).default([]),
});

export const membershipIdParamSchema = z.object({
  membershipId: z.string().uuid(),
});

export const userIdParamSchema = z.object({
  userId: z.string().uuid(),
});

export const tenantIdParamSchema = z.object({
  tenantId: z.string().min(1),
});

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const adminListQuerySchema = z.object({
  tenantId: z.string().optional(),
  status: z.enum(['pending', 'active', 'blocked', 'rejected', 'removed']).optional(),
  role: z.enum(['doqyn_admin', 'company_admin', 'individual_admin', 'user']).optional(),
  accessGroupId: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const adminAccessRequestsQuerySchema = z.object({
  tenantId: z.string().optional(),
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
});

export const adminGroupsQuerySchema = z.object({
  tenantId: z.string().optional(),
  status: z.enum(['active', 'inactive', 'deleted']).optional(),
  search: z.string().optional(),
});

export const adminTenantsQuerySchema = z.object({
  status: z.enum(['pending', 'active', 'blocked']).optional(),
  tenantType: z.enum(['individual', 'business']).optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const createTenantAdminSchema = z.object({
  tenantId: z.string().min(1),
  tenantType: z.enum(['individual', 'business']),
  displayName: z.string().min(1).optional(),
  taxId: z.string().optional(),
  slug: z.string().optional(),
});

export const updateTenantAdminSchema = z.object({
  displayName: z.string().min(1).optional(),
  slug: z.string().optional(),
  status: z.enum(['pending', 'active', 'blocked']).optional(),
});

export const transferAdminSchema = z.object({
  fromMembershipId: z.string().uuid(),
  toMembershipId: z.string().uuid(),
});

export const accountDeletionRequestSchema = z.object({
  reason: z.string().max(1000).optional(),
});

export const selectTenantSchema = z
  .object({
    tenantId: z.string().optional(),
    membershipId: z.string().uuid().optional(),
  })
  .refine((d) => d.tenantId || d.membershipId, {
    message: 'tenantId ou membershipId é obrigatório',
  });

export type ApproveMembershipInput = z.infer<typeof approveMembershipSchema>;
export type AdminRole = TenantRole;
