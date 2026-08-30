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

export const updateUserAvatarMetadataSchema = z.object({
  storageProvider: z.enum(['r2', 'local']).nullable().optional(),
  objectKey: z.string().min(1).nullable().optional(),
  contentType: z.string().min(1).nullable().optional(),
  version: z.number().int().min(0),
  size: z.number().int().positive().nullable().optional(),
  status: z.enum(['active', 'removed']),
});

/**
 * O filtro de status da listagem de solicitações.
 *
 * Os valores são os do enum `AccessRequestStatus` do Prisma. Um valor fora deles não chega a ser
 * "nenhum resultado": estoura a validação do Prisma e vira 500, que culpa o servidor por um erro
 * de quem chamou.
 */
export const accessRequestStatusQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
});
