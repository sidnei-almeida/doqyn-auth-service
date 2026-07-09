import type { FastifyReply } from 'fastify';
import {
  AUTH_DATABASE_UNAVAILABLE_CODE,
  AUTH_DATABASE_UNAVAILABLE_MESSAGE,
  DatabaseUnavailableError,
  isPrismaConnectionError,
} from '../db/databaseHealth.js';

export function assertDatabaseAvailable(error: unknown): void {
  if (isPrismaConnectionError(error)) {
    throw new DatabaseUnavailableError();
  }
}

export function sendDatabaseUnavailable(reply: FastifyReply) {
  return reply.status(503).send({
    ok: false,
    code: AUTH_DATABASE_UNAVAILABLE_CODE,
    message: AUTH_DATABASE_UNAVAILABLE_MESSAGE,
  });
}
