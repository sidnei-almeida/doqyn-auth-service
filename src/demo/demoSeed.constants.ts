import { CONSENT_TEXT_VERSION } from '../modules/consent/consent.constants.js';
import { DOQYN_TERMS_VERSION } from '../modules/terms/terms.constants.js';

export const DEMO_SEED_SOURCE = 'dev_seed_demo' as const;
export const DEMO_SEED_DEFAULT_PASSWORD = 'DevDoqyn@123';
export const DEMO_COMPANY_TENANT_ID = 'company_dev';

export type DemoAccessGroupDef = {
  slug: string;
  name: string;
  description: string;
};


export type DemoCompanyDef = {
  seedKey: string;
  tenantId: string;
  displayName: string;
  legalName: string;
  cnpj: string;
  slug: string;
  accessGroups: DemoAccessGroupDef[];
};

/**
 * Membro ativo de um tenant demo. Só papéis que um cliente real carrega — não existe papel de
 * plataforma aqui, e não deve voltar a existir: um seed com conta onipotente deixa de exercitar o
 * produto do jeito que o cliente o usa, que é a razão de o seed demo existir.
 */
export type DemoTenantMemberDef = {
  seedKey: string;
  email: string;
  firstName: string;
  lastName: string;
  /**
   * O handle público, escrito à mão para quem o demo usa na busca entre empresas.
   *
   * Ausente, `claimUsername` deriva do e-mail — que é o que acontece com quem se cadastra sem
   * escolher. Escrever aqui é o que torna o demo capaz de mostrar a diferença entre o handle
   * escolhido e o herdado do endereço.
   */
  username?: string;
  whatsapp: string;
  roles: Array<'company_admin' | 'user'>;
  jobTitle?: string;
  departmentText?: string;
};

export const DEMO_ACCESS_GROUPS: DemoAccessGroupDef[] = [
  { slug: 'financeiro', name: 'Financeiro', description: 'Equipe financeira e controladoria.' },
  { slug: 'juridico', name: 'Jurídico', description: 'Assessoria jurídica e compliance.' },
  { slug: 'rh', name: 'RH', description: 'Recursos humanos.' },
  { slug: 'compras', name: 'Compras', description: 'Compras e procurement.' },
  { slug: 'diretoria', name: 'Diretoria', description: 'Diretoria executiva.' },
];

/**
 * Administrador da empresa do tenant demo — o perfil que um cliente PJ realmente tem.
 *
 * Substitui a antiga conta `admin.global@doqyn.dev`, que carregava o papel administrativo de
 * plataforma. Aquela conta enxergava tudo por privilégio global e, com isso, nunca exercitava as
 * regras de governança que o produto vende: qualquer bug de escopo passava despercebido no demo.
 */
export const DEMO_COMPANY_ADMIN: DemoTenantMemberDef = {
  seedKey: 'company_admin',
  username: 'rafa.mendes',
  email: 'rafael.mendes@doqyn.dev',
  firstName: 'Rafael',
  lastName: 'Mendes',
  whatsapp: '+5551987654321',
  roles: ['company_admin', 'user'],
  jobTitle: 'Diretor de Operações',
  departmentText: 'Diretoria',
};

/**
 * Funcionários comuns do mesmo tenant — é o que torna o demo parecido com um cliente de verdade:
 * um admin e vários usuários cujo acesso depende de propriedade, grupo e regra de governança.
 */
export const DEMO_COMPANY_DEV_ACTIVE_USERS: DemoTenantMemberDef[] = [
  {
    seedKey: 'camila_oliveira',
    username: 'camila.oli',
    email: 'camila.oliveira@doqyn.dev',
    firstName: 'Camila',
    lastName: 'Oliveira',
    whatsapp: '+5551999887766',
    roles: ['user'],
    jobTitle: 'Analista de Documentos',
    departmentText: 'Jurídico',
  },
  {
    seedKey: 'thiago_barros',
    username: 'thi.barros',
    email: 'thiago.barros@doqyn.dev',
    firstName: 'Thiago',
    lastName: 'Barros',
    whatsapp: '+5551999776655',
    roles: ['user'],
    jobTitle: 'Analista Financeiro',
    departmentText: 'Financeiro',
  },
  {
    seedKey: 'renata_alves',
    username: 'renata.alves',
    email: 'renata.alves@doqyn.dev',
    firstName: 'Renata',
    lastName: 'Alves',
    whatsapp: '+5551999665544',
    roles: ['user'],
    jobTitle: 'Analista de RH',
    departmentText: 'RH',
  },
];


export const DEMO_COMPANIES: DemoCompanyDef[] = [
  {
    seedKey: 'company_alpha_consultoria',
    tenantId: 'company_alpha_consultoria',
    displayName: 'Alpha Consultoria Empresarial Ltda.',
    legalName: 'Alpha Consultoria Empresarial Ltda.',
    cnpj: '51684327000198',
    slug: 'alpha_consultoria',
    accessGroups: DEMO_ACCESS_GROUPS,
  },
  {
    seedKey: 'company_horizonte_logistica',
    tenantId: 'company_horizonte_logistica',
    displayName: 'Horizonte Logística e Transportes S.A.',
    legalName: 'Horizonte Logística e Transportes S.A.',
    cnpj: '11222333000181',
    slug: 'horizonte_logistica',
    accessGroups: DEMO_ACCESS_GROUPS,
  },
  {
    seedKey: 'company_metalprime_industrias',
    tenantId: 'company_metalprime_industrias',
    displayName: 'Metalprime Indústrias Metálicas Ltda.',
    legalName: 'Metalprime Indústrias Metálicas Ltda.',
    cnpj: '12345678000199',
    slug: 'metalprime_industrias',
    accessGroups: DEMO_ACCESS_GROUPS,
  },
  {
    seedKey: 'company_nexserv_tecnologia',
    tenantId: 'company_nexserv_tecnologia',
    displayName: 'NexServ Tecnologia e Serviços Administrativos Ltda.',
    legalName: 'NexServ Tecnologia e Serviços Administrativos Ltda.',
    cnpj: '60701190000199',
    slug: 'nexserv_tecnologia',
    accessGroups: DEMO_ACCESS_GROUPS,
  },
];

export const DEMO_TERMS_VERSION = DOQYN_TERMS_VERSION;
export const DEMO_CONSENT_TEXT_VERSION = CONSENT_TEXT_VERSION;
