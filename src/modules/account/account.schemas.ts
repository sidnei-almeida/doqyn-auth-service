import { z } from 'zod';
import { isSupportedLocale, isValidTimeZone } from '../../utils/locales.js';

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
/**
 * Preferências de apresentação da conta.
 *
 * Os dois campos são opcionais e independentes: quem troca só o idioma não deve ter o fuso
 * apagado no caminho. `null` no fuso é escolha explícita — significa "use o do navegador" —
 * e por isso não é o mesmo que ausente.
 *
 * A validação de idioma é contra a lista de suportados, não contra a forma de uma etiqueta
 * BCP-47: aceitar `de-DE` porque parece válido gravaria uma preferência que o servidor não
 * sabe honrar, e o defeito só apareceria num e-mail, meses depois.
 */
export const updatePreferencesSchema = z
  .object({
    locale: z.string().refine(isSupportedLocale, 'Idioma não suportado.').optional(),
    timeZone: z
      .string()
      .max(64)
      .refine(isValidTimeZone, 'Fuso horário inválido.')
      .nullable()
      .optional(),
  })
  .refine(
    (value) => value.locale !== undefined || value.timeZone !== undefined,
    'Informe idioma ou fuso horário.',
  );

export const updateDirectoryVisibilitySchema = z.object({
  discoverable: z.boolean(),
});

export type UpdateDirectoryVisibilityInput = z.infer<typeof updateDirectoryVisibilitySchema>;
