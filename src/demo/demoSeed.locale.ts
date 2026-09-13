import { isSupportedLocale, type SupportedLocale } from '../utils/locales.js';
import type { DemoAccessGroupDef, DemoTenantMemberDef } from './demoSeed.constants.js';

/**
 * O idioma do seed demo (Fase 11.6 do plano de i18n do Alpha).
 *
 * `DEMO_SEED_LOCALE=en-US npm run dev:seed:demo` cria as mesmas contas e empresas com o perfil em
 * inglês: `AuthUser.locale`, `AuthTenant.defaultLocale`, nome de grupo, cargo e departamento. Uma
 * demonstração em inglês que abre com "Diretoria" e "Analista Financeiro" desfaz a tradução na
 * primeira tela. O idioma vai no manifesto, e o seed do Alpha semeia a governança nele.
 *
 * Não muda: e-mail, handle, CNPJ, nome de pessoa e razão social — nome próprio não se traduz, e
 * identificador fiscal por país está fora do escopo de i18n (§9 do plano).
 */
export function resolveDemoSeedLocale(value = process.env.DEMO_SEED_LOCALE): SupportedLocale {
  const trimmed = value?.trim();
  if (!trimmed) return 'pt-BR';
  if (isSupportedLocale(trimmed)) return trimmed;
  throw new Error(`DEMO_SEED_LOCALE inválido: "${trimmed}". Use pt-BR, en-US ou es-419.`);
}

type DemoText = {
  groups: Record<string, { name: string; description: string }>;
  members: Record<string, { jobTitle: string; departmentText: string }>;
};

const DEMO_TEXT: Record<Exclude<SupportedLocale, 'pt-BR'>, DemoText> = {
  'en-US': {
    groups: {
      financeiro: { name: 'Finance', description: 'Finance and controlling team.' },
      juridico: { name: 'Legal', description: 'Legal counsel and compliance.' },
      rh: { name: 'HR', description: 'Human resources.' },
      compras: { name: 'Purchasing', description: 'Purchasing and procurement.' },
      diretoria: { name: 'Executive Board', description: 'Executive leadership.' },
    },
    members: {
      company_admin: { jobTitle: 'Chief Operating Officer', departmentText: 'Executive Board' },
      camila_oliveira: { jobTitle: 'Document Analyst', departmentText: 'Legal' },
      thiago_barros: { jobTitle: 'Financial Analyst', departmentText: 'Finance' },
      renata_alves: { jobTitle: 'HR Analyst', departmentText: 'HR' },
    },
  },
  'es-419': {
    groups: {
      financeiro: { name: 'Finanzas', description: 'Equipo financiero y de contraloría.' },
      juridico: { name: 'Jurídico', description: 'Asesoría jurídica y cumplimiento.' },
      rh: { name: 'RR. HH.', description: 'Recursos humanos.' },
      compras: { name: 'Compras', description: 'Compras y abastecimiento.' },
      diretoria: { name: 'Dirección', description: 'Dirección ejecutiva.' },
    },
    members: {
      company_admin: { jobTitle: 'Director de Operaciones', departmentText: 'Dirección' },
      camila_oliveira: { jobTitle: 'Analista de Documentos', departmentText: 'Jurídico' },
      thiago_barros: { jobTitle: 'Analista Financiero', departmentText: 'Finanzas' },
      renata_alves: { jobTitle: 'Analista de RR. HH.', departmentText: 'RR. HH.' },
    },
  },
};

export function localizeDemoAccessGroups(
  groups: DemoAccessGroupDef[],
  locale: SupportedLocale,
): DemoAccessGroupDef[] {
  if (locale === 'pt-BR') return groups;
  return groups.map((group) => {
    const text = DEMO_TEXT[locale].groups[group.slug];
    if (!text) throw new Error(`Seed demo sem texto ${locale} para o grupo "${group.slug}".`);
    return { ...group, ...text };
  });
}

export function localizeDemoMember(
  member: DemoTenantMemberDef,
  locale: SupportedLocale,
): DemoTenantMemberDef {
  if (locale === 'pt-BR') return member;
  const text = DEMO_TEXT[locale].members[member.seedKey];
  if (!text) throw new Error(`Seed demo sem texto ${locale} para "${member.seedKey}".`);
  return { ...member, ...text };
}
