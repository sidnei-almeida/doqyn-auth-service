import { z } from 'zod';

/**
 * Nome e sobrenome da própria conta.
 *
 * **Sobrenome pode ser vazio; nome não.** Nem toda pessoa informa sobrenome, e todo formulário de
 * cadastro já exige `firstName`. Sem o mínimo aqui, um `PATCH` com `firstName: ""` gravava nulo e
 * a pessoa passava a aparecer sem nome no diretório e nas listas de membros — inclusive para quem
 * já a tinha encontrado antes.
 */
export const updateOwnProfileSchema = z.object({
  firstName: z.string().trim().min(1, 'Informe o nome.').max(80, 'Nome muito longo.'),
  lastName: z.string().trim().max(80, 'Sobrenome muito longo.'),
});

export type UpdateOwnProfileInput = z.infer<typeof updateOwnProfileSchema>;

/**
 * Entrar ou sair da busca entre empresas.
 *
 * Um booleano explícito, e não um "alternar": alternar depende do estado que o cliente acha que
 * tem, e duas telas abertas se desfariam uma à outra.
 */
export const updateDirectoryVisibilitySchema = z.object({
  discoverable: z.boolean(),
});

export type UpdateDirectoryVisibilityInput = z.infer<typeof updateDirectoryVisibilitySchema>;
