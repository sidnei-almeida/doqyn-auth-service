import { z } from 'zod';

export const requestEmailChangeSchema = z.object({
  newEmail: z.string().email(),
  password: z.string().min(1),
});

export const emailChangeTokenParamSchema = z.object({
  token: z.string().min(16),
});

export type RequestEmailChangeInput = z.infer<typeof requestEmailChangeSchema>;
