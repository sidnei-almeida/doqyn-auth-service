import { z } from 'zod';

const ticket = z.string().min(16);

export const emailVerificationTicketSchema = z.object({ ticket });

export const confirmEmailVerificationCodeSchema = z.object({
  ticket,
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

export const emailVerificationStatusQuerySchema = z.object({ ticket });

export type ConfirmEmailVerificationCodeInput = z.infer<typeof confirmEmailVerificationCodeSchema>;
