import { z } from 'zod';
import { isValidTaxIdForCountry } from '../../utils/taxIdValidation.js';
import { termsAcceptanceFields } from '../terms/termsAcceptance.schemas.js';
import { signupCountryFields } from '../signups/signupCountryFields.schemas.js';

export const companySignupSchema = z
  .object({
    companyName: z.string().min(2, 'Informe o nome da empresa.'),
    ...signupCountryFields,
    taxId: z.string().min(1, 'Informe o documento fiscal.'),
    firstName: z.string().min(1, 'Informe o nome do responsável.'),
    lastName: z.string().min(1, 'Informe o sobrenome do responsável.'),
    email: z.string().email('E-mail inválido.'),
    whatsapp: z.string().min(8, 'Informe um WhatsApp válido.'),
    password: z.string().min(8, 'A senha deve ter pelo menos 8 caracteres.'),
    confirmPassword: z.string().min(8),
    ...termsAcceptanceFields,
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'As senhas não conferem.',
    path: ['confirmPassword'],
  })
  .refine(
    (data) => isValidTaxIdForCountry(data.country, data.taxId, 'company', data.taxIdType),
    {
      message: 'Documento fiscal inválido.',
      path: ['taxId'],
    },
  );

export type CompanySignupInput = z.infer<typeof companySignupSchema>;
