import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertSafeDevScripts,
  buildEmptyDatabaseWarning,
  buildVolumeSwapAlert,
  collectDatabaseUrlSourceAudit,
  collectDockerStorageAudit,
  detectComposeProjectName,
  isCandidateAuthPostgresVolume,
} from '../src/dev/dockerStorageAudit.js';
import { maskDatabaseUrl } from '../src/db/databaseHealth.js';

const repoRoot = join(import.meta.dirname, '..');

describe('docker storage audit', () => {
  it('detecta compose project pelo diretório quando COMPOSE_PROJECT_NAME ausente', () => {
    const project = detectComposeProjectName({
      workingDirectoryName: 'doqyn-auth-service',
    });
    expect(project.name).toBe('doqyn-auth-service');
    expect(project.source).toBe('directory');
  });

  it('lista volume atual e candidatos', () => {
    const audit = collectDockerStorageAudit({
      exec: (command) => {
        if (command.startsWith('docker volume ls')) {
          return 'doqyn-auth-service_postgres_auth_data\nold_auth_postgres_data';
        }
        if (command.includes('docker volume inspect doqyn-auth-service_postgres_auth_data')) {
          return JSON.stringify([
            {
              Name: 'doqyn-auth-service_postgres_auth_data',
              CreatedAt: '2026-06-28T18:28:15-03:00',
              Mountpoint: '/var/lib/docker/volumes/doqyn-auth-service_postgres_auth_data/_data',
              Labels: {
                'com.docker.compose.project': 'doqyn-auth-service',
                'com.docker.compose.volume': 'postgres_auth_data',
              },
            },
          ]);
        }
        if (command.includes('docker volume inspect old_auth_postgres_data')) {
          return JSON.stringify([
            {
              Name: 'old_auth_postgres_data',
              CreatedAt: '2026-06-20T10:00:00-03:00',
              Labels: { 'com.docker.compose.project': 'doqyn-auth' },
            },
          ]);
        }
        if (command.startsWith('docker compose ps -q')) {
          return 'abc123';
        }
        if (command.startsWith('docker inspect')) {
          return JSON.stringify([
            {
              Name: '/doqyn-auth-service-postgres-auth-1',
              Id: 'abc123',
              Created: '2026-06-28T18:28:20-03:00',
              State: { Status: 'running', StartedAt: '2026-07-02T10:00:00Z' },
              Mounts: [
                {
                  Type: 'volume',
                  Name: 'doqyn-auth-service_postgres_auth_data',
                  Source: '/var/lib/docker/volumes/doqyn-auth-service_postgres_auth_data/_data',
                  Destination: '/var/lib/postgresql/data',
                },
              ],
            },
          ]);
        }
        return '';
      },
      workingDirectoryName: 'doqyn-auth-service',
    });

    expect(audit.postgresContainer.name).toBe('doqyn-auth-service-postgres-auth-1');
    expect(audit.activeVolume?.name).toBe('doqyn-auth-service_postgres_auth_data');
    expect(audit.candidateVolumes).toHaveLength(2);
    expect(audit.multipleCandidateVolumes).toBe(true);
    expect(audit.volumeSwapAlert).toMatch(/múltiplos volumes Postgres/i);
  });

  it('múltiplos volumes candidatos geram alerta', () => {
    const alert = buildVolumeSwapAlert({
      activeVolumeName: 'volume_a',
      candidateVolumes: [{ name: 'volume_a' }, { name: 'volume_b' }],
    });
    expect(alert).toMatch(/volume_a/);
    expect(alert).toMatch(/volume_b/);
  });

  it('isCandidateAuthPostgresVolume reconhece volumes do auth', () => {
    expect(isCandidateAuthPostgresVolume('doqyn-auth-service_postgres_auth_data')).toBe(true);
    expect(isCandidateAuthPostgresVolume('random_volume')).toBe(false);
  });
});

describe('database url source audit', () => {
  it('DATABASE_URL é redacted no relatório auxiliar', () => {
    const audit = collectDatabaseUrlSourceAudit({
      databaseUrl: 'postgresql://doqyn_auth:secret@127.0.0.1:5433/doqyn_auth',
      databaseUrlRedacted: maskDatabaseUrl(
        'postgresql://doqyn_auth:secret@127.0.0.1:5433/doqyn_auth',
      ),
      host: '127.0.0.1',
      port: '5433',
      database: 'doqyn_auth',
    });

    expect(audit.databaseUrlRedacted).not.toContain('secret');
    expect(audit.host).toBe('127.0.0.1');
    expect(audit.database).toBe('doqyn_auth');
  });

  it('alerta quando TEST_DATABASE_URL não está separado do dev', () => {
    const audit = collectDatabaseUrlSourceAudit({
      databaseUrl: 'postgresql://doqyn_auth:secret@127.0.0.1:5433/doqyn_auth',
    });
    expect(audit.usesSharedDevDatabaseRisk).toBe(true);
    expect(audit.sharedDevDatabaseWarning).toMatch(/npm test apaga/i);
  });
});

describe('empty database warning', () => {
  it('audit mostra warning quando users=0 e tenants=0', () => {
    const warning = buildEmptyDatabaseWarning({
      users: 0,
      tenants: 0,
      memberships: 0,
      sessions: 0,
    });

    expect(warning?.code).toBe('AUTH_DATABASE_EMPTY');
    expect(warning?.message).toMatch(/Auth database is empty/i);
    expect(warning?.hints.some((hint) => hint.includes('audit:auth-storage'))).toBe(true);
    expect(warning?.hints.some((hint) => hint.includes('dev:seed:demo'))).toBe(true);
  });

  it('não gera warning quando há dados', () => {
    const warning = buildEmptyDatabaseWarning({
      users: 2,
      tenants: 1,
      memberships: 1,
      sessions: 0,
    });
    expect(warning).toBeUndefined();
  });
});

describe('scripts seguros', () => {
  it('ensure-dev-db e audit não chamam reset/seed/down -v', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };

    const safety = assertSafeDevScripts(pkg.scripts);
    expect(safety.ensureDevDbSafe).toBe(true);
    expect(safety.auditHealthSafe).toBe(true);
    expect(safety.devDoesNotSeedOrReset).toBe(true);
    expect(pkg.scripts.dev).not.toContain('db:seed');
    expect(pkg.scripts.dev).not.toContain('dev:reset:postgres');
  });

  it('audit:auth-health e audit:auth-storage estão registrados', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['audit:auth-storage']).toContain('audit-auth-storage');
    const healthScript = readFileSync(join(repoRoot, 'scripts/audit-auth-health.ts'), 'utf8');
    expect(healthScript).toContain('emptyDatabaseWarning');
    expect(healthScript).toContain('postgresVolumeName');
  });
});

describe('ensure-dev-db script', () => {
  it('não contém comandos destrutivos', () => {
    const script = readFileSync(join(repoRoot, 'scripts/ensure-dev-db.ts'), 'utf8');
    expect(script).not.toContain('migrate reset');
    expect(script).not.toContain('down -v');
    expect(script).not.toContain('db:seed');
    expect(script).not.toContain('deleteMany');
  });
});
