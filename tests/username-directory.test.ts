import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';
import { createTestUser } from './helpers.js';
import { TEST_ENV } from './setup.js';
import {
  normalizeUsername,
  suggestUsernameFromEmail,
  validateUsernameShape,
} from '../src/modules/users/username.js';
import { resetRateLimitStore } from '../src/security/rateLimit.js';

const INTERNAL = { authorization: `Bearer ${TEST_ENV.DOQYN_INTERNAL_API_KEY}` };

describe('apelido — a única coluna de identidade em texto claro', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('normaliza para uma forma só', () => {
    // Maiúscula e acento criariam dois caminhos para a mesma pessoa, disputando o mesmo índice.
    expect(normalizeUsername('  João.Silva ')).toBe('joao.silva');
    expect(normalizeUsername('Ana#Costa!')).toBe('anacosta');
  });

  it('recusa o que vira rota ou promete autoridade', () => {
    // Um handle `suporte` é phishing pronto: quem recebe supõe que veio do DOQYN.
    expect(validateUsernameShape('suporte')).toBe('reserved');
    expect(validateUsernameShape('admin')).toBe('reserved');
    expect(validateUsernameShape('ab')).toBe('too_short');
    expect(validateUsernameShape('.joao')).toBe('invalid_shape');
    expect(validateUsernameShape('joao.silva')).toBeNull();
  });

  it('deriva do e-mail para quem já existia', () => {
    expect(suggestUsernameFromEmail('bruno.costa@horizonte-log.dev')).toBe('bruno.costa');
  });

  it('acha por prefixo, e só quem quer ser achado', async () => {
    const achavel = await createTestUser('busca.achavel@example.com', 'Senha!12345', {
      firstName: 'Marina',
      lastName: 'Prado',
    });
    const escondida = await createTestUser('busca.escondida@example.com', 'Senha!12345', {
      firstName: 'Rui',
      lastName: 'Alves',
    });

    await prisma.authUser.update({
      where: { id: achavel.id },
      data: { username: 'marina.prado' },
    });
    await prisma.authUser.update({
      where: { id: escondida.id },
      data: { username: 'marina.oculta', usernameDiscoverable: false },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/internal/users/search?q=marina',
      headers: INTERNAL,
    });

    expect(response.statusCode).toBe(200);
    const nomes = response.json().users.map((u: { username: string }) => u.username);
    expect(nomes).toContain('marina.prado');
    // Quem se retirou some do mesmo jeito que quem não existe.
    expect(nomes).not.toContain('marina.oculta');
  });

  it('prefixo de uma letra não devolve o diretório', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/internal/users/search?q=m',
      headers: INTERNAL,
    });

    // Uma letra por chamada enumeraria o cadastro inteiro em poucas dezenas de requisições.
    expect(response.json().users).toEqual([]);
  });

  it('a projeção é a mesma do lookup por e-mail', async () => {
    // Autônomo de propósito: cada teste roda com o banco limpo, e depender do anterior faria a
    // suíte passar ou falhar conforme a ordem.
    const user = await createTestUser('busca.projecao@example.com', 'Senha!12345', {
      firstName: 'Clara',
      lastName: 'Nunes',
    });
    await prisma.authUser.update({ where: { id: user.id }, data: { username: 'clara.nunes' } });

    const response = await app.inject({
      method: 'GET',
      url: '/internal/users/search?q=clara.nunes',
      headers: INTERNAL,
    });

    // Quem acha pela busca não pode receber mais do que quem já sabia o e-mail.
    const [hit] = response.json().users;
    expect(Object.keys(hit).sort()).toEqual(['displayName', 'id', 'username']);
  });

  it('diz que o handle livre está livre, sem pedir sessão', async () => {
    resetRateLimitStore();

    const response = await app.inject({
      method: 'GET',
      url: '/auth/username-available?username=handle.inedito',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ username: 'handle.inedito', available: true });
  });

  it('normaliza antes de responder, e devolve a forma conferida', async () => {
    resetRateLimitStore();

    const response = await app.inject({
      method: 'GET',
      url: `/auth/username-available?username=${encodeURIComponent('  João.Silva ')}`,
    });

    // Sem isso, quem digita com acento recebe "livre" e depois é salvo com outro handle.
    expect(response.json().username).toBe('joao.silva');
  });

  it('o ocupado, o reservado e o malformado são a mesma recusa para quem escolhe', async () => {
    resetRateLimitStore();
    const user = await createTestUser('handle.ocupado@example.com', 'Senha!12345', {
      firstName: 'Tereza',
      lastName: 'Lima',
    });
    await prisma.authUser.update({ where: { id: user.id }, data: { username: 'tereza.lima' } });

    const casos: Array<[string, string]> = [
      ['tereza.lima', 'taken'],
      ['suporte', 'reserved'],
      ['ab', 'too_short'],
      ['.joao', 'invalid_shape'],
    ];

    for (const [username, reason] of casos) {
      const response = await app.inject({
        method: 'GET',
        url: `/auth/username-available?username=${encodeURIComponent(username)}`,
      });
      expect(response.json()).toMatchObject({ available: false, reason });
    }
  });

  it('tem teto por IP, porque a rota é pública e não precisa ser concluída', async () => {
    resetRateLimitStore();

    // O teto de cadastro não cobriria: ele só é consumido no POST, e esta é uma consulta GET.
    for (let i = 0; i < 60; i += 1) {
      const ok = await app.inject({
        method: 'GET',
        url: `/auth/username-available?username=handle.teto${i}`,
      });
      expect(ok.statusCode).toBe(200);
    }

    const barrada = await app.inject({
      method: 'GET',
      url: '/auth/username-available?username=handle.teto.extra',
    });
    expect(barrada.statusCode).toBe(429);
  });
});
