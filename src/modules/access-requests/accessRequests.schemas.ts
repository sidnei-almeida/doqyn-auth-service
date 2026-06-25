import { z } from 'zod';

export const accessRequestSchema = z.object({
  personType: z.enum(['individual', 'business']),
  taxId: z.string().min(1),
  tenantDisplayName: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  whatsapp: z.string().min(1),
  password: z.string().min(8),
  jobTitle: z.string().min(1),
  departmentText: z.string().min(1),
  reason: z.string().min(1),
  operationalNotificationsConsent: z.boolean().default(false),
});

export type AccessRequestInput = z.infer<typeof accessRequestSchema>;
