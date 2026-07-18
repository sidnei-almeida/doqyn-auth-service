import { z } from 'zod';
import { isValidTaxIdForCountry } from '../../utils/taxIdValidation.js';
import { termsAcceptanceFields } from '../terms/termsAcceptance.schemas.js';
import { signupCountryFields } from '../signups/signupCountryFields.schemas.js';

export const individualSignupSchema = z
  .object({
    firstName: z.string().min(1, 'Informe o nome.'),
    lastName: z.string().min(1, 'Informe o sobrenome.'),
    email: z.string().email('E-mail inválido.'),
    whatsapp: z.string().min(8, 'Informe um WhatsApp válido.'),
    ...signupCountryFields,
    taxId: z.string().min(1, 'Informe o documento fiscal.'),
    password: z.string().min(8, 'A senha deve ter pelo menos 8 caracteres.'),
    confirmPassword: z.string().min(8),
    ...termsAcceptanceFields,
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'As senhas não conferem.',
    path: ['confirmPassword'],
  })
  .refine(
    (data) => isValidTaxIdForCountry(data.country, data.taxId, 'individual', data.taxIdType),
    {
      message: 'Documento fiscal inválido.',
      path: ['taxId'],
    },
  );

export type IndividualSignupInput = z.infer<typeof individualSignupSchema>;
