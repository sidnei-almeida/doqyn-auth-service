import { randomBytes } from 'node:crypto';
import { slugify } from './normalize.js';

const MAX_TENANT_ID_LENGTH = 48;

export function generateBusinessTenantId(displayName: string): string {
  const slug = slugify(displayName).replace(/[^a-z0-9_]/g, '').slice(0, 28);
  const suffix = randomBytes(3).toString('hex');
  const base = slug || 'org';
  let tenantId = `company_${base}_${suffix}`;

  if (tenantId.length > MAX_TENANT_ID_LENGTH) {
    tenantId = tenantId.slice(0, MAX_TENANT_ID_LENGTH);
  }

  return tenantId;
}

/** Gera tenantId seguro para pessoa física (individual). Nunca inclui CPF. */
export function generateIndividualTenantId(firstName: string, lastName: string): string {
  const slug = slugify(`${firstName} ${lastName}`).replace(/[^a-z0-9_]/g, '').slice(0, 24);
  const suffix = randomBytes(3).toString('hex');
  const base = slug || 'person';
  let tenantId = `individual_${base}_${suffix}`;

  if (tenantId.length > MAX_TENANT_ID_LENGTH) {
    tenantId = tenantId.slice(0, MAX_TENANT_ID_LENGTH);
  }

  return tenantId;
}

export function isSafeTenantIdentifier(value: string): boolean {
  if (!value || value.length > MAX_TENANT_ID_LENGTH) return false;
  if (!/^[a-z][a-z0-9_]*$/.test(value)) return false;
  const digits = value.replace(/\D/g, '');
  if (digits.length === value.length && (digits.length === 11 || digits.length === 14)) {
    return false;
  }
  return true;
}
