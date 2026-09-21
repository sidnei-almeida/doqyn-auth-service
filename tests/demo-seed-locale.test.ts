import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEMO_ACCESS_GROUPS,
  DEMO_COMPANY_ADMIN,
  DEMO_COMPANY_DEV_ACTIVE_USERS,
} from '../src/demo/demoSeed.constants.js';
import {
  localizeDemoAccessGroups,
  localizeDemoMember,
  resolveDemoSeedLocale,
} from '../src/demo/demoSeed.locale.js';

const repoRoot = join(import.meta.dirname, '..');
const MEMBERS = [DEMO_COMPANY_ADMIN, ...DEMO_COMPANY_DEV_ACTIVE_USERS];

describe('demo seed por idioma', () => {
  it('sem DEMO_SEED_LOCALE é pt-BR, e idioma desconhecido para o seed', () => {
    expect(resolveDemoSeedLocale(undefined)).toBe('pt-BR');
    expect(resolveDemoSeedLocale(' en-US ')).toBe('en-US');
    expect(() => resolveDemoSeedLocale('fr-FR')).toThrow(/DEMO_SEED_LOCALE/);
  });

  it('pt-BR devolve o seed como sempre foi', () => {
    expect(localizeDemoAccessGroups(DEMO_ACCESS_GROUPS, 'pt-BR')).toBe(DEMO_ACCESS_GROUPS);
    expect(localizeDemoMember(DEMO_COMPANY_ADMIN, 'pt-BR')).toBe(DEMO_COMPANY_ADMIN);
  });

  it('em inglês e espanhol, grupo e cargo seguem o idioma; slug, e-mail e nome não', () => {
    for (const locale of ['en-US', 'es-419'] as const) {
      const groups = localizeDemoAccessGroups(DEMO_ACCESS_GROUPS, locale);
      expect(groups.map((g) => g.slug)).toEqual(DEMO_ACCESS_GROUPS.map((g) => g.slug));
      for (const group of groups) {
        expect(group.name.length).toBeGreaterThan(0);
        expect(group.description.length).toBeGreaterThan(0);
      }
      for (const member of MEMBERS) {
        const localized = localizeDemoMember(member, locale);
        expect(localized.email).toBe(member.email);
        expect(localized.firstName).toBe(member.firstName);
        expect(localized.jobTitle?.length).toBeGreaterThan(0);
      }
    }

    const en = localizeDemoAccessGroups(DEMO_ACCESS_GROUPS, 'en-US');
    expect(en.find((g) => g.slug === 'diretoria')?.name).toBe('Executive Board');
    for (const member of MEMBERS) {
      expect(localizeDemoMember(member, 'en-US').jobTitle).not.toBe(member.jobTitle);
    }
  });

  it('o idioma chega ao perfil, à empresa e ao manifesto que o Alpha lê', () => {
    const service = readFileSync(join(repoRoot, 'src/demo/demoSeed.service.ts'), 'utf8');
    expect(service.match(/defaultLocale: locale/g)?.length).toBe(4);
    expect(service.match(/^\s+locale,$/gm)?.length).toBeGreaterThanOrEqual(3);
  });
});
