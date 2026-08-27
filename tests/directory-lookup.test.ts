import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';
import { createTestUser } from './helpers.js';
import { TEST_ENV } from './setup.js';

const INTERNAL = { authorization: `Bearer ${TEST_ENV.DOQYN_INTERNAL_API_KEY}` };

describe('diretório DOQYN — lookup por e-mail exato', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('acha quem existe, e devolve só id e nome de exibição', async () => {
    await createTestUser('diretorio.achado@example.com', 'Senha!12345', {
      firstName: 'Marina',
      lastName: 'Prado',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/internal/users/lookup?email=diretorio.achado@example.com',
      headers: INTERNAL,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.found).toBe(true);
    expect(body.user.displayName).toBe('Marina Prado');
    expect(typeof body.user.id).toBe('string');

    // A projeção é própria, não `toPublicUser`: saber o e-mail não pode virar caminho para o
    // telefone.
    expect(Object.keys(body.user).sort()).toEqual(['displayName', 'id']);
  });

  it('quem não existe e quem está desativado respondem igual', async () => {
    const desativado = await createTestUser('diretorio.desativado@example.com', 'Senha!12345', {
      firstName: 'Rui',
    });
    await prisma.authUser.update({
      where: { id: desativado.id },
      data: { status: 'disabled' },
    });

    const inexistente = await app.inject({
      method: 'GET',
      url: '/internal/users/lookup?email=diretorio.ninguem@example.com',
      headers: INTERNAL,
    });
    const desligado = await app.inject({
      method: 'GET',
      url: '/internal/users/lookup?email=diretorio.desativado@example.com',
      headers: INTERNAL,
    });

    // Mesmo status e mesmo corpo: a diferença entre os dois é justamente o que o oráculo de
    // enumeração procura.
    expect(inexistente.statusCode).toBe(200);
    expect(desligado.statusCode).toBe(inexistente.statusCode);
    expect(desligado.json()).toEqual(inexistente.json());
    expect(inexistente.json()).toEqual({ ok: true, found: false, user: null });
  });

  it('é match exato: prefixo do e-mail não acha ninguém', async () => {
    await createTestUser('diretorio.exato@example.com', 'Senha!12345', { firstName: 'Ana' });

    const response = await app.inject({
      method: 'GET',
      url: '/internal/users/lookup?email=diretorio.exa@example.com',
      headers: INTERNAL,
    });

    expect(response.json().found).toBe(false);
  });

  it('não colide com a rota de id', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/internal/users/lookup?email=nao-importa@example.com',
      headers: INTERNAL,
    });

    // Se `lookup` fosse capturado como `:userId`, a validação de uuid devolveria outro status.
    expect(response.statusCode).toBe(200);
    expect(response.json().ok).toBe(true);
  });

  it('e-mail ausente ou inválido é 400', async () => {
    const vazio = await app.inject({
      method: 'GET',
      url: '/internal/users/lookup',
      headers: INTERNAL,
    });
    const invalido = await app.inject({
      method: 'GET',
      url: '/internal/users/lookup?email=nao-e-email',
      headers: INTERNAL,
    });

    expect(vazio.statusCode).toBe(400);
    expect(invalido.statusCode).toBe(400);
  });

  it('sem a chave interna, não responde', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/internal/users/lookup?email=diretorio.achado@example.com',
    });

    expect(response.statusCode).toBe(403);
  });
});
