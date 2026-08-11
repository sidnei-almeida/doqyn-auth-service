import 'dotenv/config';
import { prisma } from '../src/db/prisma.js';
import { resetEnvCache, loadEnv } from '../src/config/env.js';
import { decryptField, encryptField, hashLookup } from '../src/security/crypto.js';
import { hashPassword, isArgon2idHash, verifyPassword } from '../src/security/password.js';
import { normalizeEmail } from '../src/utils/normalize.js';

resetEnvCache();
const env = loadEnv();

/** Acumulador do relatório. Declarado por campo para que as leituras posteriores tipem. */
type CryptoReport = {
  env: {
    dataEncryptionKeyLength: number;
    hasPasswordPepper: boolean;
    databaseUrlHost: string;
  };
  fieldEncryption: Record<string, unknown>;
  passwordRoundtrip: Record<string, unknown>;
  databaseUsers: Array<Record<string, unknown>>;
  issues: string[];
  acceptedInvites?: number;
  hint?: string;
};

async function main() {
  const report: CryptoReport = {
    env: {
      dataEncryptionKeyLength: Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64').length,
      hasPasswordPepper: Boolean(env.PASSWORD_PEPPER),
      databaseUrlHost: env.DATABASE_URL.replace(/:[^:@/]+@/, ':***@'),
    },
    fieldEncryption: { ok: false },
    passwordRoundtrip: { ok: false },
    databaseUsers: [] as Array<Record<string, unknown>>,
    issues: [] as string[],
  };

  // 1) DATA_ENCRYPTION_KEY — campos PII (email, nome, whatsapp)
  const sample = 'verificacao@doqyn.dev';
  const encrypted = encryptField(sample);
  const decrypted = decryptField(encrypted);
  report.fieldEncryption = {
    ok: decrypted === sample,
    sampleFormat: encrypted.startsWith('v1:'),
  };
  if (decrypted !== sample) {
    report.issues.push('Falha no roundtrip encryptField/decryptField com a chave atual.');
  }

  // 2) Senha — Argon2 + PASSWORD_PEPPER (NÃO usa DATA_ENCRYPTION_KEY)
  const testPassword = 'senha-teste-123';
  const hash = await hashPassword(testPassword);
  const verified = await verifyPassword(testPassword, hash);
  const wrong = await verifyPassword('senha-errada-123', hash);
  report.passwordRoundtrip = {
    ok: verified && !wrong,
    usesArgon2id: isArgon2idHash(hash),
    note: 'Senha é hasheada com Argon2id + PASSWORD_PEPPER, não criptografada com DATA_ENCRYPTION_KEY.',
  };
  if (!verified || wrong) {
    report.issues.push('Falha no roundtrip hashPassword/verifyPassword com PASSWORD_PEPPER atual.');
  }

  // 3) Usuários reais no banco
  const users = await prisma.authUser.findMany({
    orderBy: { createdAt: 'desc' },
    take: 15,
    include: {
      credential: true,
      memberships: { include: { tenant: true } },
    },
  });

  for (const user of users) {
    let email: string | null = null;
    let emailDecryptOk = false;
    let lookupConsistent = false;

    try {
      email = decryptField(user.emailEncrypted);
      emailDecryptOk = true;
      lookupConsistent = hashLookup(normalizeEmail(email)) === user.emailLookupHash;
    } catch (error) {
      report.issues.push(
        `Não foi possível descriptografar e-mail do usuário ${user.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    let passwordVerifySample: boolean | null = null;
    const hashValue = user.credential?.passwordHash ?? null;
    if (hashValue && !isArgon2idHash(hashValue)) {
      report.issues.push(`Hash de senha inválido (não Argon2id) para usuário ${user.id}.`);
    }

    report.databaseUsers.push({
      id: user.id,
      email,
      emailDecryptOk,
      lookupConsistent,
      hasCredential: Boolean(user.credential),
      passwordHashFormat: hashValue ? (isArgon2idHash(hashValue) ? 'argon2id' : 'invalid') : 'missing',
      createdAt: user.createdAt.toISOString(),
      memberships: user.memberships.map((m) => ({
        status: m.status,
        tenant: m.tenant.tenantId,
      })),
      passwordVerifySample,
    });

    if (!user.credential) {
      report.issues.push(`Usuário ${email ?? user.id} sem registro em auth_credentials (não consegue login por senha).`);
    }
    if (emailDecryptOk && !lookupConsistent) {
      report.issues.push(
        `Lookup hash inconsistente para ${email} — possível LOOKUP_HASH_SECRET diferente do usado no cadastro.`,
      );
    }
  }

  const acceptedInvites = await prisma.authInvite.findMany({
    where: { status: 'accepted' },
    orderBy: { acceptedAt: 'desc' },
    take: 10,
    select: {
      id: true,
      acceptedAt: true,
      acceptedByUserId: true,
      emailLookupHash: true,
    },
  });

  report.acceptedInvites = acceptedInvites.length;

  if (report.databaseUsers.length === 0) {
    report.hint =
      'Banco de dev vazio — normal após limpeza. Crie um convite real ou rode npm run dev:seed:demo.';
  } else if (report.issues.some((issue) => issue.includes('descriptografar'))) {
    report.hint =
      'Usuários com e-mail ilegível foram criados com chaves de TESTE (vitest), não com o .env de dev. Remova-os ou ignore — não servem para login no servidor de dev.';
  }

  console.log(JSON.stringify(report, null, 2));
  await prisma.$disconnect();

  if (report.issues.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
