import { z } from 'zod';

/** Nome e sobrenome da própria conta. Vazio é permitido: nem toda pessoa informa sobrenome. */
export const updateOwnProfileSchema = z.object({
  firstName: z.string().trim().max(80, 'Nome muito longo.'),
  lastName: z.string().trim().max(80, 'Sobrenome muito longo.'),
});

export type UpdateOwnProfileInput = z.infer<typeof updateOwnProfileSchema>;
