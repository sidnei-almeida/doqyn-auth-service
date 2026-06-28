import { z } from 'zod';
import { normalizeTaxId } from '../../utils/normalize.js';

function isValidCpf(taxId: string): boolean {
  return normalizeTaxId(taxId).length === 11;
}

export const individualSignupSchema = z
  .object({
    firstName: z.string().min(1, 'Informe o nome.'),
    lastName: z.string().min(1, 'Informe o sobrenome.'),
    email: z.string().email('E-mail inválido.'),
    whatsapp: z.string().min(8, 'Informe um WhatsApp válido.'),
    taxId: z.string().min(1, 'Informe o CPF.'),
    password: z.string().min(8, 'A senha deve ter pelo menos 8 caracteres.'),
    confirmPassword: z.string().min(8),
    termsAccepted: z.literal(true, {
      errorMap: () => ({ message: 'É necessário aceitar os termos.' }),
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'As senhas não conferem.',
    path: ['confirmPassword'],
  })
  .refine((data) => isValidCpf(data.taxId), {
    message: 'CPF inválido.',
    path: ['taxId'],
  });

export type IndividualSignupInput = z.infer<typeof individualSignupSchema>;
