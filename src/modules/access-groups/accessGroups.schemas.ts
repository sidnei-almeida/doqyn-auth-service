import { z } from 'zod';

export const createAccessGroupSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
});

export const updateAccessGroupSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

export const groupIdParamSchema = z.object({
  groupId: z.string().min(1),
});
