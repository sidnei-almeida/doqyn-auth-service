export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12) {
    return `+${digits}`;
  }
  if (digits.length >= 10) {
    return `+55${digits}`;
  }
  return `+${digits}`;
}

export function normalizeTaxId(taxId: string): string {
  return taxId.replace(/\D/g, '');
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
