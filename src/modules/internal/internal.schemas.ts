import { z } from 'zod';

export const createInternalUserSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  whatsapp: z.string().optional(),
  temporaryPassword: z.string().optional(),
});

export const verifySessionInternalSchema = z.object({
  sessionToken: z.string().min(1),
});
