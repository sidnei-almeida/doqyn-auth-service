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

/**
 * Espera entre tentativas, em minutos, por número de tentativas já feitas.
 *
 * Escada mais curta que a do alpha, de propósito: lá o aviso já está na caixa do app, e a
 * notificação por e-mail pode chegar horas depois sem problema. Aqui o que está na fila é um
 * código ou link com prazo próprio — 15 a 30 minutos, o menor dos quatro segredos que passam
 * por este outbox — e a escada `[1, 5, 30, 120]` do alpha soma quase três horas até desistir.
 * Uma segunda tentativa vitoriosa naquele prazo entregaria um e-mail com código já morto, sem
 * aviso nenhum de que isso aconteceu. `[1, 3, 8]` soma 12 minutos até a última espera, abaixo do
 * prazo mais curto — ainda dá tempo de uma recusa transitória da Resend se resolver, sem chegar
 * a mandar segredo que já não abre nada.
 *
 * `attempts` chega aqui sempre >= 1 (é `linha.attempts + 1` em quem chama), por isso o índice é
 * `attempts - 1`: a primeira tentativa falha e usa o índice 0 (1 minuto), não o índice 1.
 */
export function emailOutboxRetryDelayMinutes(attempts: number): number {
  return [1, 3, 8][Math.min(attempts - 1, 2)];
}
