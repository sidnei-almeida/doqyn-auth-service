import { normalizeTaxId } from './normalize.js';

/** Tolerância do fallback genérico do frontend (src/lib/identifiers/countryIdentifiers.ts). */
const GENERIC_TAX_ID_MIN_LENGTH = 4;
const GENERIC_TAX_ID_MAX_LENGTH = 20;

const CPF_PATTERN = /^\d{11}$/;
/**
 * CNPJ alfanumérico da Receita (emitido desde julho de 2026): as 12 primeiras posições aceitam
 * letra ou dígito, os 2 verificadores continuam numéricos. O CNPJ só de dígitos é caso particular.
 */
const CNPJ_PATTERN = /^[0-9A-Z]{12}\d{2}$/;

const CPF_WEIGHTS_FIRST = [10, 9, 8, 7, 6, 5, 4, 3, 2];
const CPF_WEIGHTS_SECOND = [11, ...CPF_WEIGHTS_FIRST];
const CNPJ_WEIGHTS_FIRST = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const CNPJ_WEIGHTS_SECOND = [6, ...CNPJ_WEIGHTS_FIRST];

/** taxIdType esperado pro BR — único país em que o backend conhece o mapeamento canônico. */
const BR_EXPECTED_TAX_ID_TYPE: Record<'individual' | 'company', string> = {
  individual: 'cpf',
  company: 'cnpj',
};

/** Módulo 11 da Receita: resto menor que 2 vira 0, o resto vira 11 menos o resto. */
function checkDigit(values: number[], weights: number[]): number {
  const sum = weights.reduce((acc, weight, index) => acc + values[index] * weight, 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

/** `111.111.111-11` fecha a conta, mas não existe — a Receita não emite sequência repetida. */
function isRepeatedSequence(value: string): boolean {
  return /^(.)\1*$/.test(value);
}

export function isValidCpf(value: string): boolean {
  const cpf = normalizeTaxId(value);
  if (!CPF_PATTERN.test(cpf) || isRepeatedSequence(cpf)) return false;

  const digits = [...cpf].map(Number);
  return (
    digits[9] === checkDigit(digits, CPF_WEIGHTS_FIRST) &&
    digits[10] === checkDigit(digits, CPF_WEIGHTS_SECOND)
  );
}

export function isValidCnpj(value: string): boolean {
  const cnpj = normalizeTaxId(value);
  if (!CNPJ_PATTERN.test(cnpj) || isRepeatedSequence(cnpj)) return false;

  // No alfanumérico cada caractere vale o código ASCII menos 48: dígito vale ele mesmo, A vale 17.
  const values = [...cnpj].map((char) => char.charCodeAt(0) - 48);
  return (
    values[12] === checkDigit(values, CNPJ_WEIGHTS_FIRST) &&
    values[13] === checkDigit(values, CNPJ_WEIGHTS_SECOND)
  );
}

/**
 * Validação de documento fiscal no cadastro. No Brasil, CPF e CNPJ passam pelo dígito
 * verificador — esta é a checagem que vale, porque o formulário pode ser contornado. Qualquer
 * outro país cai na tolerância fraca (tamanho apenas) do fallback genérico do frontend: o
 * backend não replica os algoritmos de cada país.
 *
 * `taxIdType` só é conferido pro BR (único país cujo mapeamento país→tipo o backend conhece
 * de verdade); pros demais o backend aceita o que o frontend mandar.
 */
export function isValidTaxIdForCountry(
  country: string,
  taxId: string,
  personType: 'individual' | 'company',
  taxIdType?: string,
): boolean {
  if (country.trim().toUpperCase() === 'BR') {
    if (
      taxIdType !== undefined &&
      taxIdType.trim().toLowerCase() !== BR_EXPECTED_TAX_ID_TYPE[personType]
    ) {
      return false;
    }
    return personType === 'individual' ? isValidCpf(taxId) : isValidCnpj(taxId);
  }

  const cleaned = normalizeTaxId(taxId);
  return cleaned.length >= GENERIC_TAX_ID_MIN_LENGTH && cleaned.length <= GENERIC_TAX_ID_MAX_LENGTH;
}
