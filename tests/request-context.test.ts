import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { TRUSTED_PROXY_HOPS, extractRequestContext } from '../src/security/requestContext.js';

describe('extractRequestContext', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ trustProxy: TRUSTED_PROXY_HOPS });
    app.get('/ctx', async (request) => extractRequestContext(request));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  async function contextFor(forwardedFor?: string) {
    const response = await app.inject({
      method: 'GET',
      url: '/ctx',
      headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {},
    });
    return response.json() as { ip: string; ipHash: string };
  }

  it('usa o endereço que o nginx acrescentou, não o que o cliente mandou', async () => {
    const ctx = await contextFor('6.6.6.6, 203.0.113.9');
    expect(ctx.ip).toBe('203.0.113.9');
  });

  it('header inventado não troca o ipHash do mesmo cliente', async () => {
    const a = await contextFor('10.0.0.1, 203.0.113.9');
    const b = await contextFor('10.9.9.9, 203.0.113.9');
    expect(a.ipHash).toBe(b.ipHash);
  });

  it('sem header cai no endereço do socket', async () => {
    const ctx = await contextFor();
    expect(ctx.ip).toBe('127.0.0.1');
  });
});
