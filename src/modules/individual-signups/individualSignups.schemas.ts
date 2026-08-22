import { z } from 'zod';
import { isValidTaxIdForCountry } from '../../utils/taxIdValidation.js';
import { termsAcceptanceFields } from '../terms/termsAcceptance.schemas.js';
import { signupCountryFields } from '../signups/signupCountryFields.schemas.js';

const individualSignupBaseFields = {
  firstName: z.string().min(1, 'Informe o nome.'),
  lastName: z.string().min(1, 'Informe o sobrenome.'),
  whatsapp: z.string().min(8, 'Informe um WhatsApp válido.'),
  ...signupCountryFields,
  taxId: z.string().min(1, 'Informe o documento fiscal.'),
  ...termsAcceptanceFields,
};

const validTaxId = {
  check: (data: { country: string; taxId: string; taxIdType: string }) =>
    isValidTaxIdForCountry(data.country, data.taxId, 'individual', data.taxIdType),
  message: 'Documento fiscal inválido.',
};

export const individualSignupSchema = z
  .object({
    ...individualSignupBaseFields,
    email: z.string().email('E-mail inválido.'),
    password: z.string().min(8, 'A senha deve ter pelo menos 8 caracteres.'),
    confirmPassword: z.string().min(8),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'As senhas não conferem.',
    path: ['confirmPassword'],
  })
  .refine(validTaxId.check, { message: validTaxId.message, path: ['taxId'] });

/**
 * Cadastro de quem já está autenticado — hoje, quem acabou de entrar por OAuth e ainda não
 * tem tenant. Sem senha (a conta é acessada pelo provedor) e sem e-mail: a identidade vem
 * da sessão, nunca do corpo da requisição, senão bastaria uma sessão válida para criar
 * cadastro em nome de outro e-mail.
 */
export const individualSignupAttachSchema = z
  .object(individualSignupBaseFields)
  .refine(validTaxId.check, { message: validTaxId.message, path: ['taxId'] });

export type IndividualSignupInput = z.infer<typeof individualSignupSchema>;
export type IndividualSignupAttachInput = z.infer<typeof individualSignupAttachSchema>;
