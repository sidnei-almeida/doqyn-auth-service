import { describe, it, expect } from 'vitest';
import { prisma } from '../src/db/prisma.js';
import { hashLookup } from '../src/security/crypto.js';
import { normalizeTaxId } from '../src/utils/normalize.js';
import { createTenant, findTenantByTextId } from '../src/modules/tenants/tenants.service.js';

describe('tenants', () => {
  it('criar tenant', async () => {
    const tenant = await createTenant({
      tenantId: 'company_test',
      tenantType: 'business',
      displayName: 'Empresa Teste',
      taxId: '12345678000199',
      status: 'active',
    });

    expect(tenant.tenantId).toBe('company_test');
    expect(tenant.status).toBe('active');
  });

  it('não duplicar tenant por tenantId', async () => {
    await createTenant({ tenantId: 'unique_tenant', tenantType: 'business' });
    await expect(
      createTenant({ tenantId: 'unique_tenant', tenantType: 'business' }),
    ).rejects.toThrow();
  });

  it('buscar tenant por tenantId', async () => {
    await createTenant({ tenantId: 'find_me', tenantType: 'individual', displayName: 'Find' });
    const found = await findTenantByTextId('find_me');
    expect(found?.tenantId).toBe('find_me');
  });

  it('taxId cru não aparece em logs', async () => {
    const taxId = '12345678901';
    await createTenant({
      tenantId: 'tax_tenant',
      tenantType: 'individual',
      taxId,
    });

    const rows = await prisma.authTenant.findMany({ where: { tenantId: 'tax_tenant' } });
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain(taxId);
    expect(rows[0]?.taxIdHash).toBe(hashLookup(normalizeTaxId(taxId)));
  });
});
