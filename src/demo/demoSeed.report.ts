import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DemoSeedManifest } from './demoSeed.manifest.js';

export type DemoSeedReportInput = {
  manifest: DemoSeedManifest;
  password: string;
  manifestPath: string;
  repoRoot?: string;
};

export function defaultReportPaths(repoRoot = process.cwd()) {
  return {
    markdown: join(repoRoot, '.generated', 'doqyn-demo-accounts.md'),
    json: join(repoRoot, '.generated', 'doqyn-demo-accounts.json'),
  };
}

function buildReportJson(input: DemoSeedReportInput) {
  return {
    generatedAt: input.manifest.generatedAt,
    source: input.manifest.source,
    password: input.password,
    manifestPath: input.manifestPath,
    activeUsers: [
      {
        email: input.manifest.globalAdmin.email,
        displayName: input.manifest.globalAdmin.displayName,
        tenantId: input.manifest.globalAdmin.tenantId,
        roles: input.manifest.globalAdmin.roles,
        status: input.manifest.globalAdmin.status,
      },
      ...input.manifest.companyDevActiveUsers.map((user) => ({
        email: user.email,
        displayName: user.displayName,
        tenantId: user.tenantId,
        roles: user.roles,
        status: user.status,
        jobTitle: user.jobTitle,
        departmentText: user.departmentText,
      })),
    ],
    globalAdmin: {
      email: input.manifest.globalAdmin.email,
      displayName: input.manifest.globalAdmin.displayName,
      tenantId: input.manifest.globalAdmin.tenantId,
      roles: input.manifest.globalAdmin.roles,
      status: input.manifest.globalAdmin.status,
    },
    companyDevActiveUsers: input.manifest.companyDevActiveUsers.map((user) => ({
      email: user.email,
      displayName: user.displayName,
      tenantId: user.tenantId,
      roles: user.roles,
      status: user.status,
      jobTitle: user.jobTitle,
      departmentText: user.departmentText,
    })),
    companies: input.manifest.companies.map((company) => ({
      tenantId: company.tenantId,
      displayName: company.displayName,
      cnpj: company.cnpj,
      accessGroups: company.accessGroups.map((group) => group.name),
      pendingUsers: company.pendingUsers.map((user) => ({
        email: user.email,
        displayName: user.displayName,
        jobTitle: user.jobTitle,
        departmentText: user.departmentText,
        personType: user.personType,
        status: user.status,
      })),
    })),
  };
}

function buildReportMarkdown(input: DemoSeedReportInput): string {
  const lines: string[] = [
    '# DOQYN — contas demo (desenvolvimento)',
    '',
    `Gerado em: ${input.manifest.generatedAt}`,
    '',
    '> **Atenção:** arquivo local apenas para desenvolvimento. Não commitar.',
    '',
    '## Senha compartilhada (dev)',
    '',
    `\`${input.password}\``,
    '',
    '## Usuários ativos (company_dev)',
    '',
    `- \`${input.manifest.globalAdmin.email}\` — ${input.manifest.globalAdmin.displayName}`,
    `  - Papéis: ${input.manifest.globalAdmin.roles.join(', ')}`,
    '',
    ...input.manifest.companyDevActiveUsers.flatMap((user) => [
      `- \`${user.email}\` — ${user.displayName}`,
      ...(user.jobTitle ? [`  - Cargo: ${user.jobTitle}`] : []),
      ...(user.departmentText ? [`  - Setor: ${user.departmentText}`] : []),
      `  - Papéis: ${user.roles.join(', ')}`,
      '',
    ]),
    '## Admin da empresa demo',
    '',
    `- E-mail: \`${input.manifest.globalAdmin.email}\``,
    `- Nome: ${input.manifest.globalAdmin.displayName}`,
    `- Tenant: \`${input.manifest.globalAdmin.tenantId}\``,
    `- Papéis: ${input.manifest.globalAdmin.roles.join(', ')}`,
    '',
    '## Empresas demo',
    '',
  ];

  for (const company of input.manifest.companies) {
    lines.push(`### ${company.displayName}`);
    lines.push('');
    lines.push(`- Tenant: \`${company.tenantId}\``);
    lines.push(`- CNPJ: \`${company.cnpj}\``);
    lines.push(`- Grupos de acesso: ${company.accessGroups.map((g) => g.name).join(', ')}`);
    lines.push(`- Pendências: ${company.pendingUsers.length}`);
    lines.push('');
    for (const user of company.pendingUsers) {
      lines.push(`- \`${user.email}\` — ${user.displayName}`);
      lines.push(`  - Cargo: ${user.jobTitle}`);
      lines.push(`  - Setor: ${user.departmentText}`);
      lines.push(`  - Tipo: ${user.personType.toUpperCase()}`);
      lines.push(`  - Motivo: ${user.reason}`);
    }
    lines.push('');
  }

  lines.push('## Manifest');
  lines.push('');
  lines.push(`\`${input.manifestPath}\``);
  lines.push('');

  return `${lines.join('\n')}\n`;
}

export function writeDemoSeedReport(input: DemoSeedReportInput) {
  const paths = defaultReportPaths(input.repoRoot);
  mkdirSync(dirname(paths.markdown), { recursive: true });
  writeFileSync(paths.markdown, buildReportMarkdown(input), 'utf8');
  writeFileSync(paths.json, `${JSON.stringify(buildReportJson(input), null, 2)}\n`, 'utf8');
  return paths;
}
