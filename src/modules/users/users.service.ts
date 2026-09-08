import type { AuthUser, AuthUserStatus } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { decryptField, encryptField, hashLookup } from '../../security/crypto.js';
import { hashPassword } from '../../security/password.js';
import { normalizeEmail, normalizePhone } from '../../utils/normalize.js';
import { normalizeUsername, suggestUsernameFromEmail, validateUsernameShape } from './username.js';
import type { PublicUser } from './users.schemas.js';

export function toPublicUser(user: AuthUser): PublicUser {
  return {
    id: user.id,
    email: decryptField(user.emailEncrypted),
    firstName: user.firstNameEncrypted ? decryptField(user.firstNameEncrypted) : null,
    lastName: user.lastNameEncrypted ? decryptField(user.lastNameEncrypted) : null,
    whatsapp: user.whatsappEncrypted ? decryptField(user.whatsappEncrypted) : null,
    status: user.status,
    emailVerified: user.emailVerified,
    ...(user.lastLoginAt ? { lastLoginAt: user.lastLoginAt.toISOString() } : {}),
    avatarVersion: user.avatarVersion ?? 0,
    ...(user.avatarUpdatedAt ? { avatarUpdatedAt: user.avatarUpdatedAt.toISOString() } : {}),
    avatarStatus:
      user.avatarStatus === 'active' || user.avatarStatus === 'removed' ? user.avatarStatus : null,
    username: user.username ?? null,
    usernameDiscoverable: user.usernameDiscoverable,
    locale: user.locale,
    timeZone: user.timeZone ?? null,
  };
}

/**
 * Entrar ou sair da busca entre empresas.
 *
 * A coluna nascia `true` e não havia como desligá-la: quem ganhou handle foi inscrito num
 * diretório sem ter dito que queria. Ter identificador e estar num diretório são coisas
 * diferentes, e esta é a única que a pessoa decide.
 *
 * Sair não apaga o handle. Ele continua sendo a identidade de quem já a encontrou antes, e
 * apagá-lo quebraria os envios em curso — o que muda é só aparecer ou não numa busca nova.
 */
export async function setUsernameDiscoverable(
  userId: string,
  discoverable: boolean,
): Promise<PublicUser> {
  const updated = await prisma.authUser.update({
    where: { id: userId },
    data: { usernameDiscoverable: discoverable },
  });

  return toPublicUser(updated);
}

export interface CreateUserInput {
  email: string;
  firstName?: string;
  lastName?: string;
  whatsapp?: string;
  temporaryPassword?: string;
  /** O apelido escolhido no cadastro. Ausente, um é derivado do e-mail. */
  username?: string;
  /** Padrão `true` — ver o comentário em `createOrGetUser`. Explícito só para testes. */
  emailVerified?: boolean;
}

export async function findUserByEmailLookup(email: string): Promise<AuthUser | null> {
  const normalized = normalizeEmail(email);
  const emailLookupHash = hashLookup(normalized);
  return prisma.authUser.findUnique({ where: { emailLookupHash } });
}

export async function findUserById(id: string): Promise<AuthUser | null> {
  return prisma.authUser.findUnique({ where: { id } });
}

/**
 * Garante que toda conta nasça com apelido, escolhido ou derivado.
 *
 * Ninguém pode ficar sem: o apelido é o identificador estável do diretório, e uma conta sem ele
 * seria invisível para sempre à busca — inclusive para quem quisesse ser achado depois.
 *
 * Colidir é normal, e não é erro de quem cadastra: duas empresas têm o seu `financeiro`. O sufixo
 * numérico resolve na hora, e o handle continua trocável.
 */
export async function claimUsername(
  tx: Pick<typeof prisma, 'authUser'>,
  chosen: string | undefined,
  email: string,
): Promise<string> {
  const desired = chosen?.trim() ? normalizeUsername(chosen) : suggestUsernameFromEmail(email);

  /**
   * A queda para o e-mail não resolve quando é o próprio e-mail que é reservado.
   *
   * `suporte@empresa.com` derivava `suporte`, a validação recusava, e a "queda" recalculava a
   * mesma string — devolvendo o handle `@suporte` a quem se cadastrasse com aquele endereço.
   * É exatamente o phishing que a lista de reservados existe para impedir: quem recebe um
   * documento de "suporte" supõe que veio do DOQYN.
   *
   * O prefixo é a saída, e não um sufixo numérico: `suporte2` continua lendo como suporte.
   */
  const fromEmail = suggestUsernameFromEmail(email);
  const fallback = validateUsernameShape(fromEmail) ? `user.${fromEmail}`.slice(0, 32) : fromEmail;

  const base = validateUsernameShape(desired) ? fallback : desired;

  /**
   * Conferir e inserir não é atômico, e o índice único é quem decide de verdade.
   *
   * Dois cadastros simultâneos de `joao.silva@…` veem o handle livre ao mesmo tempo; o segundo
   * `create` bate no `auth_users_username_key` e derruba o cadastro inteiro com P2002, quando o
   * certo era ele sair como `joao.silva2`. Quem chama trata a violação chamando de novo — o laço
   * abaixo já entrega o próximo livre.
   */
  const free = await tx.authUser.findUnique({ where: { username: base } });
  if (!free) return base;

  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base.slice(0, 28)}${suffix}`;
    const busy = await tx.authUser.findUnique({ where: { username: candidate } });
    if (!busy) return candidate;
  }

  // Mil colisões no mesmo prefixo não acontece por acaso; falhar aqui é melhor que gravar lixo.
  throw new Error(`sem apelido livre para "${base}"`);
}

export async function createOrGetUser(input: CreateUserInput): Promise<PublicUser> {
  const normalizedEmail = normalizeEmail(input.email);
  const emailLookupHash = hashLookup(normalizedEmail);

  const existing = await prisma.authUser.findUnique({ where: { emailLookupHash } });
  if (existing) {
    return toPublicUser(existing);
  }

  const whatsappNormalized = input.whatsapp ? normalizePhone(input.whatsapp) : null;

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.authUser.create({
      data: {
        emailEncrypted: encryptField(normalizedEmail),
        emailLookupHash,
        firstNameEncrypted: input.firstName ? encryptField(input.firstName) : null,
        lastNameEncrypted: input.lastName ? encryptField(input.lastName) : null,
        whatsappEncrypted: whatsappNormalized ? encryptField(whatsappNormalized) : null,
        whatsappLookupHash: whatsappNormalized ? hashLookup(whatsappNormalized) : null,
        username: await claimUsername(tx, input.username, normalizedEmail),
        status: 'active',
        // Nasce confirmada, e a fronteira de confiança aqui é outra: esta função só é alcançável
        // por `/internal/users`, atrás da chave interna — quem chama é a plataforma nomeando o
        // endereço, não um formulário público onde qualquer um digita o e-mail de terceiro. É
        // esse formulário que a verificação por código fecha.
        emailVerified: input.emailVerified ?? true,
      },
    });

    if (input.temporaryPassword) {
      const passwordHash = await hashPassword(input.temporaryPassword);
      await tx.authCredential.create({
        data: {
          userId: created.id,
          passwordHash,
        },
      });
    }

    return created;
  });

  return toPublicUser(user);
}

export async function disableUser(userId: string): Promise<PublicUser> {
  const user = await prisma.authUser.update({
    where: { id: userId },
    data: { status: 'disabled' },
  });
  return toPublicUser(user);
}

export async function enableUser(userId: string): Promise<PublicUser> {
  const user = await prisma.authUser.update({
    where: { id: userId },
    data: { status: 'active' },
  });
  return toPublicUser(user);
}

export async function updateUserPassword(userId: string, newPassword: string): Promise<void> {
  const passwordHash = await hashPassword(newPassword);
  await prisma.authCredential.upsert({
    where: { userId },
    create: {
      userId,
      passwordHash,
    },
    update: {
      passwordHash,
      passwordUpdatedAt: new Date(),
    },
  });
}

export async function getUserCredential(userId: string) {
  return prisma.authCredential.findUnique({ where: { userId } });
}

export async function updateUserEmail(userId: string, email: string): Promise<PublicUser> {
  const normalized = normalizeEmail(email);
  const emailLookupHash = hashLookup(normalized);

  const user = await prisma.authUser.update({
    where: { id: userId },
    data: {
      emailEncrypted: encryptField(normalized),
      emailLookupHash,
      emailVerified: true,
    },
  });

  return toPublicUser(user);
}

/**
 * Quem entrou por Google ou Microsoft não precisa confirmar de novo.
 *
 * A checagem é pelo vínculo, e não pela claim `emailVerified` da identidade, de propósito: o
 * Entra só afirma o endereço com a claim opcional `xms_edov`, que nem todo app registration tem
 * habilitada. Exigir a claim trancaria fora do app quem entra por conta corporativa da Microsoft
 * — um login que funciona hoje. Ter um provedor ligado é a prova aceita aqui.
 */
export async function hasLinkedOAuthAccount(userId: string): Promise<boolean> {
  const count = await prisma.authOAuthAccount.count({ where: { userId } });
  return count > 0;
}

export function isUserLoginAllowed(status: AuthUserStatus): boolean {
  return status === 'active' || status === 'pending_verification';
}

export type UpdateUserAvatarMetadataInput = {
  storageProvider?: 'r2' | 'local' | null;
  objectKey?: string | null;
  contentType?: string | null;
  version: number;
  size?: number | null;
  status: 'active' | 'removed';
};

export async function updateUserAvatarMetadata(
  userId: string,
  input: UpdateUserAvatarMetadataInput,
): Promise<PublicUser> {
  const user = await prisma.authUser.update({
    where: { id: userId },
    data: {
      avatarStorageProvider: input.storageProvider ?? null,
      avatarObjectKey: input.objectKey ?? null,
      avatarContentType: input.contentType ?? null,
      avatarVersion: input.version,
      avatarUpdatedAt: new Date(),
      avatarSize: input.size ?? null,
      avatarStatus: input.status,
    },
  });

  return toPublicUser(user);
}

export async function getUserAvatarMetadata(userId: string): Promise<{
  storageProvider: string | null;
  objectKey: string | null;
  contentType: string | null;
  version: number;
  status: string | null;
} | null> {
  const user = await prisma.authUser.findUnique({
    where: { id: userId },
    select: {
      avatarStorageProvider: true,
      avatarObjectKey: true,
      avatarContentType: true,
      avatarVersion: true,
      avatarStatus: true,
    },
  });

  if (!user) return null;

  return {
    storageProvider: user.avatarStorageProvider,
    objectKey: user.avatarObjectKey,
    contentType: user.avatarContentType,
    version: user.avatarVersion ?? 0,
    status: user.avatarStatus,
  };
}

/**
 * Busca por prefixo de handle, entre empresas.
 *
 * É o **único** caminho de busca digitável que o schema permite: nome está cifrado e e-mail só tem
 * hash determinístico, e nenhum dos dois responde prefixo. O handle existe exatamente para isto.
 *
 * `usernameDiscoverable` é a linha entre ter identificador e estar num diretório. Quem se retirou
 * some da busca sem perder o handle — e some do mesmo jeito que quem não existe, porque uma
 * resposta diferente contaria que ele existe.
 */
export async function searchUsersByUsernamePrefix(
  prefix: string,
  limit = 8,
): Promise<
  Array<{
    id: string;
    username: string;
    displayName: string;
    email: string;
    avatarVersion: number;
    avatarStatus: 'active' | 'removed' | null;
  }>
> {
  /**
   * O prefixo é normalizado **e** escapado, e as duas coisas são necessárias.
   *
   * Normalizar tira o que não pode existir num handle, `%` inclusive. Mas `_` é caractere válido
   * de handle e é curinga de `LIKE`, então sobreviveria à normalização e continuaria casando
   * qualquer caractere: buscar `__` devolvia oito contas quaisquer, com e-mail, passando pela
   * trava de dois caracteres que existe justamente contra isso.
   *
   * O Postgres usa a barra invertida como escape padrão de `LIKE`, então escapar aqui basta —
   * o `startsWith` do Prisma monta `LIKE $1 || '%'` sem cláusula `ESCAPE` própria.
   */
  const normalized = normalizeUsername(prefix);
  if (normalized.length < 2) return [];

  const pattern = normalized.replace(/[\\_%]/g, (char) => `\\${char}`);

  const users = await prisma.authUser.findMany({
    where: {
      username: { startsWith: pattern },
      usernameDiscoverable: true,
      status: 'active',
    },
    select: {
      id: true,
      username: true,
      firstNameEncrypted: true,
      lastNameEncrypted: true,
      emailEncrypted: true,
      avatarVersion: true,
      avatarStatus: true,
    },
    orderBy: { username: 'asc' },
    take: Math.min(Math.max(limit, 1), 20),
  });

  return users.map((user) => ({
    id: user.id,
    username: user.username ?? '',
    // O e-mail e o retrato vão junto porque o resultado precisa ser reconhecível: dois `camila.o`
    // não se distinguem por handle nenhum. É uma troca deliberada — quem varre prefixos passa a
    // colher endereços — e está registrada em `REQUISICAO-E-INTERTENANT-PLANO.md`.
    email: decryptField(user.emailEncrypted),
    avatarVersion: user.avatarVersion ?? 0,
    avatarStatus:
      user.avatarStatus === 'active' || user.avatarStatus === 'removed' ? user.avatarStatus : null,
    // O nome de exibição só é decifrado **depois** do filtro: o que decide quem aparece é o
    // handle, e nunca o campo cifrado.
    displayName: [
      user.firstNameEncrypted ? decryptField(user.firstNameEncrypted) : '',
      user.lastNameEncrypted ? decryptField(user.lastNameEncrypted) : '',
    ]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(' '),
  }));
}

/**
 * Apelido e nome de exibição de um punhado de contas, por id.
 *
 * Existe porque o app não guarda o handle: ele é coluna do auth-service, e o cadastro que o app
 * mantém por tenant tem um campo `username` que é **e-mail** de um esquema anterior. Sem esta
 * rota, a única saída era exibir aquele campo — que mostra `@fulano@empresa.com` no lugar do
 * apelido — ou não exibir apelido nenhum.
 *
 * Não é caminho de descoberta: quem chama já tem os ids, e só recebe o rótulo público de contas
 * que já conhece. Por isso não há filtro por `usernameDiscoverable` aqui — ele decide quem aparece
 * numa **busca**, e não se quem já foi encontrado tem nome.
 */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listUsernamesByIds(
  ids: string[],
): Promise<Array<{ id: string; username: string; displayName: string }>> {
  /**
   * A forma do id é conferida aqui, e não é zelo: a coluna é `uuid` no Postgres, e um id
   * malformado no meio da lista não devolve "esse não existe" — derruba a consulta inteira com
   * erro de tipo, levando junto os ids válidos que vieram com ele.
   */
  const unique = [...new Set(ids.map((id) => id.trim()).filter((id) => UUID_SHAPE.test(id)))].slice(
    0,
    200,
  );
  if (!unique.length) return [];

  const users = await prisma.authUser.findMany({
    where: { id: { in: unique } },
    select: { id: true, username: true, firstNameEncrypted: true, lastNameEncrypted: true },
  });

  return users
    .filter((user) => user.username)
    .map((user) => ({
      id: user.id,
      username: user.username ?? '',
      displayName: [
        user.firstNameEncrypted ? decryptField(user.firstNameEncrypted) : '',
        user.lastNameEncrypted ? decryptField(user.lastNameEncrypted) : '',
      ]
        .map((part) => part.trim())
        .filter(Boolean)
        .join(' '),
    }));
}

/** O handle está livre? Reservado e formato inválido contam como ocupado para quem escolhe. */
export async function isUsernameAvailable(username: string): Promise<boolean> {
  const existing = await prisma.authUser.findUnique({ where: { username } });
  return !existing;
}
