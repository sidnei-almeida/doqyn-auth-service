import { isProduction, loadEnv } from '../../config/env.js';
import { ServiceUnavailableError } from '../../utils/errors.js';
import { isPlatformEmailConfigured } from '../email/email.service.js';

/**
 * Recusa o cadastro por formulário quando não há como entregar o código.
 *
 * A conta nasce trancada até o e-mail ser confirmado, e é o envio que destrava. Sem SMTP
 * configurado em produção o código não sai, e a resposta não pode devolvê-lo — sobra uma conta
 * criada que ninguém alcança, ocupando o e-mail e o CNPJ para sempre. Recusar na porta é a única
 * saída honesta: nada é gravado, e a pessoa é mandada para um caminho que funciona.
 *
 * Em desenvolvimento não se aplica: o código volta na resposta, então o fluxo é percorrível.
 *
 * Quem entra por Google ou Microsoft não passa por aqui — o provedor já provou o endereço, e é
 * por isso que a mensagem aponta para eles.
 */
export function assertSignupEmailDeliverable(): void {
  const env = loadEnv();
  if (!isProduction(env)) return;
  if (isPlatformEmailConfigured()) return;

  throw new ServiceUnavailableError(
    'O cadastro por e-mail e senha está indisponível no momento. Entre com Google ou Microsoft para criar sua conta.',
    'SIGNUP_EMAIL_UNAVAILABLE',
  );
}
