import { z } from 'zod';

export const publicMembershipSchema = z.object({
  membershipId: z.string().uuid(),
  tenantId: z.string(),
  tenantType: z.enum(['individual', 'business']),
  tenantDisplayName: z.string().nullable(),
  status: z.enum(['pending', 'active', 'blocked', 'rejected', 'removed']),
  roles: z.array(z.enum(['doqyn_admin', 'company_admin', 'individual_admin', 'user'])),
  accessGroupIds: z.array(z.string()),
});

export type PublicMembership = z.infer<typeof publicMembershipSchema>;

export const membershipSummarySchema = publicMembershipSchema.pick({
  membershipId: true,
  tenantId: true,
  tenantType: true,
  tenantDisplayName: true,
  status: true,
});

export type MembershipSummary = z.infer<typeof membershipSummarySchema>;

export const sessionContextSchema = z.object({
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    firstName: z.string().nullable().optional(),
    lastName: z.string().nullable().optional(),
    whatsapp: z.string().nullable().optional(),
    status: z.enum(['active', 'disabled', 'pending_verification', 'anonymized']),
    emailVerified: z.boolean().optional(),
  }),
  activeMembership: publicMembershipSchema.nullable(),
  memberships: z.array(membershipSummarySchema),
});

export type SessionContext = z.infer<typeof sessionContextSchema>;

export interface MemberDetailResponse {
  user: SessionContext['user'];
  membership: PublicMembership;
  tenant: {
    tenantId: string;
    tenantType: 'individual' | 'business';
    displayName: string | null;
    status: string;
  };
  requestedAccess?: {
    personType: string;
    taxIdType: string;
    taxIdMasked: string | null;
    tenantDisplayName: string | null;
    jobTitle: string | null;
    departmentText: string | null;
    reason: string | null;
    requestedAt: string;
    source: 'access_request';
  };
  consent?: {
    textVersion: string | null;
    acceptedAt: string;
    operationalNotificationsConsent: boolean;
  };
  notificationPreferences?: {
    email: boolean;
    whatsapp: boolean;
    documentCreated: boolean;
    documentUpdated: boolean;
    documentRequiresSignature: boolean;
    accessApproved: boolean;
    accessRejected: boolean;
  };
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}
