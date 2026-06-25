import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import { getAllowedOrigins, loadEnv } from './config/env.js';
import { authRoutes, registerErrorHandler } from './modules/auth/auth.routes.js';
import { adminRoutes } from './modules/admin/admin.routes.js';
import { accountRoutes } from './modules/account/account.routes.js';
import { internalRoutes } from './modules/internal/internal.routes.js';

export async function buildApp() {
  const env = loadEnv();
  const app = Fastify({
    logger: env.NODE_ENV === 'development',
    trustProxy: true,
  });

  await app.register(cors, {
    origin: getAllowedOrigins(env),
    credentials: true,
  });

  await app.register(cookie);

  app.get('/health', async () => ({
    ok: true,
    service: 'doqyn-auth-service',
  }));

  await app.register(authRoutes);
  await app.register(adminRoutes);
  await app.register(accountRoutes);
  await app.register(internalRoutes);

  registerErrorHandler(app);

  return app;
}
