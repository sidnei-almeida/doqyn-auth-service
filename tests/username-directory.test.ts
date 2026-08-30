import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

  it('e-mail reservado não vira handle reservado', async () => {
    const { claimUsername } = await import('../src/modules/users/users.service.js');

    // `suporte@empresa.com` derivava `suporte`, a validação recusava, e a queda recalculava a
    // mesma string — entregando `@suporte` a quem se cadastrasse com aquele endereço. Um
    // documento vindo de "suporte" parece vir do DOQYN, que é o phishing que a lista impede.
    for (const email of ['suporte@empresa.com', 'admin@x.com', 'api@y.com']) {
      const handle = await claimUsername(prisma, undefined, email);
      expect(validateUsernameShape(handle)).toBeNull();
    }
  });

  it('o handle escolhido reservado também cai em algo válido', async () => {
    const { claimUsername } = await import('../src/modules/users/users.service.js');

    const handle = await claimUsername(prisma, 'suporte', 'pessoa.comum@example.com');
    expect(validateUsernameShape(handle)).toBeNull();
  });

  it('curinga de LIKE no prefixo não devolve o cadastro', async () => {
    const alvo = await createTestUser('curinga.alvo@example.com', 'Senha!12345', {
      firstName: 'Nina',
      lastName: 'Prado',
    });
    await prisma.authUser.update({ where: { id: alvo.id }, data: { username: 'nina.prado' } });

    // `_` é caractere válido de handle **e** curinga de um caractere no `LIKE`. Sobrevivia à
    // normalização e casava qualquer coisa: `__` passava pela trava de dois caracteres e
    // devolvia contas quaisquer, com e-mail.
    for (const q of ['__', '%a', '%%']) {
      const response = await app.inject({
        method: 'GET',
        url: `/internal/users/search?q=${encodeURIComponent(q)}`,
        headers: INTERNAL,
      });
      expect(response.json().users).toEqual([]);
    }
  });

  it('sublinhado de verdade continua achando quem o tem no apelido', async () => {
    const user = await createTestUser('sublinhado@example.com', 'Senha!12345', {
      firstName: 'Caio',
      lastName: 'Melo',
    });
    await prisma.authUser.update({ where: { id: user.id }, data: { username: 'caio_melo' } });

    // Escapar não pode custar a busca legítima: quem tem `_` no handle continua sendo achado
    // por ele, e só por ele.
    const achado = await app.inject({
      method: 'GET',
      url: '/internal/users/search?q=caio_',
      headers: INTERNAL,
    });
    expect(achado.json().users.map((u: { username: string }) => u.username)).toEqual(['caio_melo']);

    // E o curinga não vale como atalho para o mesmo alvo.
    const curinga = await app.inject({
      method: 'GET',
      url: '/internal/users/search?q=caio%5F'.replace('%5F', '_') + 'x',
      headers: INTERNAL,
    });
    expect(curinga.json().users).toEqual([]);
  });

  it('a pessoa vê o próprio apelido e consegue sair da busca', async () => {
    const user = await createTestUser('visibilidade@example.com', 'Senha!12345', {
      firstName: 'Olívia',
      lastName: 'Braga',
    });
    await prisma.authUser.update({ where: { id: user.id }, data: { username: 'olivia.braga' } });

    const { toPublicUser, setUsernameDiscoverable } =
      await import('../src/modules/users/users.service.js');

    // O handle é escolhido no cadastro mas pode sair com sufixo quando colide. Não mostrá-lo
    // deixava alguém sendo procurado por um nome que nunca soube que tinha.
    const atual = await prisma.authUser.findUniqueOrThrow({ where: { id: user.id } });
    expect(toPublicUser(atual)).toMatchObject({
      username: 'olivia.braga',
      usernameDiscoverable: true,
    });

    const saiu = await setUsernameDiscoverable(user.id, false);
    expect(saiu.usernameDiscoverable).toBe(false);

    // Sair da busca não apaga o handle: ele é a identidade de quem já a encontrou antes.
    expect(saiu.username).toBe('olivia.braga');

    const busca = await app.inject({
      method: 'GET',
      url: '/internal/users/search?q=olivia',
      headers: INTERNAL,
    });
    expect(busca.json().users).toEqual([]);

    // E voltar é o mesmo caminho, sem recuperar handle nenhum porque nada se perdeu.
    const voltou = await setUsernameDiscoverable(user.id, true);
    expect(voltou.usernameDiscoverable).toBe(true);
  });

  it('todo caminho de entrada nasce com apelido', () => {
    const oauth = readFileSync(
      resolve(process.cwd(), 'src/modules/oauth/oauth.accounts.service.ts'),
      'utf8',
    );
    const invites = readFileSync(
      resolve(process.cwd(), 'src/modules/invites/invites.service.ts'),
      'utf8',
    );

    // Entrar pelo Google e aceitar convite não passam por formulário de cadastro, então nenhum
    // dos dois escolhia apelido — e a conta nascia fora do diretório para sempre, porque não há
    // tela de trocar handle depois.
    expect(oauth).toContain('claimUsername(tx, undefined, normalizedEmail)');
    expect(invites).toContain('claimUsername(tx, undefined, email)');
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
