import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDevDatabase } from '../src/dev/ensureDevDb.js';
import { DOCKER_START_HINT } from '../src/dev/dockerDev.js';
import { maskDatabaseUrl } from '../src/db/databaseHealth.js';

const DATABASE_URL = 'postgresql://doqyn_auth:secret@127.0.0.1:5433/doqyn_auth';

describe('ensureDevDatabase', () => {
  it('falha com mensagem amigável quando Docker não está disponível', async () => {
    const logs: string[] = [];
    const result = await ensureDevDatabase(DATABASE_URL, {
      exec: () => {
        throw new Error('docker daemon offline');
      },
      execInherit: () => undefined,
      sleep: async () => undefined,
      log: (message) => logs.push(message),
      warn: () => undefined,
      skipDockerBootstrap: false,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('DOCKER_UNAVAILABLE');
      expect(result.message).toContain('Docker não está rodando');
      expect(result.message).toContain(DOCKER_START_HINT);
    }
    expect(logs.some((line) => line.includes('redacted'))).toBe(true);
    expect(logs.join('\n')).not.toContain('secret');
  });

  it('retorna ok quando porta e Prisma respondem', async () => {
    const checkPrisma = vi.fn().mockResolvedValue({ ok: true });
    const checkPort = vi.fn().mockResolvedValue(true);

    const result = await ensureDevDatabase(DATABASE_URL, {
      exec: () => 'container-id',
      execInherit: () => undefined,
      sleep: async () => undefined,
      log: () => undefined,
      warn: () => undefined,
      checkPrisma,
      checkPort,
      skipDockerBootstrap: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.endpoint).toBe('127.0.0.1:5433');
      expect(result.databaseUrlRedacted).toBe(maskDatabaseUrl(DATABASE_URL));
      expect(result.portAccessible).toBe(true);
    }
    expect(checkPrisma).toHaveBeenCalled();
  });

  it('falha com mensagem amigável quando Postgres não responde', async () => {
    const result = await ensureDevDatabase(DATABASE_URL, {
      exec: () => 'container-id',
      execInherit: () => undefined,
      sleep: async () => undefined,
      log: () => undefined,
      warn: () => undefined,
      checkPrisma: async () => ({ ok: false, error: 'timeout' }),
      checkPort: async () => false,
      maxAttempts: 2,
      skipDockerBootstrap: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('POSTGRES_UNAVAILABLE');
      expect(result.message).toContain('127.0.0.1:5433');
      expect(result.hints).toContain('docker compose ps');
      expect(result.hints).toContain('docker compose logs postgres-auth');
    }
  });
});

describe('npm run dev', () => {
  it('package.json chama ensure-dev-db antes do server', () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '../package.json'), 'utf8'));
    expect(pkg.scripts.dev).toContain('ensure-dev-db');
    expect(pkg.scripts.dev).toContain('src/server.ts');
    expect(pkg.scripts['dev:server']).toContain('src/server.ts');
    expect(pkg.scripts.dev).not.toContain('db:seed');
    expect(pkg.scripts.dev).not.toContain('dev:reset:postgres');
  });
});

describe('audit:auth-health script', () => {
  it('reporta docker/container/porta sem expor senha', () => {
    const script = readFileSync(join(import.meta.dirname, '../scripts/audit-auth-health.ts'), 'utf8');
    expect(script).toContain('dockerAvailable');
    expect(script).toContain('containerRunning');
    expect(script).toContain('portAccessible');
    expect(script).toContain('databaseUrlRedacted');
    expect(script).not.toContain('passwordHash');
  });
});
