import { z } from 'zod';
import { termsAcceptanceFields } from '../terms/termsAcceptance.schemas.js';

export const accessRequestSchema = z.object({
  personType: z.enum(['individual', 'business']).default('business'),
  taxId: z.string().min(1),
  tenantDisplayName: z.string().optional(),
  firstName: z.string().min(1),
  /**
   * O apelido, escolhido aqui e não depois.
   *
   * Opcional de propósito: quem não escolher recebe um derivado do e-mail, porque conta sem
   * apelido fica invisível ao diretório para sempre. Pedir aqui é o que dá à pessoa a chance de
   * ser encontrada pelo nome que ela quer.
   */
  username: z.string().trim().max(32).optional(),
  lastName: z.string().min(1),
  email: z.string().email(),
  whatsapp: z.string().min(1),
  password: z.string().min(8),
  jobTitle: z.string().min(1),
  departmentText: z.string().min(1),
  reason: z.string().min(1),
  operationalNotificationsConsent: z.boolean().default(false),
  ...termsAcceptanceFields,
});

export type AccessRequestInput = z.infer<typeof accessRequestSchema>;
