import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEMO_COMPANIES,
  DEMO_COMPANY_DEV_ACTIVE_USERS,
  DEMO_GLOBAL_ADMIN,
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

  it('define admin global e usuários ativos em company_dev', () => {
    expect(DEMO_GLOBAL_ADMIN.roles).toContain('doqyn_admin');
    expect(DEMO_GLOBAL_ADMIN.email).toBe('admin.global@doqyn.dev');
    expect(DEMO_COMPANY_DEV_ACTIVE_USERS).toHaveLength(1);
    expect(DEMO_COMPANY_DEV_ACTIVE_USERS[0]?.email).toBe('camila.oliveira@doqyn.dev');
    expect(DEMO_COMPANY_DEV_ACTIVE_USERS[0]?.roles).toEqual(['user']);
    expect(DEMO_COMPANY_DEV_ACTIVE_USERS[0]?.roles).not.toContain('company_admin');
    expect(DEMO_COMPANY_DEV_ACTIVE_USERS[0]?.roles).not.toContain('doqyn_admin');
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
