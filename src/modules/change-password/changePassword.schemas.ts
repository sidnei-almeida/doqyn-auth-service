import { z } from 'zod';
import { MIN_PASSWORD_LENGTH } from '../../security/password.js';

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Senha atual é obrigatória.'),
    newPassword: z.string().min(MIN_PASSWORD_LENGTH),
    confirmPassword: z.string().min(MIN_PASSWORD_LENGTH),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'A confirmação da nova senha não confere.',
    path: ['confirmPassword'],
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
