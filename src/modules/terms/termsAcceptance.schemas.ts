import { z } from 'zod';
import { DOQYN_TERMS_VERSION } from './terms.constants.js';

export const termsAcceptanceFields = {
  acceptedTerms: z.literal(true, {
    errorMap: () => ({
      message: 'É necessário aceitar os Termos e Condições de Uso para continuar.',
    }),
  }),
  acceptedTermsVersion: z
    .string()
    .min(1, 'Informe a versão dos Termos e Condições aceita.')
    .refine((value) => value === DOQYN_TERMS_VERSION, {
      message: 'A versão dos Termos e Condições enviada não é válida.',
    }),
  /**
   * Em que idioma os termos foram lidos. Opcional para não recusar o cliente antigo: sem ele, o
   * aceite fica em pt-BR, que era o único texto que existia.
   */
  acceptedTermsLocale: z.string().trim().max(10).optional(),
};

export const termsAcceptanceSchema = z.object(termsAcceptanceFields);

export type TermsAcceptanceInput = z.infer<typeof termsAcceptanceSchema>;
