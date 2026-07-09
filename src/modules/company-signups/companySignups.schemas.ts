import { z } from 'zod';
import { normalizeTaxId } from '../../utils/normalize.js';
import { termsAcceptanceFields } from '../terms/termsAcceptance.schemas.js';

function isValidCnpj(taxId: string): boolean {
  return normalizeTaxId(taxId).length === 14;
}

export const companySignupSchema = z
  .object({
    companyName: z.string().min(2, 'Informe o nome da empresa.'),
    taxId: z.string().min(1, 'Informe o CNPJ.'),
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
  .refine((data) => isValidCnpj(data.taxId), {
    message: 'CNPJ inválido.',
    path: ['taxId'],
  });

export type CompanySignupInput = z.infer<typeof companySignupSchema>;
