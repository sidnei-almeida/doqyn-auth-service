import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(import.meta.dirname, '..');

describe('seed de desenvolvimento', () => {
  it('npm run dev não executa seed automaticamente', () => {
    const pkg = readFileSync(join(repoRoot, 'package.json'), 'utf8');
    expect(pkg.includes('ensure-dev-db')).toBe(true);
    expect(pkg.includes('db:seed')).toBe(true);
    expect(pkg.match(/"dev":\s*"[^"]*seed/)).toBeNull();
    expect(pkg.match(/"dev":\s*"[^"]*dev:reset:postgres/)).toBeNull();
  });

  it('seed só sobrescreve passwordHash com SEED_FORCE_PASSWORD_RESET=true', () => {
    const seed = readFileSync(join(repoRoot, 'src/db/seed.ts'), 'utf8');
    expect(seed).toContain('SEED_FORCE_PASSWORD_RESET');
    expect(seed).toMatch(/update:\s*\n?\s*process\.env\.SEED_FORCE_PASSWORD_RESET === 'true'/);
    expect(seed).not.toMatch(/update:\s*\{\s*passwordHash\s*\}/);
  });

  it('.env.example documenta flag de reset explícito', () => {
    const envExample = readFileSync(join(repoRoot, '.env.example'), 'utf8');
    expect(envExample).toContain('SEED_FORCE_PASSWORD_RESET');
  });
});

describe('audit:auth-health script', () => {
  it('usa snapshot redigido sem expor senha', () => {
    const script = readFileSync(join(repoRoot, 'scripts/audit-auth-health.ts'), 'utf8');
    expect(script).toContain('maskDatabaseUrl');
    expect(script).toContain('databaseUrlRedacted');
    expect(script).toContain('prismaSelect1');
    expect(script).toContain('dockerAvailable');
    expect(script).toContain('containerRunning');
    expect(script).not.toContain('passwordHash');
  });
});
