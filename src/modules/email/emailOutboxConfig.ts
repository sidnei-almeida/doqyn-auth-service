/**
 * Constantes do outbox de e-mail transacional (verificação, redefinição, troca de e-mail,
 * convite) — a mesma forma de fila que o app principal já roda para notificações
 * (`emailOutboxDrain.ts` do alpha), com duas contas ajustadas ao que muda aqui.
 *
 * O intervalo de drenagem é de 5 segundos, não os 30 do alpha, e não há teto por pessoa por hora.
 * Os dois existem lá porque a notificação já chegou pelo aviso dentro do app — o e-mail é canal
 * suplementar que pode atrasar — e um import em lote gera centenas de notificações da mesma
 * pessoa num minuto. Nenhuma das duas razões vale aqui: não há aviso dentro do app substituindo
 * um código de login, uma redefinição de senha, uma troca de e-mail ou um convite, e cada linha
 * nasce de uma ação humana só — os limites de taxa e o intervalo mínimo de reenvio de cada rota já
 * seguram quantas linhas uma mesma pessoa produz por hora, então um teto adicional aqui repetiria
 * uma trava que já existe em outro lugar.
 */
export const EMAIL_OUTBOX_BATCH_SIZE = 20;

/** Linha presa em `sending` há mais que isto teve o processo derrubado no meio. */
export const EMAIL_OUTBOX_LOCK_EXPIRA_MS = 5 * 60_000;

/** Intervalo entre passadas do drenador. */
export const EMAIL_OUTBOX_DRAIN_INTERVAL_MS = 5_000;

/** Quantas vezes uma linha é tentada antes de virar `failed` de vez. */
export const EMAIL_OUTBOX_MAX_ATTEMPTS = 4;

/** Espera entre tentativas, em minutos, por número de tentativas já feitas — mesma escada do alpha. */
export function emailOutboxRetryDelayMinutes(attempts: number): number {
  return [1, 5, 30, 120][Math.min(attempts, 3)];
}
