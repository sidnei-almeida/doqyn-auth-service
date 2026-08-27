#!/usr/bin/env tsx
/**
 * Dá handle a quem já existia antes da coluna.
 *
 * O palpite sai da parte local do e-mail, que é o mais próximo do que a pessoa escolheria. Colidir
 * é normal — duas empresas têm o seu `financeiro` — e o sufixo numérico resolve sem pedir nada a
 * ninguém. O handle continua trocável depois.
 *
 * Idempotente: quem já tem handle não é tocado.
 *
 *   npx tsx scripts/backfill-usernames.ts            (simula)
 *   npx tsx scripts/backfill-usernames.ts --apply    (grava)
 */
import { prisma } from '../src/db/prisma.js';
import { decryptField } from '../src/security/crypto.js';
import { suggestUsernameFromEmail, validateUsernameShape } from '../src/modules/users/username.js';

async function claim(base: string, taken: Set<string>): Promise<string> {
  if (!validateUsernameShape(base) && !taken.has(base)) {
    const free = await prisma.authUser.findUnique({ where: { username: base } });
    if (!free) {
      taken.add(base);
      return base;
    }
  }

  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base.slice(0, 28)}${suffix}`;
    if (taken.has(candidate)) continue;
    const busy = await prisma.authUser.findUnique({ where: { username: candidate } });
    if (!busy) {
      taken.add(candidate);
      return candidate;
    }
  }

  throw new Error(`sem handle livre para "${base}"`);
}

async function main() {
  const apply = process.argv.includes('--apply');
  const users = await prisma.authUser.findMany({
    where: { username: null },
    select: { id: true, emailEncrypted: true },
  });

  const taken = new Set<string>();
  let done = 0;

  for (const user of users) {
    let email: string;
    try {
      email = decryptField(user.emailEncrypted);
    } catch {
      console.warn('e-mail ilegível, pulando:', user.id);
      continue;
    }

    const username = await claim(suggestUsernameFromEmail(email), taken);

    if (apply) {
      await prisma.authUser.update({ where: { id: user.id }, data: { username } });
    }
    console.log(`${email} → @${username}`);
    done += 1;
  }

  console.log(`\n${done} handle(s) ${apply ? 'gravados' : 'simulados (use --apply para gravar)'}`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('ERRO:', error instanceof Error ? error.message : error);
  process.exit(1);
});
