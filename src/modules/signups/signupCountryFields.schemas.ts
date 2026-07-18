import { z } from 'zod';
import { isSupportedCountry } from 'libphonenumber-js/min';

/**
 * Campos de país/documento fiscal compartilhados entre individual-signups e
 * company-signups — evita que os dois cadastros divirjam silenciosamente
 * (ex.: um aceitando um código de país que o outro rejeita).
 */
export const signupCountryFields = {
  /** ISO 3166-1 alpha-2 (ex.: BR, PY, US, ES) — validado contra a lista real de países do libphonenumber-js, não só o formato de 2 letras. */
  country: z
    .string()
    .trim()
    .toUpperCase()
    .refine(isSupportedCountry, 'País inválido.'),
  /** Tipo de documento fiscal (ex.: cpf, cnpj, ci, ruc, ssn, ein, nif, cif, tax_id) — decidido pelo frontend a partir do país. */
  taxIdType: z.string().trim().toLowerCase().min(1, 'Tipo de documento fiscal inválido.'),
};
