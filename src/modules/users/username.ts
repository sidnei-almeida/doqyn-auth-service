/**
 * O handle público, e as regras que o tornam previsível.
 *
 * Minúsculas, sem acento, e só letras, números, ponto, hífen e sublinhado. Não é estética: um
 * handle que aceita maiúscula e acento cria dois caminhos para a mesma pessoa — `Joao` e `joão`
 * pareceriam handles distintos e disputariam o mesmo índice único.
 */
const MIN_LENGTH = 3;
const MAX_LENGTH = 32;
const SHAPE = /^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$/;

/**
 * Reservados porque viram rota ou prometem autoridade que ninguém tem.
 *
 * Um handle `admin` ou `suporte` é phishing pronto: quem recebe um documento de "suporte" supõe
 * que veio do DOQYN.
 */
const RESERVED = new Set([
  'admin',
  'administrador',
  'api',
  'contato',
  'doqyn',
  'help',
  'root',
  'seguranca',
  'sistema',
  'suporte',
  'support',
  'system',
]);

export function normalizeUsername(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9._-]/g, '');
}

export type UsernameProblem = 'too_short' | 'too_long' | 'invalid_shape' | 'reserved' | 'taken';

export function validateUsernameShape(username: string): UsernameProblem | null {
  if (username.length < MIN_LENGTH) return 'too_short';
  if (username.length > MAX_LENGTH) return 'too_long';
  if (!SHAPE.test(username)) return 'invalid_shape';
  if (RESERVED.has(username)) return 'reserved';
  return null;
}

/**
 * Um handle a partir do e-mail, para quem já existia antes desta coluna.
 *
 * A parte local do e-mail é o palpite mais próximo do que a pessoa escolheria, e colidir é normal:
 * duas empresas têm o seu `financeiro`. O sufixo numérico resolve sem pedir nada a ninguém — e o
 * handle continua trocável depois.
 */
export function suggestUsernameFromEmail(email: string): string {
  const local = normalizeUsername(email.split('@')[0] ?? '');
  const base = local.replace(/^[._-]+|[._-]+$/g, '');

  if (base.length >= MIN_LENGTH) return base.slice(0, MAX_LENGTH);
  // E-mail curto ou só com símbolo: o handle ainda precisa existir e ser estável.
  return `user${base}`.slice(0, MAX_LENGTH).padEnd(MIN_LENGTH, '0');
}
