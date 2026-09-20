import type { AuthEmailOutboxPurpose } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { encryptField } from '../../security/crypto.js';
import type { EmailMessage } from './email.types.js';
import { isPlatformEmailConfigured, sendEmail } from './email.service.js';

/**
 * Enfileira um e-mail transacional em vez de mandar na hora.
 *
 * O corpo já vem renderizado por quem chama — código, link, o que for — porque este é o único
 * momento em que o segredo ainda existe em texto claro (ver o comentário de `AuthEmailOutbox` no
 * schema). A partir daqui o envio de fato é trabalho do drenador.
 *
 * Sem plataforma de e-mail configurada, nenhuma linha nasce: o mesmo adapter de console que os
 * quatro chamadores já usavam continua sendo o destino, e nada muda no comportamento de
 * dev/teste sem SMTP/Resend.
 */
export async function enqueueEmail(input: {
  userId?: string | null;
  purpose: AuthEmailOutboxPurpose;
  message: EmailMessage;
}): Promise<{ queued: boolean; id?: string }> {
  if (!isPlatformEmailConfigured()) {
    await sendEmail(input.message);
    return { queued: false };
  }

  const row = await prisma.authEmailOutbox.create({
    data: {
      userId: input.userId ?? null,
      purpose: input.purpose,
      toEncrypted: encryptField(input.message.to),
      subject: input.message.subject,
      html: input.message.html,
      text: input.message.text,
      fromName: input.message.from?.name,
      fromEmail: input.message.from?.email,
      replyToName: input.message.replyTo?.name,
      replyToEmail: input.message.replyTo?.email,
    },
  });

  return { queued: true, id: row.id };
}
