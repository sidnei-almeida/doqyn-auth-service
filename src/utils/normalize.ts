import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * O frontend já manda o telefone em E.164 com "+" quando conhece o país (ver
 * toE164Plus() em src/lib/identifiers/phone.ts no app principal) — nesse caso o "+"
 * já embute o DDI certo e `defaultCountry` é ignorado pela lib. Mas nem todo chamador
 * daqui tem country no input (access-requests, invites, users ainda são BR-only), e
 * um número nacional sem "+" (ex.: "11987654321") não carrega DDI nenhum — sem
 * `defaultCountry`, libphonenumber-js interpretaria os dígitos iniciais como um DDI
 * desconhecido e devolveria lixo. `defaultCountry` supre esse caso preservando o
 * comportamento antigo (BR como default) sem reintroduzir o bug de prefixar +55 em
 * cima de um número que já tinha DDI de outro país.
 */
export function normalizePhone(phone: string, defaultCountry: CountryCode = 'BR'): string {
  const trimmed = phone.trim();
  if (!trimmed) return '';

  const hasExplicitDdi = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';

  const parsed = hasExplicitDdi
    ? parsePhoneNumberFromString(`+${digits}`)
    : parsePhoneNumberFromString(digits, defaultCountry);

  if (parsed && parsed.isValid()) {
    return parsed.format('E.164');
  }

  return `+${digits}`;
}

/**
 * Mantém dígitos E letras (maiúsculo) — documentos fiscais fora do Brasil podem ter letra
 * de controle (ex.: NIF/CIF espanhóis). Pra CPF/CNPJ (só dígitos) o comportamento é idêntico
 * ao anterior, já que não há letra a preservar.
 */
export function normalizeTaxId(taxId: string): string {
  return taxId.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

export function detectTaxIdType(taxId: string): 'cpf' | 'cnpj' {
  const digits = normalizeTaxId(taxId);
  return digits.length > 11 ? 'cnpj' : 'cpf';
}

export function maskTaxId(taxId: string): string {
  const digits = normalizeTaxId(taxId);
  if (digits.length === 11) {
    return `***.***.***-${digits.slice(-2)}`;
  }
  if (digits.length === 14) {
    return `**.***.***/****-${digits.slice(-2)}`;
  }
  return `***${digits.slice(-2)}`;
}

export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}
