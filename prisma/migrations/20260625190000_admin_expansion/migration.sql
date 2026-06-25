-- CreateEnum
CREATE TYPE "AccessGroupStatus" AS ENUM ('active', 'inactive', 'deleted');

-- AlterEnum
ALTER TYPE "AuthUserStatus" ADD VALUE 'anonymized';

-- AlterEnum
ALTER TYPE "MembershipStatus" ADD VALUE 'removed';

-- AlterTable: migrate access groups from active boolean to status enum
ALTER TABLE "auth_access_groups" ADD COLUMN "status" "AccessGroupStatus" NOT NULL DEFAULT 'active';
UPDATE "auth_access_groups" SET "status" = 'inactive' WHERE "active" = false;
ALTER TABLE "auth_access_groups" DROP COLUMN "active";
ALTER TABLE "auth_access_groups" ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "auth_access_groups" ADD COLUMN "deleted_by_membership_id" UUID;

-- AlterTable
ALTER TABLE "auth_audit_logs" ADD COLUMN "actor_membership_id" UUID;
ALTER TABLE "auth_audit_logs" ADD COLUMN "target_membership_id" UUID;
ALTER TABLE "auth_audit_logs" ADD COLUMN "target_user_id" UUID;
ALTER TABLE "auth_audit_logs" ADD COLUMN "tenant_text_id" TEXT;

-- AlterTable
ALTER TABLE "auth_memberships" ADD COLUMN "removed_at" TIMESTAMP(3);
ALTER TABLE "auth_memberships" ADD COLUMN "removed_by_membership_id" UUID;

-- AlterTable
ALTER TABLE "auth_tenants" ADD COLUMN "blocked_at" TIMESTAMP(3);
ALTER TABLE "auth_tenants" ADD COLUMN "blocked_by_membership_id" UUID;

-- AlterTable
ALTER TABLE "auth_users" ADD COLUMN "anonymized_at" TIMESTAMP(3);
ALTER TABLE "auth_users" ADD COLUMN "last_login_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "auth_account_deletion_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_account_deletion_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auth_account_deletion_requests_user_id_idx" ON "auth_account_deletion_requests"("user_id");

-- CreateIndex
CREATE INDEX "auth_account_deletion_requests_status_idx" ON "auth_account_deletion_requests"("status");

-- CreateIndex
CREATE INDEX "auth_access_groups_tenant_id_status_idx" ON "auth_access_groups"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "auth_audit_logs_tenant_text_id_idx" ON "auth_audit_logs"("tenant_text_id");

-- CreateIndex
CREATE INDEX "auth_audit_logs_target_membership_id_idx" ON "auth_audit_logs"("target_membership_id");

-- CreateIndex
CREATE INDEX "auth_sessions_active_membership_id_idx" ON "auth_sessions"("active_membership_id");

-- AddForeignKey
ALTER TABLE "auth_account_deletion_requests" ADD CONSTRAINT "auth_account_deletion_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
