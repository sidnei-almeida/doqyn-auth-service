-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('pending', 'active', 'blocked');

-- CreateEnum
CREATE TYPE "TenantType" AS ENUM ('individual', 'business');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('pending', 'active', 'blocked', 'rejected');

-- CreateEnum
CREATE TYPE "TenantRole" AS ENUM ('doqyn_admin', 'company_admin', 'individual_admin', 'user');

-- CreateEnum
CREATE TYPE "AccessRequestStatus" AS ENUM ('pending', 'approved', 'rejected', 'cancelled');

-- AlterTable
ALTER TABLE "auth_sessions" ADD COLUMN     "active_membership_id" UUID;

-- CreateTable
CREATE TABLE "auth_tenants" (
    "id" UUID NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "tenant_type" "TenantType" NOT NULL,
    "display_name_encrypted" TEXT,
    "display_name_lookup_hash" TEXT,
    "slug" TEXT,
    "tax_id_type" TEXT,
    "tax_id_masked" TEXT,
    "tax_id_hash" TEXT,
    "status" "TenantStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_memberships" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'pending',
    "requested_job_title_encrypted" TEXT,
    "requested_department_encrypted" TEXT,
    "requested_reason_encrypted" TEXT,
    "approved_by_membership_id" UUID,
    "approved_at" TIMESTAMP(3),
    "rejected_by_membership_id" UUID,
    "rejected_at" TIMESTAMP(3),
    "blocked_by_membership_id" UUID,
    "blocked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_membership_roles" (
    "id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "role" "TenantRole" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_membership_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_access_groups" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "group_id" TEXT NOT NULL,
    "name_encrypted" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description_encrypted" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_access_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_membership_access_groups" (
    "id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "access_group_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_membership_access_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_access_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "membership_id" UUID,
    "status" "AccessRequestStatus" NOT NULL DEFAULT 'pending',
    "person_type" TEXT NOT NULL,
    "tax_id_type" TEXT NOT NULL,
    "tax_id_masked" TEXT,
    "tax_id_hash" TEXT,
    "tenant_display_name_encrypted" TEXT,
    "job_title_encrypted" TEXT,
    "department_encrypted" TEXT,
    "reason_encrypted" TEXT,
    "operational_notifications_consent" BOOLEAN NOT NULL DEFAULT false,
    "consent_text_version" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),
    "decided_by_membership_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_access_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_notification_preferences" (
    "id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "email" BOOLEAN NOT NULL DEFAULT true,
    "whatsapp" BOOLEAN NOT NULL DEFAULT true,
    "document_created" BOOLEAN NOT NULL DEFAULT true,
    "document_updated" BOOLEAN NOT NULL DEFAULT true,
    "document_requires_signature" BOOLEAN NOT NULL DEFAULT true,
    "access_approved" BOOLEAN NOT NULL DEFAULT true,
    "access_rejected" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auth_tenants_tenant_id_key" ON "auth_tenants"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_tenants_slug_key" ON "auth_tenants"("slug");

-- CreateIndex
CREATE INDEX "auth_tenants_tax_id_hash_idx" ON "auth_tenants"("tax_id_hash");

-- CreateIndex
CREATE INDEX "auth_tenants_status_idx" ON "auth_tenants"("status");

-- CreateIndex
CREATE INDEX "auth_memberships_tenant_id_status_idx" ON "auth_memberships"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "auth_memberships_user_id_tenant_id_key" ON "auth_memberships"("user_id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_membership_roles_membership_id_role_key" ON "auth_membership_roles"("membership_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "auth_access_groups_tenant_id_group_id_key" ON "auth_access_groups"("tenant_id", "group_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_access_groups_tenant_id_slug_key" ON "auth_access_groups"("tenant_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "auth_membership_access_groups_membership_id_access_group_id_key" ON "auth_membership_access_groups"("membership_id", "access_group_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_notification_preferences_membership_id_key" ON "auth_notification_preferences"("membership_id");

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_active_membership_id_fkey" FOREIGN KEY ("active_membership_id") REFERENCES "auth_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_memberships" ADD CONSTRAINT "auth_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_memberships" ADD CONSTRAINT "auth_memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "auth_tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_membership_roles" ADD CONSTRAINT "auth_membership_roles_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "auth_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_access_groups" ADD CONSTRAINT "auth_access_groups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "auth_tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_membership_access_groups" ADD CONSTRAINT "auth_membership_access_groups_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "auth_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_membership_access_groups" ADD CONSTRAINT "auth_membership_access_groups_access_group_id_fkey" FOREIGN KEY ("access_group_id") REFERENCES "auth_access_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_access_requests" ADD CONSTRAINT "auth_access_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_access_requests" ADD CONSTRAINT "auth_access_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "auth_tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_access_requests" ADD CONSTRAINT "auth_access_requests_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "auth_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_notification_preferences" ADD CONSTRAINT "auth_notification_preferences_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "auth_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
