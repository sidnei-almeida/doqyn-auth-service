import { z } from 'zod';

export const createUserSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  whatsapp: z.string().optional(),
  temporaryPassword: z.string().optional(),
});

export const userIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const emailParamSchema = z.object({
  email: z.string().email(),
});

export const publicUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  whatsapp: z.string().nullable().optional(),
  status: z.enum(['active', 'disabled', 'pending_verification', 'anonymized']),
  emailVerified: z.boolean().optional(),
  lastLoginAt: z.string().datetime().nullable().optional(),
});

export type PublicUser = z.infer<typeof publicUserSchema>;
