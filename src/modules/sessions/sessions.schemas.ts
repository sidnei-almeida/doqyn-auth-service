import { z } from 'zod';

export const verifySessionSchema = z.object({
  sessionToken: z.string().min(1),
});

export type VerifySessionInput = z.infer<typeof verifySessionSchema>;
