import { describe, it, expect } from 'vitest';
import { prisma } from '../src/db/prisma.js';
import { hashLookup } from '../src/security/crypto.js';
import { normalizeEmail, normalizePhone } from '../src/utils/normalize.js';
import { createOrGetUser, findUserByEmailLookup } from '../src/modules/users/users.service.js';

describe('users', () => {
  it('criar usuário interno', async () => {
    const user = await createOrGetUser({
      email: 'usuario@empresa.com',
      firstName: 'Nome',
      lastName: 'Sobrenome',
      whatsapp: '+5554999999999',
      temporaryPassword: 'senha-segura-123',
    });

    expect(user.id).toBeDefined();
    expect(user.email).toBe('usuario@empresa.com');
    expect(user.firstName).toBe('Nome');
    expect(user.lastName).toBe('Sobrenome');
    expect(user.whatsapp).toBe('+5554999999999');
  });

  it('não duplicar usuário por e-mail', async () => {
    const first = await createOrGetUser({
      email: 'Usuario@Empresa.COM',
      temporaryPassword: 'senha-segura-123',
    });
    const second = await createOrGetUser({
      email: 'usuario@empresa.com',
      temporaryPassword: 'outra-senha-123',
    });

    expect(second.id).toBe(first.id);
    const count = await prisma.authUser.count();
    expect(count).toBe(1);
  });

  it('usuário pode ser buscado por emailLookupHash', async () => {
    await createOrGetUser({
      email: 'busca@empresa.com',
      temporaryPassword: 'senha-segura-123',
    });

    const user = await findUserByEmailLookup('busca@empresa.com');
    expect(user).not.toBeNull();
    expect(user?.emailLookupHash).toBe(hashLookup(normalizeEmail('busca@empresa.com')));
  });

  it('e-mail não aparece em texto puro no banco', async () => {
    const email = 'puro@empresa.com';
    await createOrGetUser({
      email,
      temporaryPassword: 'senha-segura-123',
    });

    const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT * FROM auth_users WHERE email_lookup_hash = ${hashLookup(normalizeEmail(email))}
    `;

    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain(email);
    expect(rows[0]?.email_encrypted).toBeDefined();
  });

  it('WhatsApp não aparece em texto puro no banco', async () => {
    const whatsapp = '+5554987654321';
    await createOrGetUser({
      email: 'whatsapp@empresa.com',
      whatsapp,
      temporaryPassword: 'senha-segura-123',
    });

    const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT * FROM auth_users WHERE email_lookup_hash = ${hashLookup(normalizeEmail('whatsapp@empresa.com'))}
    `;

    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain(normalizePhone(whatsapp));
    expect(rows[0]?.whatsapp_encrypted).toBeDefined();
  });
});
