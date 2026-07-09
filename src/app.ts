import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import { getAllowedOrigins, loadEnv } from './config/env.js';
import {
  AUTH_DATABASE_UNAVAILABLE_CODE,
  AUTH_DATABASE_UNAVAILABLE_MESSAGE,
  DEV_DB_START_COMMAND,
  checkDatabaseConnection,
  parseDatabaseUrl,
} from './db/databaseHealth.js';
import { prisma } from './db/prisma.js';
import { authRoutes, registerErrorHandler } from './modules/auth/auth.routes.js';
import { adminRoutes } from './modules/admin/admin.routes.js';
import { accountRoutes } from './modules/account/account.routes.js';
import { internalRoutes } from './modules/internal/internal.routes.js';
import { oauthRoutes } from './modules/oauth/oauth.routes.js';

export async function buildApp() {
  const env = loadEnv();
  const app = Fastify({
    logger: env.NODE_ENV === 'development',
    trustProxy: true,
  });

  // Aceita corpo JSON vazio ({}) ou ausente quando Content-Type é application/json.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    try {
      if (body === '' || body === undefined || body === null) {
        done(null, undefined);
        return;
      }
      done(null, JSON.parse(body as string) as unknown);
    } catch (error) {
      done(error as Error, undefined);
    }
  });

  await app.register(cors, {
    origin: getAllowedOrigins(env),
    credentials: true,
  });

  await app.register(cookie);

  app.get('/health', async (_request, reply) => {
    const db = await checkDatabaseConnection(prisma);
    const database = parseDatabaseUrl(env.DATABASE_URL);

    if (!db.ok) {
      return reply.status(503).send({
        ok: false,
        service: 'doqyn-auth-service',
        database: 'unavailable',
        databaseHost: database.host,
        databasePort: database.port,
        databaseName: database.database,
        code: AUTH_DATABASE_UNAVAILABLE_CODE,
        message: AUTH_DATABASE_UNAVAILABLE_MESSAGE,
        ...(env.NODE_ENV === 'development'
          ? { devHint: `Run: ${DEV_DB_START_COMMAND}` }
          : {}),
      });
    }

    return reply.send({
      ok: true,
      service: 'doqyn-auth-service',
      database: 'ok',
      databaseHost: database.host,
      databasePort: database.port,
      databaseName: database.database,
    });
  });

  await app.register(authRoutes);
  await app.register(oauthRoutes);
  await app.register(adminRoutes);
  await app.register(accountRoutes);
  await app.register(internalRoutes);

  registerErrorHandler(app);

  return app;
}
