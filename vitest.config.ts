import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'vitest/config';
import { resolveTestDatabaseUrl, toTestDatabaseUrl } from './src/dev/testDatabaseUrl.js';

loadDotenv();

/**
 * O banco dos testes precisa estar no ambiente **antes** do primeiro `import`.
 *
 * `new PrismaClient()` lê `DATABASE_URL` na construção, e a construção acontece quando
 * `src/db/prisma.ts` é importado — no topo de `tests/setup.ts`, muito antes de qualquer
 * `beforeAll`. Definir o banco lá dentro nunca chegava ao cliente: a suíte dizia estar num banco
 * de teste e apagava o de desenvolvimento, que é o que o `.env` aponta. E o `beforeEach` apaga
 * todas as tabelas.
 */
const TEST_DATABASE_URL = resolveTestDatabaseUrl(process.env);

if (!TEST_DATABASE_URL) {
  throw new Error('Sem DATABASE_URL nem TEST_DATABASE_URL: não dá para saber onde testar.');
}

const TEST_DATABASE_URL_DIRECT = process.env.TEST_DATABASE_URL_DIRECT
  ? process.env.TEST_DATABASE_URL_DIRECT
  : process.env.DATABASE_URL_DIRECT
    ? toTestDatabaseUrl(process.env.DATABASE_URL_DIRECT)
    : TEST_DATABASE_URL;

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DATABASE_URL,
      DATABASE_URL_DIRECT: TEST_DATABASE_URL_DIRECT,
    },
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
  },
});
