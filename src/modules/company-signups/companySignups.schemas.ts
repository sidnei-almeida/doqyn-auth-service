import { z } from 'zod';
import { isValidTaxIdForCountry } from '../../utils/taxIdValidation.js';
import { termsAcceptanceFields } from '../terms/termsAcceptance.schemas.js';
import { signupCountryFields } from '../signups/signupCountryFields.schemas.js';

const companySignupBaseFields = {
  companyName: z.string().min(2, 'Informe o nome da empresa.'),
  ...signupCountryFields,
  taxId: z.string().min(1, 'Informe o documento fiscal.'),
  firstName: z.string().min(1, 'Informe o nome do responsável.'),
  lastName: z.string().min(1, 'Informe o sobrenome do responsável.'),
  whatsapp: z.string().min(8, 'Informe um WhatsApp válido.'),
  ...termsAcceptanceFields,
};

const validTaxId = {
  check: (data: { country: string; taxId: string; taxIdType: string }) =>
    isValidTaxIdForCountry(data.country, data.taxId, 'company', data.taxIdType),
  message: 'Documento fiscal inválido.',
};

export const companySignupSchema = z
  .object({
    ...companySignupBaseFields,
    email: z.string().email('E-mail inválido.'),
    password: z.string().min(8, 'A senha deve ter pelo menos 8 caracteres.'),
    confirmPassword: z.string().min(8),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'As senhas não conferem.',
    path: ['confirmPassword'],
  })
  .refine(validTaxId.check, { message: validTaxId.message, path: ['taxId'] });

/** Mesma ideia do cadastro PF autenticado — ver `individualSignups.schemas.ts`. */
export const companySignupAttachSchema = z
  .object(companySignupBaseFields)
  .refine(validTaxId.check, { message: validTaxId.message, path: ['taxId'] });

export type CompanySignupInput = z.infer<typeof companySignupSchema>;
export type CompanySignupAttachInput = z.infer<typeof companySignupAttachSchema>;
