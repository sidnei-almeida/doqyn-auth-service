import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { disconnectPrisma } from './db/prisma.js';

async function main() {
  const env = loadEnv();
  const app = await buildApp();

  const shutdown = async () => {
    await app.close();
    await disconnectPrisma();
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
