import { normalizeTaxId } from './normalize.js';

const BR_INDIVIDUAL_TAX_ID_LENGTH = 11; // CPF
const BR_COMPANY_TAX_ID_LENGTH = 14; // CNPJ

/** Mesma tolerância do fallback genérico do frontend (src/lib/identifiers/countryIdentifiers.ts). */
const GENERIC_TAX_ID_MIN_LENGTH = 4;
const GENERIC_TAX_ID_MAX_LENGTH = 20;

/** taxIdType esperado pro BR — único país em que o backend conhece o mapeamento canônico. */
const BR_EXPECTED_TAX_ID_TYPE: Record<'individual' | 'company', string> = {
  individual: 'cpf',
  company: 'cnpj',
};

/**
 * Validação de documento fiscal no cadastro. BR mantém a checagem forte de tamanho que já
 * existia (CPF=11 pra individual, CNPJ=14 pra company — sem dígito verificador, igual ao
 * comportamento anterior — mas agora exigindo o tamanho certo pro personType do endpoint,
 * não aceitando qualquer um dos dois); qualquer outro país cai na mesma tolerância fraca
 * (tamanho apenas, sem dígito verificador) do fallback genérico do frontend, já que o
 * backend não replica os algoritmos de validação forte específicos de cada país (esses
 * vivem só no frontend).
 *
 * `taxIdType` só é conferido pro BR (único país cujo mapeamento país→tipo o backend conhece
 * de verdade); pros demais o backend não tem uma lista canônica de tipos por país e aceita
 * o que o frontend mandar — a validação de tamanho acima já cobre o essencial.
 */
export function isValidTaxIdForCountry(
  country: string,
  taxId: string,
  personType: 'individual' | 'company',
  taxIdType?: string,
): boolean {
  const cleaned = normalizeTaxId(taxId);

  if (country.trim().toUpperCase() === 'BR') {
    if (taxIdType !== undefined && taxIdType.trim().toLowerCase() !== BR_EXPECTED_TAX_ID_TYPE[personType]) {
      return false;
    }
    // CPF/CNPJ são só dígitos — normalizeTaxId preserva letras (pro NIF/CIF espanhol),
    // então aqui precisa checar dígito-only explicitamente, não só o tamanho.
    const expectedLength =
      personType === 'individual' ? BR_INDIVIDUAL_TAX_ID_LENGTH : BR_COMPANY_TAX_ID_LENGTH;
    return /^\d+$/.test(cleaned) && cleaned.length === expectedLength;
  }

  return cleaned.length >= GENERIC_TAX_ID_MIN_LENGTH && cleaned.length <= GENERIC_TAX_ID_MAX_LENGTH;
}
