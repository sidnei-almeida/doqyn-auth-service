#!/usr/bin/env tsx
import { loadEnv } from '../config/env.js';
import { disconnectPrisma } from '../db/prisma.js';
import { runDemoSeed } from './demoSeed.service.js';

async function main() {
  loadEnv();

  const result = await runDemoSeed();

  const pendingCount = result.manifest.companies.reduce(
    (sum, company) => sum + company.pendingUsers.length,
    0,
  );

  console.log('Demo seed concluído:');
  console.log(`  Empresas: ${result.manifest.companies.length}`);
  console.log(`  Pendências de acesso: ${pendingCount}`);
  console.log(
    `  Admin da empresa: ${result.manifest.globalAdmin.email} (${result.manifest.globalAdmin.tenantId})`,
  );
  if (result.manifest.companyDevActiveUsers.length > 0) {
    console.log(
      `  Usuários ativos company_dev: ${result.manifest.companyDevActiveUsers.map((u) => u.email).join(', ')}`,
    );
  }
  console.log(`  Senha dev (relatório): ${result.password}`);
  console.log(`  Manifest: ${result.manifestPath}`);
  console.log(`  Relatório MD: ${result.reportPaths.markdown}`);
  console.log(`  Relatório JSON: ${result.reportPaths.json}`);
}

main()
  .catch((error) => {
    console.error('Erro no demo seed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await disconnectPrisma();
  });
