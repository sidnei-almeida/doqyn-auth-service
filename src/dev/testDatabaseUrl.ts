/**
 * O banco de teste, derivado do de trabalho.
 *
 * Trocar só o nome mantém credencial, host e porta de quem roda. Um padrão com senha escrita à
 * mão falha na máquina de qualquer um que não use exatamente aquela — e falha com "credencial
 * inválida", que não diz o que está errado.
 *
 * `TEST_DATABASE_URL` explícito é escolha de quem configurou e passa intacto: reescrevê-lo levaria
 * quem apontou para `authtest` a um `authtest_test` que provavelmente não existe.
 */
export function toTestDatabaseUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  const name = url.pathname.replace(/^\//, '');
  if (name.endsWith('_test')) return url.toString();

  url.pathname = `/${name}_test`;
  return url.toString();
}

/**
 * O banco onde a suíte deve rodar, e a regra de precedência num lugar só.
 *
 * `TEST_DATABASE_URL` vence e é usado como veio. Sem ele, deriva do `DATABASE_URL` de trabalho.
 */
export function resolveTestDatabaseUrl(env: NodeJS.ProcessEnv): string | null {
  if (env.TEST_DATABASE_URL) return env.TEST_DATABASE_URL;
  if (env.DATABASE_URL) return toTestDatabaseUrl(env.DATABASE_URL);
  return null;
}
