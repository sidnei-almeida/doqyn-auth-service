-- AlterEnum: add provisioning lifecycle statuses to TenantStatus
ALTER TYPE "TenantStatus" ADD VALUE IF NOT EXISTS 'pending_provisioning';
ALTER TYPE "TenantStatus" ADD VALUE IF NOT EXISTS 'provisioning_failed';
