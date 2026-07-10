/**
 * Simula o fluxo de senha do aceite de convite usando as chaves do .env de dev
 * e valida login via API em execução.
 */
import 'dotenv/config';
import { prisma } from '../src/db/prisma.js';
import { resetEnvCache } from '../src/config/env.js';
import { decryptField, encryptField, hashLookup } from '../src/security/crypto.js';
import { hashPassword, verifyPassword } from '../src/security/password.js';
import { normalizeEmail } from '../src/utils/normalize.js';

resetEnvCache();

const TEST_EMAIL = 'crypto-check-invite@doqyn.dev';
const TEST_PASSWORD = 'senha-segura-123';

async function cleanup(email: string) {
  const hash = hashLookup(normalizeEmail(email));
  const user = await prisma.authUser.findUnique({ where: { emailLookupHash: hash } });
  if (!user) return;
  await prisma.authCredential.deleteMany({ where: { userId: user.id } });
  await prisma.authMembership.deleteMany({ where: { userId: user.id } });
  await prisma.authUser.delete({ where: { id: user.id } });
}

async function main() {
  await cleanup(TEST_EMAIL);

  const email = normalizeEmail(TEST_EMAIL);
  const passwordHash = await hashPassword(TEST_PASSWORD);

  const user = await prisma.authUser.create({
    data: {
      emailEncrypted: encryptField(email),
      emailLookupHash: hashLookup(email),
      firstNameEncrypted: encryptField('Crypto'),
      lastNameEncrypted: encryptField('Check'),
      status: 'active',
    },
  });

  await prisma.authCredential.create({
    data: { userId: user.id, passwordHash },
  });

  const decryptedEmail = decryptField(user.emailEncrypted);
  const localVerify = await verifyPassword(TEST_PASSWORD, passwordHash);

  const loginResponse = await fetch('http://127.0.0.1:4100/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    return { unavailable: true as const, message };
  });

  if ('unavailable' in loginResponse) {
    console.log(
      JSON.stringify(
        {
          fieldEncryption: { emailRoundtripOk: decryptedEmail === email },
          password: { localVerifyOk: localVerify },
          apiLogin: {
            skipped: true,
            reason: 'Auth-service não está rodando em http://127.0.0.1:4100',
            hint: 'Execute npm run dev em outro terminal e rode este script novamente.',
            error: loginResponse.message,
          },
          overallOk: decryptedEmail === email && localVerify,
        },
        null,
        2,
      ),
    );
    await cleanup(TEST_EMAIL);
    await prisma.$disconnect();
    return;
  }

  const loginBody = await loginResponse.json().catch(() => ({}));

  console.log(
    JSON.stringify(
      {
        fieldEncryption: {
          emailRoundtripOk: decryptedEmail === email,
        },
        password: {
          localVerifyOk: localVerify,
          note: 'Senha usa Argon2id + PASSWORD_PEPPER, não DATA_ENCRYPTION_KEY',
        },
        apiLogin: {
          status: loginResponse.status,
          ok: loginBody?.ok ?? loginResponse.ok,
          code: loginBody?.code,
        },
        overallOk:
          decryptedEmail === email && localVerify && loginResponse.status === 200,
      },
      null,
      2,
    ),
  );

  await cleanup(TEST_EMAIL);
  await prisma.$disconnect();

  if (decryptedEmail !== email || !localVerify || loginResponse.status !== 200) {
    process.exitCode = 1;
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
