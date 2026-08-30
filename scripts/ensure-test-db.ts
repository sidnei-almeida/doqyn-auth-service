import { execSync } from 'node:child_process';
import { config as loadDotenv } from 'dotenv';
import { resolveTestDatabaseUrl } from '../src/dev/testDatabaseUrl.js';

loadDotenv();

/**
 * Deixa o banco de teste com o schema do dia, antes de a suíte abrir.
 *
 * Enquanto os testes rodavam no banco de desenvolvimento, ele vinha migrado por tabela porque o
 * `npm run dev` migra na subida. Apontando para o banco de teste de verdade, ninguém migrava —
 * e a suíte quebrava com "coluna não existe" a cada migração nova, que é um erro que parece bug
 * de código e não de ambiente.
 */
function main(): void {
  const databaseUrl = resolveTestDatabaseUrl(process.env);

  if (!databaseUrl) {
    console.error('Sem DATABASE_URL nem TEST_DATABASE_URL: não dá para saber qual banco preparar.');
    process.exit(1);
  }

  const name = new URL(databaseUrl).pathname.replace(/^\//, '');

  if (!name.endsWith('_test')) {
    console.error(`Recusado: "${name}" não é banco de teste, e a suíte apaga todas as tabelas.`);
    process.exit(1);
  }

  console.log(`Preparando banco de teste "${name}"...`);
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    // Só para este processo filho: não encosta no `.env` de quem roda.
    env: { ...process.env, DATABASE_URL: databaseUrl, DATABASE_URL_DIRECT: databaseUrl },
  });
}

main();
