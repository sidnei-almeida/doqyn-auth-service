import { z } from 'zod';
import { termsAcceptanceFields } from '../terms/termsAcceptance.schemas.js';

const tenantRoleSchema = z.enum(['company_admin', 'individual_admin', 'user']);

export const createInviteSchema = z.object({
  email: z.string().email(),
  roles: z.array(tenantRoleSchema).min(1).default(['user']),
  /**
   * Os grupos que o convidado recebe ao aceitar.
   *
   * São os `groupId` de texto que a empresa usa, não os UUIDs internos — é o mesmo formato que
   * `updateMemberAccessGroups` recebe, e o que o front já tem em mãos. Vazio é legítimo: nem
   * todo convite precisa conceder grupo, e um administrador convidado alcança tudo por papel.
   */
  accessGroupIds: z.array(z.string().trim().min(1)).default([]),
  tenantId: z.string().optional(),
  firstName: z.string().trim().optional(),
  lastName: z.string().trim().optional(),
});

export const inviteTokenParamSchema = z.object({
  token: z.string().min(16),
});

export const inviteIdParamSchema = z.object({
  inviteId: z.string().uuid(),
});

export const acceptInviteSchema = z.object({
  firstName: z.string().trim().optional(),
  lastName: z.string().trim().optional(),
  password: z.string().optional(),
  whatsapp: z.string().min(8, 'Informe um WhatsApp válido.').optional(),
  jobTitle: z.string().trim().min(1, 'Informe o cargo ou função.'),
  departmentText: z.string().trim().min(1, 'Informe o setor.'),
  operationalNotificationsConsent: z.literal(true, {
    errorMap: () => ({
      message: 'É necessário aceitar o consentimento de notificações operacionais.',
    }),
  }),
  informationDeclaration: z.literal(true, {
    errorMap: () => ({
      message: 'É necessário confirmar que as informações fornecidas são verdadeiras.',
    }),
  }),
  ...termsAcceptanceFields,
});

export type CreateInviteInput = z.infer<typeof createInviteSchema>;
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
