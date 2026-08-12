import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEMO_COMPANIES,
  DEMO_COMPANY_DEV_ACTIVE_USERS,
  DEMO_COMPANY_ADMIN,
  DEMO_SEED_DEFAULT_PASSWORD,
  DEMO_SEED_SOURCE,
} from '../src/demo/demoSeed.constants.js';
import { assertDemoSeedSafe } from '../src/demo/demoSeed.guard.js';
import { DEMO_MANIFEST_VERSION } from '../src/demo/demoSeed.manifest.js';

const repoRoot = join(import.meta.dirname, '..');

describe('demo seed', () => {
  it('expõe script dev:seed:demo no package.json', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['dev:seed:demo']).toBe('tsx src/demo/demoSeed.ts');
  });

  it('mantém db:seed separado do demo seed', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['db:seed']).toBe('tsx src/db/seed.ts');
    expect(pkg.scripts['dev:seed:demo']).not.toContain('src/db/seed.ts');
  });

  it('define empresas demo com CNPJ e pendências', () => {
    expect(DEMO_COMPANIES).toHaveLength(4);
    for (const company of DEMO_COMPANIES) {
      expect(company.cnpj).toMatch(/^\d{14}$/);
      expect(company.pendingUsers.length).toBeGreaterThanOrEqual(2);
      for (const user of company.pendingUsers) {
        expect(user.jobTitle.length).toBeGreaterThan(0);
        expect(user.departmentText.length).toBeGreaterThan(0);
        expect(user.reason.length).toBeGreaterThan(0);
        expect(user.operationalNotificationsConsent).toBe(true);
      }
    }
  });

  it('company_dev parece um cliente real: um admin de empresa e funcionários comuns', () => {
    expect(DEMO_COMPANY_ADMIN.email).toBe('rafael.mendes@doqyn.dev');
    expect(DEMO_COMPANY_ADMIN.roles).toEqual(['company_admin', 'user']);

    expect(DEMO_COMPANY_DEV_ACTIVE_USERS.length).toBeGreaterThanOrEqual(2);
    for (const member of DEMO_COMPANY_DEV_ACTIVE_USERS) {
      expect(member.roles).toEqual(['user']);
      expect(member.jobTitle?.length).toBeGreaterThan(0);
    }
  });

  it('nenhuma conta demo carrega papel de plataforma', () => {
    // O seed demo existe para exercitar o produto como o cliente o usa. Uma conta onipotente vê
    // tudo por privilégio e nunca passa pelas regras de governança — bug de escopo passaria batido.
    const everyRole = [DEMO_COMPANY_ADMIN, ...DEMO_COMPANY_DEV_ACTIVE_USERS].flatMap(
      (member) => member.roles as string[],
    );
    expect([...new Set(everyRole)].sort()).toEqual(['company_admin', 'user']);
  });

  it('bloqueia demo seed em produção', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => assertDemoSeedSafe()).toThrow(/NODE_ENV=production/);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it('documenta senha padrão e source do seed', () => {
    expect(DEMO_SEED_DEFAULT_PASSWORD).toBe('DevDoqyn@123');
    expect(DEMO_SEED_SOURCE).toBe('dev_seed_demo');
    expect(DEMO_MANIFEST_VERSION).toBe(1);
  });

  it('.gitignore ignora artefatos .generated', () => {
    const gitignore = readFileSync(join(repoRoot, '.gitignore'), 'utf8');
    expect(gitignore).toContain('.generated/');
  });
});
