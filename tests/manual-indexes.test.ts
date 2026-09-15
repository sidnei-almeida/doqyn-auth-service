import { describe, it, expect } from 'vitest';
import { prisma } from '../src/db/prisma.js';

/**
 * Índices criados à mão em migração, que o schema.prisma não sabe descrever.
 *
 * O `migrate dev` propõe derrubá-los como drift, e um deles já foi derrubado assim sem ninguém ver
 * (`20260904205625_invite_access_groups` apagou o de prefixo do handle). Este teste é o alarme.
 */
const MANUAL_INDEXES = [
  'auth_users_username_prefix_idx',
  'auth_tenants_tax_id_hash_country_live_key',
  'auth_invites_tenant_email_pending_key',
];

describe('índices manuais continuam no banco', () => {
  it.each(MANUAL_INDEXES)('%s existe', async (indexName) => {
    const rows = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND indexname = ${indexName}
    `;
    expect(rows).toHaveLength(1);
  });
});
