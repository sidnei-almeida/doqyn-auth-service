import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createOrGetUser } from '../src/modules/users/users.service.js';
import { TEST_ENV } from './setup.js';

const INTERNAL_KEY = TEST_ENV.DOQYN_INTERNAL_API_KEY;

function authHeader(): Record<string, string> {
  return { authorization: `Bearer ${INTERNAL_KEY}` };
}

describe('user avatar metadata', () => {
  let app: FastifyInstance;
  let userId: string;

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    const user = await createOrGetUser({ email: 'avatar-meta@empresa.com' });
    userId = user.id;
  });

  it('PATCH /internal/users/:id/avatar-metadata atualiza versão sem expor objectKey no PublicUser', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/internal/users/${userId}/avatar-metadata`,
      headers: { ...authHeader(), 'content-type': 'application/json' },
      payload: {
        storageProvider: 'r2',
        objectKey: 'profiles/users/test/avatar/v1/avatar_128.webp',
        contentType: 'image/webp',
        version: 1,
        size: 4096,
        status: 'active',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.user.avatarVersion).toBe(1);
    expect(body.user.avatarStatus).toBe('active');
    expect(body.user.avatarObjectKey).toBeUndefined();
  });

  it('GET /internal/users/:id/avatar-metadata retorna metadados internos', async () => {
    await app.inject({
      method: 'PATCH',
      url: `/internal/users/${userId}/avatar-metadata`,
      headers: { ...authHeader(), 'content-type': 'application/json' },
      payload: {
        storageProvider: 'r2',
        objectKey: 'profiles/users/test/avatar/v1/avatar_128.webp',
        contentType: 'image/webp',
        version: 1,
        size: 4096,
        status: 'active',
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/internal/users/${userId}/avatar-metadata`,
      headers: authHeader(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.metadata.version).toBe(1);
    expect(body.metadata.objectKey).toContain('profiles/users/');
    expect(body.metadata.status).toBe('active');
  });

  it('remover avatar incrementa status removed', async () => {
    await app.inject({
      method: 'PATCH',
      url: `/internal/users/${userId}/avatar-metadata`,
      headers: { ...authHeader(), 'content-type': 'application/json' },
      payload: {
        storageProvider: 'r2',
        objectKey: 'profiles/users/test/avatar/v1/avatar_128.webp',
        contentType: 'image/webp',
        version: 1,
        size: 4096,
        status: 'active',
      },
    });

    const response = await app.inject({
      method: 'PATCH',
      url: `/internal/users/${userId}/avatar-metadata`,
      headers: { ...authHeader(), 'content-type': 'application/json' },
      payload: {
        storageProvider: null,
        objectKey: null,
        contentType: null,
        version: 2,
        status: 'removed',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().user.avatarStatus).toBe('removed');
    expect(response.json().user.avatarVersion).toBe(2);
  });
});
