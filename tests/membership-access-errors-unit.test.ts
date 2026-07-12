import { describe, it, expect } from 'vitest';
import { resolveMembershipAccessError } from '../src/utils/membershipAccessErrors.js';

describe('resolveMembershipAccessError — provisionamento', () => {
  it('prioriza TENANT_PROVISIONING_FAILED sobre MEMBERSHIP_PENDING', () => {
    const result = resolveMembershipAccessError([
      {
        status: 'pending',
        tenant: { status: 'provisioning_failed' },
      },
    ]);
    expect(result.code).toBe('TENANT_PROVISIONING_FAILED');
    expect(result.details?.status).toBe('provisioning_failed');
  });

  it('pending com tenant active continua MEMBERSHIP_PENDING', () => {
    const result = resolveMembershipAccessError([
      {
        status: 'pending',
        tenant: { status: 'active' },
      },
    ]);
    expect(result.code).toBe('MEMBERSHIP_PENDING');
  });
});
