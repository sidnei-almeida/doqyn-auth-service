import { z } from 'zod';

export const requestEmailChangeSchema = z.object({
  newEmail: z.string().email(),
  password: z.string().min(1),
});

export const emailChangeTokenParamSchema = z.object({
  token: z.string().min(16),
});

export const confirmEmailChangeCodeSchema = z.object({
  // Mesmo tratamento da confirmação de cadastro: o formato legível `123 456` chega como o
  // usuário digitou, e só os dígitos importam.
  code: z
    .string()
    .transform((value) => value.replace(/\D/g, ''))
    .pipe(z.string().regex(/^\d{6}$/, 'Código inválido.')),
});

export type RequestEmailChangeInput = z.infer<typeof requestEmailChangeSchema>;
