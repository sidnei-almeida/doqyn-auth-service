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

  it('o resultado carrega retrato e e-mail, para ser reconhecível', async () => {
    const user = await createTestUser('busca.retrato@example.com', 'Senha!12345', {
      firstName: 'Vera',
      lastName: 'Matos',
    });
    await prisma.authUser.update({
      where: { id: user.id },
      data: { username: 'vera.matos', avatarVersion: 3, avatarStatus: 'active' },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/internal/users/search?q=vera.matos',
      headers: INTERNAL,
    });

    // Dois `vera.m` não se distinguem por handle nenhum: sem e-mail e retrato, escolher é chutar.
    const [hit] = response.json().users;
    expect(hit).toMatchObject({
      username: 'vera.matos',
      displayName: 'Vera Matos',
      email: 'busca.retrato@example.com',
      avatarVersion: 3,
      avatarStatus: 'active',
    });
  });

  it('quem se retirou do diretório não entrega e-mail nenhum', async () => {
    const user = await createTestUser('busca.retirada@example.com', 'Senha!12345', {
      firstName: 'Ivo',
      lastName: 'Salles',
    });
    await prisma.authUser.update({
      where: { id: user.id },
      data: { username: 'ivo.salles', usernameDiscoverable: false },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/internal/users/search?q=ivo.salles',
      headers: INTERNAL,
    });

    // O filtro vem antes da projeção: enriquecer o resultado não pode furar quem se escondeu.
    expect(response.json().users).toEqual([]);
  });

  it('o índice único é a última palavra sobre handle repetido', async () => {
    const primeiro = await createTestUser('handle.unico.a@example.com', 'Senha!12345', {
      firstName: 'Nara',
      lastName: 'Diniz',
    });
    const segundo = await createTestUser('handle.unico.b@example.com', 'Senha!12345', {
      firstName: 'Noel',
      lastName: 'Dias',
    });

    await prisma.authUser.update({ where: { id: primeiro.id }, data: { username: 'nara.diniz' } });

    // Nem que o caminho de escrita erre: o banco recusa o segundo.
    await expect(
      prisma.authUser.update({ where: { id: segundo.id }, data: { username: 'nara.diniz' } }),
    ).rejects.toThrow();
  });

  it('devolve apelido por lote, para quem já sabe os ids', async () => {
    const a = await createTestUser('lote.um@example.com', 'Senha!12345', {
      firstName: 'Olga',
      lastName: 'Reis',
    });
    const b = await createTestUser('lote.dois@example.com', 'Senha!12345', {
      firstName: 'Ivan',
      lastName: 'Serra',
    });
    await prisma.authUser.update({ where: { id: a.id }, data: { username: 'olga.reis' } });
    await prisma.authUser.update({
      where: { id: b.id },
      // Retirado do diretório, e ainda assim rotulável: `usernameDiscoverable` decide quem aparece
      // numa busca, não se quem já foi encontrado tem nome.
      data: { username: 'ivan.serra', usernameDiscoverable: false },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/internal/users/usernames',
      headers: INTERNAL,
      payload: { userIds: [a.id, b.id, 'id-que-nao-existe'] },
    });

    expect(response.statusCode).toBe(200);
    const handles = response.json().users.map((u: { username: string }) => u.username);
    expect(handles.sort()).toEqual(['ivan.serra', 'olga.reis']);
  });

  it('não é caminho de descoberta: sem ids, sem resposta', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/users/usernames',
      headers: INTERNAL,
      payload: { userIds: [] },
    });

    // Lista vazia devolve vazio em vez de "todos": o contrário faria da rota um despejo do
    // cadastro para quem tem a chave interna e nenhum id.
    expect(response.json().users).toEqual([]);
  });

  it('a busca entrega mais que o lookup por e-mail, e é de propósito', async () => {
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

    // Quem busca por prefixo precisa reconhecer quem achou, então recebe e-mail e retrato — o
    // lookup por e-mail exato continua devolvendo só id, handle e nome, porque lá quem pergunta
    // já sabe com quem quer falar.
    const [hit] = response.json().users;
    expect(Object.keys(hit).sort()).toEqual([
      'avatarStatus',
      'avatarVersion',
      'displayName',
      'email',
      'id',
      'username',
    ]);
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
