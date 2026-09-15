import { Prisma } from '@prisma/client';
import { ConflictError } from '../../utils/errors.js';

export function individualTaxIdConflict(country: string): ConflictError {
  return country === 'BR'
    ? new ConflictError('Já existe um cadastro com este CPF.', 'CPF_ALREADY_EXISTS')
    : new ConflictError('Já existe um cadastro com este documento fiscal.', 'TAX_ID_ALREADY_EXISTS');
}

export function companyTaxIdConflict(): ConflictError {
  return new ConflictError(
    'Já existe uma empresa cadastrada com este documento fiscal.',
    'COMPANY_ALREADY_EXISTS',
  );
}

export function emailConflict(): ConflictError {
  return new ConflictError(
    'Este e-mail já está em uso. Faça login ou use outro e-mail.',
    'EMAIL_ALREADY_EXISTS',
  );
}

/**
 * P2002 numa das colunas. `meta.target` chega como lista de campos (`emailLookupHash`) ou como
 * nome do índice (`auth_tenants_tax_id_hash_country_live_key`), conforme o índice — por isso a
 * comparação ignora caixa e sublinhado.
 */
export function isUniqueViolationOn(error: unknown, column: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const flatten = (value: string) => value.toLowerCase().replace(/_/g, '');
  return flatten(JSON.stringify(error.meta?.target ?? '')).includes(flatten(column));
}

/**
 * A busca de duplicidade antes do `create` não segura dois envios simultâneos: os dois passam por
 * ela e quem fecha a janela é o índice único. Sem esta tradução, o perdedor da corrida levava 500
 * em vez do mesmo 409 de quem chega depois.
 */
export function toSignupConflict(error: unknown, taxIdConflict: () => ConflictError): unknown {
  if (isUniqueViolationOn(error, 'tax_id_hash')) return taxIdConflict();
  if (isUniqueViolationOn(error, 'email_lookup_hash')) return emailConflict();
  return error;
}
