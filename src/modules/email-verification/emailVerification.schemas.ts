import { z } from 'zod';

export const confirmEmailVerificationCodeSchema = z.object({
  // Só dígitos, e exatamente seis. A tela manda o que a pessoa digitou; espaços e traços do
  // formato legível (`123 456`) são removidos antes de validar.
  code: z
    .string()
    .transform((value) => value.replace(/\D/g, ''))
    .pipe(z.string().regex(/^\d{6}$/, 'Código inválido.')),
});

export const emailVerificationTokenParamSchema = z.object({
  token: z.string().min(16),
});

export type ConfirmEmailVerificationCodeInput = z.infer<typeof confirmEmailVerificationCodeSchema>;
