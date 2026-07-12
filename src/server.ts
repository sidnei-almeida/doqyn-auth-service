import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import {
  buildStartupDatabaseFailureMessage,
  checkDatabaseConnection,
} from './db/databaseHealth.js';
import { disconnectPrisma, prisma } from './db/prisma.js';
import { connectRedisOnBoot, closeRedis } from './redis/redisClient.js';

async function main() {
  const env = loadEnv();

  if (!env.DATABASE_URL?.trim()) {
    console.error('DATABASE_URL não configurada.');
    process.exit(1);
  }

  await connectRedisOnBoot();

  const dbCheck = await checkDatabaseConnection(prisma);
  if (!dbCheck.ok) {
    console.error(buildStartupDatabaseFailureMessage(env.DATABASE_URL));
    await disconnectPrisma();
    process.exit(1);
  }

  const app = await buildApp();

  const shutdown = async () => {
    await app.close();
    await disconnectPrisma();
    await closeRedis();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  console.log(`doqyn-auth-service listening on port ${env.PORT}`);
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
