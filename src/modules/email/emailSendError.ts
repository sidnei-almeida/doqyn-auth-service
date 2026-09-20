/**
 * Erro de envio que sabe se vale tentar de novo.
 *
 * Até aqui `sendEmail` só lançava `Error` puro, porque nenhum chamador precisava separar "rede
 * falhou, tenta outra vez" de "o provedor recusou de vez, não insista" — o catch de cada rota só
 * registrava o motivo e desistia. O drenador do outbox é o primeiro chamador que decide isso: uma
 * recusa transitória da Resend (429, 5xx) volta para a fila; uma recusa definitiva (domínio não
 * verificado, remetente inválido) já marca a linha como `failed` na primeira tentativa.
 */
export class EmailSendError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'EmailSendError';
    this.retryable = retryable;
  }
}
