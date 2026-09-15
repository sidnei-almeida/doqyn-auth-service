import { z } from 'zod';

export const createUserSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  whatsapp: z.string().optional(),
  temporaryPassword: z.string().optional(),
});

export const userIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const emailParamSchema = z.object({
  email: z.string().email(),
});

export const publicUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  whatsapp: z.string().nullable().optional(),
  status: z.enum(['active', 'disabled', 'pending_verification', 'anonymized']),
  emailVerified: z.boolean().optional(),
  lastLoginAt: z.string().datetime().nullable().optional(),
  avatarVersion: z.number().int().nonnegative().optional(),
  avatarUpdatedAt: z.string().datetime().nullable().optional(),
  avatarStatus: z.enum(['active', 'removed']).nullable().optional(),
  /**
   * O apelido público, e se ele aparece na busca entre empresas.
   *
   * Vão aqui porque a pessoa precisa poder ver os dois. O handle é escolhido no cadastro mas pode
   * sair diferente — `claimUsername` acrescenta sufixo quando colide —, e é por ele que gente de
   * outra empresa a encontra: não mostrá-lo deixava alguém sendo procurado por um nome que nunca
   * soube que tinha.
   */
  username: z.string().nullable().optional(),
  usernameDiscoverable: z.boolean().optional(),
  /**
   * Idioma da interface e fuso, em BCP-47 e IANA.
   *
   * Saem daqui porque quem os consome não é só a tela: o `doqyn-alpha` lê os dois na
   * verificação de sessão para renderizar e-mail e notificação na língua certa de cada
   * destinatário, sem navegador nenhum por perto.
   */
  locale: z.string().optional(),
  timeZone: z.string().nullable().optional(),
});

export type PublicUser = z.infer<typeof publicUserSchema>;
