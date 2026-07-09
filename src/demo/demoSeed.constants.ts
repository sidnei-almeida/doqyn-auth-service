import { CONSENT_TEXT_VERSION } from '../modules/access-requests/accessRequests.constants.js';
import { DOQYN_TERMS_VERSION } from '../modules/terms/terms.constants.js';

export const DEMO_SEED_SOURCE = 'dev_seed_demo' as const;
export const DEMO_SEED_DEFAULT_PASSWORD = 'DevDoqyn@123';
export const DEMO_GLOBAL_ADMIN_TENANT_ID = 'company_dev';

export type DemoAccessGroupDef = {
  slug: string;
  name: string;
  description: string;
};

export type DemoPendingUserDef = {
  seedKey: string;
  email: string;
  firstName: string;
  lastName: string;
  whatsapp: string;
  taxId: string;
  personType: 'cpf' | 'cnpj';
  jobTitle: string;
  departmentText: string;
  reason: string;
  operationalNotificationsConsent: boolean;
};

export type DemoCompanyDef = {
  seedKey: string;
  tenantId: string;
  displayName: string;
  legalName: string;
  cnpj: string;
  slug: string;
  accessGroups: DemoAccessGroupDef[];
  pendingUsers: DemoPendingUserDef[];
};

export type DemoGlobalAdminDef = {
  seedKey: string;
  email: string;
  firstName: string;
  lastName: string;
  whatsapp: string;
  roles: Array<'doqyn_admin' | 'company_admin' | 'user'>;
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

export const DEMO_GLOBAL_ADMIN: DemoGlobalAdminDef = {
  seedKey: 'global_admin',
  email: 'admin.global@doqyn.dev',
  firstName: 'Rafael',
  lastName: 'Mendes',
  whatsapp: '+5551987654321',
  roles: ['doqyn_admin', 'company_admin', 'user'],
};

/** Usuários ativos adicionais em company_dev — para testes de compartilhamento e permissões. */
export const DEMO_COMPANY_DEV_ACTIVE_USERS: DemoGlobalAdminDef[] = [
  {
    seedKey: 'camila_oliveira',
    email: 'camila.oliveira@doqyn.dev',
    firstName: 'Camila',
    lastName: 'Oliveira',
    whatsapp: '+5551999887766',
    roles: ['user'],
    jobTitle: 'Analista de Documentos',
    departmentText: 'Jurídico',
  },
];

const basePending = {
  operationalNotificationsConsent: true,
  acceptedTermsVersion: DOQYN_TERMS_VERSION,
  consentTextVersion: CONSENT_TEXT_VERSION,
} as const;

function pendingUser(
  seedKey: string,
  email: string,
  firstName: string,
  lastName: string,
  whatsapp: string,
  taxId: string,
  personType: 'cpf' | 'cnpj',
  jobTitle: string,
  departmentText: string,
  reason: string,
): DemoPendingUserDef {
  return {
    seedKey,
    email,
    firstName,
    lastName,
    whatsapp,
    taxId,
    personType,
    jobTitle,
    departmentText,
    reason,
    operationalNotificationsConsent: basePending.operationalNotificationsConsent,
  };
}

export const DEMO_COMPANIES: DemoCompanyDef[] = [
  {
    seedKey: 'company_alpha_consultoria',
    tenantId: 'company_alpha_consultoria',
    displayName: 'Alpha Consultoria Empresarial Ltda.',
    legalName: 'Alpha Consultoria Empresarial Ltda.',
    cnpj: '51684327000198',
    slug: 'alpha_consultoria',
    accessGroups: DEMO_ACCESS_GROUPS,
    pendingUsers: [
      pendingUser(
        'alpha_pedro',
        'pedro.henrique@alpha-consultoria.dev',
        'Pedro',
        'Henrique',
        '+5551998877665',
        '52998224725',
        'cpf',
        'Analista Jurídico',
        'Jurídico',
        'Preciso acessar contratos e pareceres para apoiar a equipe comercial.',
      ),
      pendingUser(
        'alpha_luciana',
        'luciana.ferreira@alpha-consultoria.dev',
        'Luciana',
        'Ferreira',
        '+5551988776655',
        '39053344705',
        'cpf',
        'Coordenadora Financeira',
        'Financeiro',
        'Vou consolidar relatórios mensais e acompanhar documentos de faturamento.',
      ),
      pendingUser(
        'alpha_marcos',
        'marcos.ribeiro@empresaexemplo.com',
        'Marcos',
        'Ribeiro',
        '+5551977665544',
        '51684327000198',
        'cnpj',
        'Analista de Compras',
        'Compras',
        'Sou fornecedor homologado e preciso enviar notas e contratos de fornecimento.',
      ),
    ],
  },
  {
    seedKey: 'company_horizonte_logistica',
    tenantId: 'company_horizonte_logistica',
    displayName: 'Horizonte Logística e Transportes S.A.',
    legalName: 'Horizonte Logística e Transportes S.A.',
    cnpj: '11222333000181',
    slug: 'horizonte_logistica',
    accessGroups: DEMO_ACCESS_GROUPS,
    pendingUsers: [
      pendingUser(
        'horizonte_camila',
        'camila.souza@horizonte-log.dev',
        'Camila',
        'Souza',
        '+5551966554433',
        '12345678909',
        'cpf',
        'Gerente de Operações',
        'Operações',
        'Preciso acompanhar documentos de transporte e contratos com transportadoras.',
      ),
      pendingUser(
        'horizonte_bruno',
        'bruno.costa@horizonte-log.dev',
        'Bruno',
        'Costa',
        '+5551955443322',
        '98765432100',
        'cpf',
        'Analista de RH',
        'RH',
        'Vou organizar documentos admissionais e políticas internas da operação.',
      ),
      pendingUser(
        'horizonte_fernanda',
        'fernanda.lima@empresaexemplo.com',
        'Fernanda',
        'Lima',
        '+5551944332211',
        '11222333000181',
        'cnpj',
        'Coordenadora de Compras',
        'Compras',
        'Represento parceiro logístico e preciso subir contratos e SLAs.',
      ),
    ],
  },
  {
    seedKey: 'company_metalprime_industrias',
    tenantId: 'company_metalprime_industrias',
    displayName: 'Metalprime Indústrias Metálicas Ltda.',
    legalName: 'Metalprime Indústrias Metálicas Ltda.',
    cnpj: '12345678000199',
    slug: 'metalprime_industrias',
    accessGroups: DEMO_ACCESS_GROUPS,
    pendingUsers: [
      pendingUser(
        'metalprime_juliana',
        'juliana.martins@metalprime.dev',
        'Juliana',
        'Martins',
        '+5551933221100',
        '11144477735',
        'cpf',
        'Engenheira de Qualidade',
        'Qualidade',
        'Preciso revisar certificados e laudos técnicos da produção.',
      ),
      pendingUser(
        'metalprime_andre',
        'andre.pacheco@metalprime.dev',
        'André',
        'Pacheco',
        '+5551922110099',
        '10000000019',
        'cpf',
        'Supervisor de Manutenção',
        'Manutenção',
        'Vou registrar ordens de serviço e manuais de equipamentos.',
      ),
      pendingUser(
        'metalprime_patricia',
        'patricia.nunes@empresaexemplo.com',
        'Patrícia',
        'Nunes',
        '+5551911009988',
        '12345678000199',
        'cnpj',
        'Analista Fiscal',
        'Financeiro',
        'Sou escritório contábil e preciso acessar notas e obrigações fiscais.',
      ),
    ],
  },
  {
    seedKey: 'company_nexserv_tecnologia',
    tenantId: 'company_nexserv_tecnologia',
    displayName: 'NexServ Tecnologia e Serviços Administrativos Ltda.',
    legalName: 'NexServ Tecnologia e Serviços Administrativos Ltda.',
    cnpj: '60701190000199',
    slug: 'nexserv_tecnologia',
    accessGroups: DEMO_ACCESS_GROUPS,
    pendingUsers: [
      pendingUser(
        'nexserv_gabriel',
        'gabriel.santos@nexserv.dev',
        'Gabriel',
        'Santos',
        '+5551999008877',
        '28625587887',
        'cpf',
        'Product Manager',
        'Produto',
        'Preciso centralizar especificações e contratos de fornecedores de software.',
      ),
      pendingUser(
        'nexserv_helena',
        'helena.rocha@nexserv.dev',
        'Helena',
        'Rocha',
        '+5551988776650',
        '60701190000199',
        'cnpj',
        'Consultora de TI',
        'Tecnologia',
        'Atuo como parceira de implementação e preciso acessar documentação do projeto.',
      ),
    ],
  },
];

export const DEMO_TERMS_VERSION = DOQYN_TERMS_VERSION;
export const DEMO_CONSENT_TEXT_VERSION = CONSENT_TEXT_VERSION;
